import 'server-only'
import {sanity, ref} from './sanity'
import type {Actor} from './workflow'

export type ActorInfo = {kind: Actor; name: string}

type Transition = {id: string; title: string; from: string[]; to: string; actors: Actor[]; requiresNote?: boolean}

export async function getTransitions(): Promise<Transition[]> {
  return sanity.fetch(`coalesce(*[_id == "workflow.socialPost"][0].transitions, [])`)
}

export class WorkflowError extends Error {
  status = 409
}

/**
 * Move a post through the workflow. The rules live in the `workflow.socialPost`
 * document; this function only enforces them. Agents and humans call the same
 * function — the difference is the `actor.kind` that gets checked.
 */
export async function transition(
  postId: string,
  transitionId: string,
  actor: ActorInfo,
  opts: {note?: string; runId?: string; set?: Record<string, unknown>} = {},
) {
  const [transitions, post] = await Promise.all([
    getTransitions(),
    sanity.fetch<{stage?: string; hasDraft: boolean} | null>(
      `*[_id == $id][0]{stage, "hasDraft": defined(*[_id == "drafts." + $id][0]._id)}`,
      {id: postId},
    ),
  ])
  if (!post) throw new WorkflowError(`Post ${postId} not found (is it published?)`)
  const t = transitions.find((x) => x.id === transitionId)
  const from = post.stage || 'draft'
  if (!t) throw new WorkflowError(`Unknown transition "${transitionId}"`)
  if (!t.from.includes(from)) throw new WorkflowError(`"${t.title}" is not allowed from stage "${from}"`)
  if (!t.actors.includes(actor.kind))
    throw new WorkflowError(`"${t.title}" can only be taken by: ${t.actors.join(', ')} (not ${actor.kind})`)
  if (t.requiresNote && !opts.note) throw new WorkflowError(`"${t.title}" requires a note`)

  const set = {...(opts.set || {}), stage: t.to}
  const tx = sanity.transaction().patch(postId, (p) => p.set(set))
  if (post.hasDraft) tx.patch(`drafts.${postId}`, (p) => p.set(set))
  tx.create({
    _type: 'workflowEvent',
    post: ref(postId),
    transition: t.id,
    from,
    to: t.to,
    actor,
    note: opts.note,
    run: opts.runId ? ref(opts.runId) : undefined,
    at: new Date().toISOString(),
  })
  await tx.commit({visibility: 'sync'})
  return {from, to: t.to}
}
