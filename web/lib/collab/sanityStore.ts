import 'server-only'
import {createHash, randomUUID} from 'node:crypto'
import {sanity} from '@/lib/sanity'
import type {CollabStore} from './room'
import type {SeedPost} from './schema'

/**
 * Co-writing rooms live in the same Content Lake as everything else:
 *   collabSnapshot.<h>        merged Yjs state (compacted)
 *   collabUpdate.<h>.<id>     one merged batch from one browser
 *   collabPresence.<h>.<cid>  latest awareness state of one browser tab
 * <h> is a short hash of the room id, keeping document ids well under 128 chars.
 * These types are intentionally not in the Studio schema: they are plumbing.
 */
const key = (room: string) => createHash('sha256').update(room).digest('hex').slice(0, 24)
export const snapshotId = (room: string) => `collabSnapshot.${key(room)}`
export const presenceId = (room: string, client: number) => `collabPresence.${key(room)}.${client}`

export const sanityCollabStore: CollabStore = {
  async load(room) {
    const res = await sanity.fetch<{snapshot: {data: string; _rev: string} | null; updates: {_id: string; data: string}[]}>(
      `{
        "snapshot": *[_id == $sid][0]{data, _rev},
        "updates": *[_type == "collabUpdate" && room == $room] | order(_createdAt asc){_id, data}
      }`,
      {sid: snapshotId(room), room},
    )
    return {
      snapshot: res.snapshot ? {data: res.snapshot.data, rev: res.snapshot._rev} : null,
      updates: (res.updates || []).map((u) => ({id: u._id, data: u.data})),
    }
  },
  async createSnapshotIfMissing(room, data) {
    await sanity.createIfNotExists({_id: snapshotId(room), _type: 'collabSnapshot', room, data, compactedAt: new Date().toISOString()})
  },
  async appendUpdate(room, data, client) {
    const _id = `collabUpdate.${key(room)}.${randomUUID().replace(/-/g, '').slice(0, 16)}`
    await sanity.create({_id, _type: 'collabUpdate', room, data, client: client ?? null})
    return _id
  },
  async countUpdates(room) {
    return sanity.fetch<number>(`count(*[_type == "collabUpdate" && room == $room])`, {room})
  },
  async compact(room, previousRev, data, mergedIds) {
    const tx = sanity.transaction()
    const doc = {_id: snapshotId(room), _type: 'collabSnapshot', room, data, compactedAt: new Date().toISOString()}
    if (previousRev) tx.patch(doc._id, (p) => p.ifRevisionId(previousRev).set({data, compactedAt: doc.compactedAt}))
    else tx.create(doc) // fails if another compaction created it first; the caller ignores that
    for (const id of mergedIds) tx.delete(id)
    await tx.commit({visibility: 'async'})
  },
  async putPresence(room, client, data) {
    await sanity.createOrReplace({_id: presenceId(room, client), _type: 'collabPresence', room, client, data, at: new Date().toISOString()})
  },
  async removePresence(room, client) {
    await sanity.delete(presenceId(room, client))
  },
  async listPresence(room, sinceIso) {
    return sanity.fetch<string[]>(`*[_type == "collabPresence" && room == $room && at > $since].data`, {room, since: sinceIso})
  },
  async prunePresence(room, beforeIso) {
    await sanity.delete({query: `*[_type == "collabPresence" && room == $room && at < $before]`, params: {room, before: beforeIso}})
  },
  async loadSeed(postId) {
    const post = await sanity.fetch<(Omit<SeedPost, 'postId' | 'rev'> & {_id: string; _rev: string}) | null>(
      `*[_id == $id && _type == "post"][0]{_id, _rev, title, body, mediaDescription, platform, revision,
        "audienceId": audience._ref, "brandId": brand._ref}`,
      {id: postId},
    )
    if (!post) return null
    return {...post, postId: post._id, rev: post._rev, revision: post.revision || 1}
  },
}
