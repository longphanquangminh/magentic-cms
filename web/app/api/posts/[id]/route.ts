import {NextResponse} from 'next/server'
import {sanity} from '@/lib/sanity'
import {POST_PROJECTION} from '@/lib/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const post = await sanity.fetch(`*[_id == $id][0]${POST_PROJECTION}`, {id})
  if (!post) return NextResponse.json({error: 'not found'}, {status: 404})
  return NextResponse.json(post, {headers: {'cache-control': 'no-store'}})
}
