import {NextResponse} from 'next/server'
import {transition, WorkflowError} from '@/lib/workflowEngine'
import {applyRevision} from '@/lib/engine'

export const runtime = 'nodejs'

/**
 * Human transitions from the live room (approve, publish, send back, apply revision).
 * Pass `as: "agent"` to see the workflow document refuse an agent approval.
 */
export async function POST(req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  try {
    const {transitionId, note, as} = await req.json()
    const actor =
      as === 'agent' ? {kind: 'agent' as const, name: 'Autopilot'} : {kind: 'human' as const, name: 'Live room reviewer'}
    const out =
      transitionId === 'apply_revision' ? await applyRevision(id, actor) : await transition(id, transitionId, actor, {note})
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({error: e.message || String(e)}, {status: e instanceof WorkflowError ? 409 : 500})
  }
}
