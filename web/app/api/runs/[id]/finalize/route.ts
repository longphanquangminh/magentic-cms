import {NextResponse} from 'next/server'
import {finalizeRun} from '@/lib/engine'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(_req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {id} = await params
    return NextResponse.json(await finalizeRun(id))
  } catch (e: any) {
    return NextResponse.json({error: e.message || String(e)}, {status: 500})
  }
}
