import {NextResponse} from 'next/server'
import {sanity} from '@/lib/sanity'
import {REACTION_PROJECTION, RUN_PROJECTION} from '@/lib/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Incremental fetch: reactions with seq > after, plus the run's current state. */
export async function GET(req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const after = Number(new URL(req.url).searchParams.get('after') ?? -1)
  const data = await sanity.fetch(
    `{
      "run": *[_id == $id][0]${RUN_PROJECTION},
      "reactions": *[_type == "reaction" && run._ref == $id && seq > $after] | order(seq asc)${REACTION_PROJECTION},
      "likes": *[_type == "reaction" && run._ref == $id && likes > 0]{_id, likes}
    }`,
    {id, after},
  )
  return NextResponse.json(data, {headers: {'cache-control': 'no-store'}})
}
