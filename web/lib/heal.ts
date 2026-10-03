import 'server-only'
import {sanity, ref} from './sanity'

const STALE_MS = 3 * 60 * 1000

/**
 * A run is driven by the browser tab that started it. If that tab was closed or
 * refreshed, the run stops advancing and the post would stay "simulating" forever.
 * Any run with no progress for 3 minutes is closed as "interrupted": saved
 * reactions are kept, and its post goes back to draft so it can be run again.
 */
export async function healStaleRuns(postId?: string) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const runs: {_id: string; _rev: string; status: string; post?: {_ref: string}}[] = await sanity.fetch(
    `*[_type == "simulationRun" && status in ["running", "paused", "analyzing"] && _updatedAt < $cutoff
      && (!defined($postId) || post._ref == $postId)]{_id, _rev, status, post}`,
    {cutoff, postId: postId ?? null},
  )
  // Posts left in "simulating" without any active run (e.g. run already ended).
  const orphans: {_id: string; _rev: string; hasDraft: boolean}[] = await sanity.fetch(
    `*[_type == "post" && stage == "simulating" && !(_id in path("drafts.**")) && (!defined($postId) || _id == $postId)
      && !defined(*[_type == "simulationRun" && post._ref == ^._id && status in ["running", "paused", "analyzing"] && _updatedAt >= $cutoff][0]._id)
    ]{_id, _rev, "hasDraft": defined(*[_id == "drafts." + ^._id][0]._id)}`,
    {cutoff, postId: postId ?? null},
  )
  const now = new Date().toISOString()
  for (const run of runs) {
    try {
      await sanity
        .patch(run._id)
        .ifRevisionId(run._rev)
        .set({status: 'cancelled', error: 'Interrupted: the tab running this session was closed or refreshed. Saved reactions were kept.', finishedAt: now})
        .commit()
    } catch {
      /* another request already handled it */
    }
  }
  for (const post of orphans) {
    try {
      const tx = sanity.transaction().patch(post._id, (p) => p.ifRevisionId(post._rev).set({stage: 'draft'}))
      if (post.hasDraft) tx.patch(`drafts.${post._id}`, (p) => p.set({stage: 'draft'}))
      tx.create({
        _type: 'workflowEvent',
        post: ref(post._id),
        transition: 'recover_interrupted',
        from: 'simulating',
        to: 'draft',
        actor: {kind: 'agent', name: 'Session recovery'},
        note: 'Session was interrupted (tab closed or refreshed). Returned to draft; earlier reactions kept.',
        at: now,
      })
      await tx.commit({visibility: 'sync'})
    } catch {
      /* changed concurrently; next load retries */
    }
  }
  return {runs: runs.length, posts: orphans.length}
}
