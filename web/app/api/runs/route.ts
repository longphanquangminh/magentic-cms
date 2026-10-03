import {NextResponse} from 'next/server'
import {createRun} from '@/lib/engine'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const {postId, size, autopilot} = await req.json()
    if (!postId) return NextResponse.json({error: 'postId required'}, {status: 400})
    const actor = autopilot
      ? {kind: 'agent' as const, name: 'Autopilot'}
      : {kind: 'human' as const, name: 'Live room reviewer'}
    const out = await createRun(String(postId), actor, size ? Number(size) : undefined)
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({error: e.message || String(e)}, {status: e.status || 500})
  }
}
