import {NextResponse} from 'next/server'
import {stepRun} from '@/lib/engine'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params
    return NextResponse.json(await stepRun(id))
  } catch (e: any) {
    return NextResponse.json({error: e.message || String(e)}, {status: 500})
  }
}
