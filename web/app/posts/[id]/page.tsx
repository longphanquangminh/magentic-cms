import {notFound} from 'next/navigation'
import {sanity} from '@/lib/sanity'
import {healStaleRuns} from '@/lib/heal'
import {POST_PROJECTION} from '@/lib/queries'
import LiveRoom from '@/components/LiveRoom'

export const dynamic = 'force-dynamic'

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{id: string}>
  searchParams: Promise<{run?: string; autorun?: string}>
}) {
  const {id} = await params
  const sp = await searchParams
  await healStaleRuns(id).catch(() => null)
  const post = await sanity.fetch(`*[_id == $id][0]${POST_PROJECTION}`, {id})
  if (!post) notFound()
  return (
    <LiveRoom
      initialPost={post}
      initialRunId={sp.run || post.latestRunId || null}
      autorun={sp.autorun === '1'}
      studioUrl={process.env.NEXT_PUBLIC_STUDIO_URL || null}
    />
  )
}
