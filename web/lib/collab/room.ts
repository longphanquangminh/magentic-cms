import * as Y from 'yjs'
import {
  COMPACT_AFTER, MAX_AWARENESS_BYTES, MAX_ROOM_BYTES, MAX_UPDATE_BYTES, PRESENCE_STALE_MS,
  base64Bytes, fromBase64, parsePostRoom, toBase64, type RoomState,
} from './protocol'
import {seedUpdate, type SeedPost} from './schema'

/**
 * Room logic with an injectable store, so it runs against Sanity in production
 * and against an in-memory map in tests/collab.mjs.
 */
export interface CollabStore {
  /** Snapshot + pending updates, read in ONE query so compaction can't tear it. */
  load(room: string): Promise<{snapshot: {data: string; rev: string} | null; updates: {id: string; data: string}[]}>
  createSnapshotIfMissing(room: string, data: string): Promise<void>
  appendUpdate(room: string, data: string, client?: number): Promise<string>
  countUpdates(room: string): Promise<number>
  /** Atomically replace the snapshot (guarded by its previous revision) and delete merged updates. */
  compact(room: string, previousRev: string | null, data: string, mergedIds: string[]): Promise<void>
  putPresence(room: string, client: number, data: string): Promise<void>
  removePresence(room: string, client: number): Promise<void>
  listPresence(room: string, sinceIso: string): Promise<string[]>
  prunePresence(room: string, beforeIso: string): Promise<void>
  loadSeed(postId: string): Promise<SeedPost | null>
}

export class RoomError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const MAX_PENDING_UPDATES = 400

export function decodeChecked(update: unknown, maxBytes = MAX_UPDATE_BYTES): Uint8Array {
  if (typeof update !== 'string' || !update || !/^[A-Za-z0-9+/]+=*$/.test(update)) throw new RoomError('Update must be base64.')
  if (base64Bytes(update) > maxBytes) throw new RoomError('Update is too large.', 413)
  let bytes: Uint8Array
  try { bytes = fromBase64(update) } catch { throw new RoomError('Update must be base64.') }
  return bytes
}

/** Reject anything that isn't a well-formed Yjs update before it reaches other browsers. */
export function validateUpdate(bytes: Uint8Array) {
  try {
    Y.decodeUpdate(bytes)
    const probe = new Y.Doc()
    Y.applyUpdate(probe, bytes)
    probe.destroy()
  } catch {
    throw new RoomError('Not a valid Yjs update.')
  }
}

function merge(snapshot: {data: string} | null, updates: {data: string}[]) {
  const parts = [snapshot?.data, ...updates.map((u) => u.data)].filter(Boolean).map((d) => fromBase64(d as string))
  return parts.length ? Y.mergeUpdates(parts) : Y.encodeStateAsUpdate(new Y.Doc())
}

export async function readRoom(store: CollabStore, room: string, now = Date.now()): Promise<RoomState> {
  let loaded = await store.load(room)
  if (!loaded.snapshot && !loaded.updates.length) {
    const target = parsePostRoom(room)
    if (target) {
      const post = await store.loadSeed(target.postId)
      if (!post) throw new RoomError('This post no longer exists.', 404)
      if ((post.revision || 1) !== target.revision) throw new RoomError('A newer revision of this post exists. Reload the composer to edit it.', 409)
      // Deterministic seed + create-if-missing: concurrent first visitors converge on one copy.
      await store.createSnapshotIfMissing(room, toBase64(seedUpdate(post)))
      loaded = await store.load(room)
    }
  }
  const merged = merge(loaded.snapshot, loaded.updates)
  const since = new Date(now - PRESENCE_STALE_MS).toISOString()
  const [presence] = await Promise.all([
    store.listPresence(room, since).catch(() => []),
    store.prunePresence(room, since).catch(() => null),
  ])
  return {room, state: toBase64(merged), vector: toBase64(Y.encodeStateVectorFromUpdate(merged)), presence}
}

export async function writeUpdate(store: CollabStore, room: string, update: unknown, client?: number) {
  const bytes = decodeChecked(update)
  validateUpdate(bytes)
  const pending = await store.countUpdates(room)
  if (pending >= MAX_PENDING_UPDATES) throw new RoomError('This room is busy. Try again in a moment.', 429)
  const id = await store.appendUpdate(room, update as string, client)
  if (pending + 1 >= COMPACT_AFTER) await compactRoom(store, room).catch(() => null) // another writer may have won; fine
  return id
}

export async function compactRoom(store: CollabStore, room: string) {
  const {snapshot, updates} = await store.load(room)
  if (updates.length < 2) return false
  const merged = merge(snapshot, updates)
  if (merged.length > MAX_ROOM_BYTES) throw new RoomError('This draft room is full. Save the post and open a new revision.', 413)
  await store.compact(room, snapshot?.rev ?? null, toBase64(merged), updates.map((u) => u.id))
  return true
}

export async function writePresence(store: CollabStore, room: string, client: number, update: unknown) {
  if (update === null) return store.removePresence(room, client)
  decodeChecked(update, MAX_AWARENESS_BYTES)
  return store.putPresence(room, client, update as string)
}
