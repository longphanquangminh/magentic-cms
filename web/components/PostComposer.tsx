'use client'

import {useRef, useState, type FormEvent} from 'react'
import Link from 'next/link'
import {useRouter} from 'next/navigation'
import {editBlockReason, MEDIA_DESCRIPTION_MAX_LENGTH, PLATFORMS, type ComposerAudience, type ComposerBrand, type ComposerPost, type Platform} from '@/lib/composerValidation'

const platformNames: Record<Platform, string> = {facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', linkedin: 'LinkedIn'}
const NEW_BRAND = '__new__'

type Props = {brands: ComposerBrand[]; audiences: ComposerAudience[]; initialPost: ComposerPost | null; accessCodeRequired: boolean}

export default function PostComposer({brands, audiences, initialPost, accessCodeRequired}: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initialPost?.title || '')
  const [body, setBody] = useState(initialPost?.body || '')
  const [mediaDescription, setMediaDescription] = useState(initialPost?.mediaDescription || '')
  const [platform, setPlatform] = useState<Platform>(initialPost?.platform || 'facebook')
  const [audienceId, setAudienceId] = useState(initialPost?.audienceId || audiences.find((a) => a._id === 'aud-everyone')?._id || audiences[0]?._id || '')
  const [brandId, setBrandId] = useState(initialPost?.brandId || NEW_BRAND)
  const [brandName, setBrandName] = useState('')
  const [brandVoice, setBrandVoice] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [status, setStatus] = useState('')
  const submissionLock = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const blockReason = initialPost ? editBlockReason(initialPost) : null
  const selectedBrand = brands.find((brand) => brand._id === brandId)
  const selectedAudience = audiences.find((audience) => audience._id === audienceId)
  const previewName = brandId === NEW_BRAND ? brandName.trim() || 'My brand' : selectedBrand?.name || 'Your brand'
  const canSave = !blockReason && audiences.length > 0
  const showError = (message: string) => {
    setError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current || !canSave) return
    setError('')
    setConflict(false)
    if (!title.trim() || !body.trim()) { showError('Add a title and post copy. Spaces alone don’t count.'); return }
    if (mediaDescription.length > MEDIA_DESCRIPTION_MAX_LENGTH) { showError(`Image/video description must be ${MEDIA_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`); return }
    submissionLock.current = true
    setBusy(true)
    setStatus('Saving your draft…')
    try {
      const response = await fetch('/api/composer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...(accessCodeRequired ? {'x-demo-access-code': accessCode} : {})},
        body: JSON.stringify({
          ...(initialPost ? {postId: initialPost._id, expectedRev: initialPost._rev} : {}),
          title, body, mediaDescription, platform, audienceId,
          ...(brandId === NEW_BRAND ? {newBrand: {name: brandName, voice: brandVoice}} : {brandId}),
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        setConflict(response.status === 409)
        throw new Error(result?.error || 'Could not save your draft. Please try again.')
      }
      if (typeof result?.postId !== 'string') throw new Error('The save response was incomplete. Check All posts before retrying.')
      setAccessCode('')
      setStatus(result.changed ? 'Draft saved. Opening the live room…' : 'No changes to save. Opening the live room…')
      // The live room is the saved-post destination. Opening it never starts a model call.
      router.push('/posts/' + encodeURIComponent(result.postId))
      router.refresh()
    } catch (cause) {
      setStatus('')
      showError(cause instanceof Error ? cause.message : 'Could not save your draft. Your edits are still here.')
      submissionLock.current = false
      setBusy(false)
    }
  }

  return (
    <main className="composer">
      <div className="composer-heading">
        <div>
          <Link className="composer-back" href="/">← All posts</Link>
          <p className="composer-eyebrow">YOUR WORDS. BEFORE THE WORLD.</p>
          <h1>{initialPost ? 'Make it yours. Again.' : 'Start with something to say.'}</h1>
          <p className="composer-intro">Write your post, choose your audience, then see how it might land.</p>
        </div>
        <span className="composer-state"><span />{initialPost ? `EDITING · REV ${initialPost.revision || 1}` : 'NEW DRAFT'}</span>
      </div>

      {blockReason && <div className="composer-notice" role="alert">{blockReason} <Link href="/compose">Write a new post instead →</Link></div>}
      {!audiences.length && <div className="composer-notice" role="alert">No audiences are available yet. Add an audience in Studio before saving a post.</div>}
      <form onSubmit={save} onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!busy && canSave) event.currentTarget.requestSubmit(primaryRef.current) }
      }} aria-busy={busy}>
        <div className="composer-grid">
          <section className="composer-editor" aria-labelledby="composer-editor-title">
            <div className="composer-section-heading"><h2 id="composer-editor-title">The draft</h2><span>01 / COMPOSE</span></div>
            <fieldset disabled={busy || !canSave} className="composer-fields">
              <legend className="composer-sr-only">Post content and settings</legend>
              <label htmlFor="composer-title">Internal title <span>Only shown in your workspace</span></label>
              <input id="composer-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} placeholder="Give this idea a name" autoComplete="off" />

              <div className="composer-copy-label"><label htmlFor="composer-body">Post copy</label><span id="composer-count">{body.length.toLocaleString()} / 2,000</span></div>
              <textarea id="composer-body" name="body" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} rows={8} placeholder="What do you want your audience to hear?" aria-describedby="composer-count composer-copy-hint" />
              <p className="composer-hint" id="composer-copy-hint">Your original copy. No AI rewrite unless you choose one later.</p>

              <div className="composer-media-field">
                <div className="composer-copy-label"><label htmlFor="composer-media-description">Image/video description (optional)</label><span id="composer-media-count">{mediaDescription.length.toLocaleString()} / 1,000</span></div>
                <textarea id="composer-media-description" name="mediaDescription" value={mediaDescription} onChange={(e) => setMediaDescription(e.target.value)} maxLength={MEDIA_DESCRIPTION_MAX_LENGTH} rows={3} placeholder="Describe the image or video that goes with this copy" aria-describedby="composer-media-count composer-media-hint" />
                <p className="composer-hint" id="composer-media-hint">The model reads this description, not the image or video itself. Update or clear old media details so they match your new copy.</p>
              </div>

              <div className="composer-two-fields">
                <div><label htmlFor="composer-platform">Platform</label><select id="composer-platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} required>
                  {PLATFORMS.map((item) => <option key={item} value={item}>{platformNames[item]}</option>)}
                </select></div>
                <div><label htmlFor="composer-audience">Test audience</label><select id="composer-audience" value={audienceId} onChange={(e) => setAudienceId(e.target.value)} required aria-describedby="composer-audience-hint">
                  <option value="" disabled hidden>Choose an audience</option>
                  {initialPost?.audienceId && !audiences.some((a) => a._id === initialPost.audienceId) && <option value={initialPost.audienceId} disabled>Unavailable — choose another</option>}
                  {audiences.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
                </select></div>
              </div>
              <p className="composer-hint" id="composer-audience-hint">{selectedAudience?.description || 'Choose the people who will react in your simulation.'}</p>

              <div className="composer-divider" />
              <label htmlFor="composer-brand">Who’s speaking?</label>
              <select id="composer-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
                <option value={NEW_BRAND}>Create my brand</option>
                {initialPost?.brandId && !brands.some((b) => b._id === initialPost.brandId) && <option value={initialPost.brandId} disabled>Unavailable — choose another</option>}
                {brands.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              {brandId === NEW_BRAND ? <div className="composer-brand-fields">
                <div><label htmlFor="composer-brand-name">Brand name <span>Optional</span></label><input id="composer-brand-name" value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={100} placeholder="My brand" autoComplete="organization" /></div>
                <div><label htmlFor="composer-brand-voice">Brand voice <span>Optional</span></label><textarea id="composer-brand-voice" value={brandVoice} onChange={(e) => setBrandVoice(e.target.value)} maxLength={1000} rows={2} placeholder="e.g. Warm, straightforward, a little playful" /></div>
                <p className="composer-hint">A new brand is created with this draft. Leave the name blank to use “My brand”.</p>
              </div> : <p className="composer-hint">{selectedBrand?.voice || 'This draft will use the selected brand. Its existing settings won’t change.'}</p>}
              {accessCodeRequired && <div className="composer-access">
                <label htmlFor="composer-access-code">Demo access code</label><input type="password" id="composer-access-code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required autoComplete="off" maxLength={256} aria-describedby="composer-access-hint" />
                <p className="composer-hint" id="composer-access-hint">Provided by the demo host. Held only for this save, never stored by the composer. This is not a user account.</p>
              </div>}
            </fieldset>
          </section>

          <aside className="composer-preview" aria-labelledby="composer-preview-title">
            <div className="composer-section-heading"><h2 id="composer-preview-title">A view from the feed</h2><span>02 / PREVIEW</span></div>
            <div className="composer-preview-stage">
              <div className="composer-preview-caption"><span>{platformNames[platform] || 'Social'} preview</span><span>NOT PUBLISHED</span></div>
              <article className="composer-social-card" aria-label="Live preview of your post">
                <header><span className="composer-brand-avatar" aria-hidden="true">{previewName.slice(0, 1).toUpperCase()}</span><div><strong>{previewName}</strong><span>{selectedBrand?.handle || 'Your original post'} · Just now</span></div><span className="composer-social-more" aria-hidden="true">···</span></header>
                <p className={`composer-social-copy${body ? '' : ' composer-placeholder'}`}>{body || 'Your words go here. Write something worth a second look.'}</p>
                <div className="composer-social-footer" aria-hidden="true"><span>Like</span><span>Comment</span><span>Share</span></div>
              </article>
              <p className="composer-preview-disclaimer">Text preview only. Final formatting varies by platform.</p>
            </div>
            <div className="composer-next"><span className="composer-next-number">↗</span><div><h3>A rehearsal, not a release.</h3><p>Save to your workspace first. In the live room, start a simulation when you’re ready. Nothing is posted to social media.</p></div></div>
            <div className="composer-summary"><span>TESTING WITH</span><strong>{selectedAudience?.title || 'Your chosen audience'}</strong></div>
            {initialPost && <p className="composer-revision-note">Changing copy or settings creates a new revision and returns the post to draft. Earlier simulation runs stay in its history.</p>}
          </aside>
        </div>

        <div className="composer-error" role="alert" tabIndex={-1} ref={errorRef} hidden={!error}>
          <strong>Draft not saved</strong><p>{error}</p>
          {conflict && <p>Keep a copy of your text before reloading. We haven’t overwritten anyone else’s changes.</p>}
        </div>
        <div className="composer-actions">
          <div><p role="status" aria-live="polite">{status || 'Saved drafts open in the live room. You control what happens next.'}</p><span>Shared demo workspace · Don’t include private or sensitive content.</span></div>
          <div className="composer-action-buttons">
            <button type="submit" className="composer-button composer-secondary" disabled={busy || !canSave}>Save draft</button>
            <button type="submit" ref={primaryRef} className="composer-button composer-primary" disabled={busy || !canSave}>{busy ? 'Saving…' : 'Save & open simulation →'}</button>
          </div>
        </div>
      </form>
    </main>
  )
}
