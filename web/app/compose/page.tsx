import Link from 'next/link'
import {sanity, notDraft} from '@/lib/sanity'
import {isLiveDocumentId, type ComposerAudience, type ComposerBrand, type ComposerPost} from '@/lib/composerValidation'
import PostComposer from '@/components/PostComposer'
import '../composer.css'

export const dynamic = 'force-dynamic'
export const metadata = {title: 'Compose a post — MagenticCMS'}

export default async function ComposePage({searchParams}: {searchParams: Promise<{post?: string | string[]}>}) {
  const params = await searchParams
  const postId = params.post
  let error: string | null = null
  let brands: ComposerBrand[] = []
  let audiences: ComposerAudience[] = []
  let post: ComposerPost | null = null
  if (postId !== undefined && !isLiveDocumentId(postId)) error = 'This post link is invalid. Return to your posts and choose a draft.'
  if (!error) {
    try {
      [brands, audiences, post] = await Promise.all([
        sanity.fetch<ComposerBrand[]>(`*[_type == "brand" && ${notDraft} && !(_id in path("versions.**"))] | order(name asc){_id, name, handle, voice}`),
        sanity.fetch<ComposerAudience[]>(`*[_type == "audience" && ${notDraft} && !(_id in path("versions.**"))] | order(title asc){_id, title, description}`),
        postId ? sanity.fetch<ComposerPost | null>(`*[_id == $id][0]{_id, _rev, _type, title, body, mediaDescription, platform, revision, stage,
          "brandId": brand._ref, "audienceId": audience._ref,
          "hasDraft": defined(*[_id == "drafts." + $id][0]._id),
          "activeRun": count(*[_type == "simulationRun" && post._ref == $id && status in ["running", "analyzing", "paused"]]) > 0
        }`, {id: postId}) : Promise.resolve(null),
      ])
      if (postId && !post) error = 'This post could not be found. It may have been removed.'
    } catch { error = 'The content store is unavailable. Reload this page to try again; no changes have been made.' }
  }
  if (error) return (
    <main className="composer composer-unavailable">
      <Link className="composer-back" href="/">← All posts</Link>
      <p className="composer-eyebrow">WEB COMPOSER</p><h1>Let’s get you back to writing.</h1>
      <p role="alert">{error}</p><Link className="composer-button" href="/compose">Open a new draft</Link>
    </main>
  )
  return <PostComposer brands={brands} audiences={audiences} initialPost={post} accessCodeRequired={Boolean(process.env.DEMO_ACCESS_CODE)} />
}
