'use client'

import {useEffect, useRef, useState, type FormEvent} from 'react'
import Link from 'next/link'
import {useRouter} from 'next/navigation'
import * as Y from 'yjs'
import {editBlockReason, MEDIA_DESCRIPTION_MAX_LENGTH, PLATFORMS, type ComposerAudience, type ComposerBrand, type ComposerPost, type Platform} from '@/lib/composerValidation'
import {LOCAL_ORIGIN, createNote, findNote, flagNoteId, locatePhrase, readNotes, type NoteView, type SavedMarker} from '@/lib/collab/schema'
import CollabField from './collab/CollabField'
import {useCollabRoom, useYText, useYVersion} from './collab/useCollabRoom'
import {ActivityToasts, HighlightedCopy, NotesPanel, PresenceBar, WhoIsWhere, useNotes, useNow} from './collab/RoomChrome'

const platformNames: Record<Platform, string> = {facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', linkedin: 'LinkedIn'}
const NEW_BRAND = '__new__'
const ANALYST = {name: 'Analyst', color: '#f29485'}

type Props = {
  brands: ComposerBrand[]; audiences: ComposerAudience[]; initialPost: ComposerPost | null; accessCodeRequired: boolean
  /** Co-writing room id: `post.<id>.r<revision>` for saved posts, `draft.<uuid>` for new ones. */
  room: string
  /** Opened from an analyst risk flag in the live room: pin it as a note on the phrase. */
  flag?: {phrase: string; why: string} | null
}

export default function PostComposer({brands, audiences, initialPost, accessCodeRequired, room: roomId, flag}: Props) {
  const router = useRouter()
  const room = useCollabRoom(roomId)
  const title = useYText(room.texts.title)
  const body = useYText(room.texts.body)
  const mediaDescription = useYText(room.texts.mediaDescription)
  const brandName = useYText(room.texts.brandName)
  const brandVoice = useYText(room.texts.brandVoice)
  useYVersion(room.settings)
  useYVersion(room.meta)
  const defaultAudience = audiences.find((a) => a._id === 'aud-everyone')?._id || audiences[0]?._id || ''
  const platform = (room.settings.get('platform') || initialPost?.platform || 'facebook') as Platform
  const audienceId = room.settings.get('audienceId') ?? initialPost?.audienceId ?? defaultAudience
  const brandId = room.settings.get('brandId') ?? initialPost?.brandId ?? NEW_BRAND

  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [status, setStatus] = useState('')
  const [selection, setSelection] = useState<{start: number; end: number}>({start: 0, end: 0})
  const [pendingNote, setPendingNote] = useState<{start: Y.RelativePosition; end: Y.RelativePosition; quote: string} | null>(null)
  const [noteText, setNoteText] = useState('')
  const [focusNote, setFocusNote] = useState<string | null>(null)
  const [flagState, setFlagState] = useState<'idle' | 'pinned' | 'missing'>('idle')
  const submissionLock = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const notes = useNotes(room)
  const anyoneTyping = room.peers.some((p) => (p.typingUntil || 0) > Date.now())
  const now = useNow(anyoneTyping, 700)

  // A post room may only be edited once its saved copy has been merged (server or IndexedDB);
  // otherwise an offline first visit would type into an empty doc and duplicate the seed later.
  const isDraftRoom = roomId.startsWith('draft.')
  const ready = room.serverSynced || (room.localLoaded && (isDraftRoom || room.meta.has('base')))
  const saved = room.meta.get('saved') as SavedMarker | undefined
  const supersededBy = saved && (isDraftRoom || saved.revision > (initialPost?.revision || 1)) ? saved : null

  const blockReason = initialPost ? editBlockReason(initialPost) : null
  const selectedBrand = brands.find((brand) => brand._id === brandId)
  const selectedAudience = audiences.find((audience) => audience._id === audienceId)
  const previewName = brandId === NEW_BRAND ? brandName.trim() || 'My brand' : selectedBrand?.name || 'Your brand'
  const canSave = !blockReason && audiences.length > 0 && ready && !supersededBy
  const fieldsDisabled = busy || !canSave
  const showError = (message: string) => {
    setError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  // First writer in a fresh draft room fills in the defaults (identical values, so races are harmless).
  useEffect(() => {
    if (!ready) return
    room.doc.transact(() => {
      if (!room.settings.has('platform')) room.settings.set('platform', initialPost?.platform || 'facebook')
      if (!room.settings.has('audienceId') && defaultAudience) room.settings.set('audienceId', initialPost?.audienceId || defaultAudience)
      if (!room.settings.has('brandId')) room.settings.set('brandId', initialPost?.brandId || NEW_BRAND)
    })
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Analyst flag → anchored note (stable id, so two editors opening the link create one note).
  useEffect(() => {
    if (!flag?.phrase || !room.serverSynced || flagState !== 'idle' || !canSave) return
    const id = flagNoteId(flag.phrase)
    if (!findNote(room.doc, id)) {
      const at = locatePhrase(room.texts.body.toString(), flag.phrase)
      if (!at) { setFlagState('missing'); return }
      createNote(room.doc, {...at, id, kind: 'analyst', author: ANALYST, text: flag.why || 'Flagged by the analyst in the last simulation.'})
    }
    setFlagState('pinned')
    setFocusNote(id)
    setTimeout(() => jumpTo(id), 120)
  }, [flag, room.serverSynced, canSave, flagState]) // eslint-disable-line react-hooks/exhaustive-deps

  function jumpTo(noteOrId: NoteView | string) {
    const id = typeof noteOrId === 'string' ? noteOrId : noteOrId.id
    const fresh = readNotes(room.doc).find((n) => n.id === id) // always the live range
    const el = document.getElementById('composer-body') as HTMLTextAreaElement | null
    if (!el || !fresh?.range) return
    el.focus()
    el.setSelectionRange(fresh.range.start, fresh.range.end)
    el.scrollIntoView({block: 'center', behavior: 'smooth'})
  }

  function startNote() {
    const {start, end} = selection
    if (end <= start) return
    setPendingNote({
      start: Y.createRelativePositionFromTypeIndex(room.texts.body, start, 0),
      end: Y.createRelativePositionFromTypeIndex(room.texts.body, end, -1),
      quote: body.slice(start, end),
    })
    setNoteText('')
  }

  function addNote(event?: {preventDefault(): void}) {
    event?.preventDefault()
    if (!pendingNote || !noteText.trim()) return
    // Resolve the selection captured earlier: the text may have moved while we typed the note.
    const s = Y.createAbsolutePositionFromRelativePosition(pendingNote.start, room.doc)
    const e = Y.createAbsolutePositionFromRelativePosition(pendingNote.end, room.doc)
    if (s && e && e.index > s.index) {
      const id = createNote(room.doc, {start: s.index, end: e.index, text: noteText.trim(), author: room.me})
      setFocusNote(id)
    }
    setPendingNote(null)
    setNoteText('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current || !canSave) return
    setError('')
    setConflict(false)
    if (!title.trim() || !body.trim()) { showError('Add a title and post copy. Spaces alone don’t count.'); return }
    if (body.length > 2000) { showError('Post copy must be 2,000 characters or fewer. Co-writers may have pushed it over — trim it and save again.'); return }
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
      if (result.changed) {
        // Tell everyone else in the room that this copy is now a saved revision.
        room.doc.transact(() => room.meta.set('saved', {postId: result.postId, revision: result.revision, by: room.me.name, color: room.me.color, at: Date.now()} satisfies SavedMarker), LOCAL_ORIGIN)
        await room.provider?.flushNow(2500)
      }
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

  const describeSetting = (key: string, value: string) =>
    key === 'platform' ? platformNames[value as Platform] || value
      : key === 'audienceId' ? audiences.find((a) => a._id === value)?.title || 'another audience'
        : value === NEW_BRAND ? 'a new brand' : brands.find((b) => b._id === value)?.name || 'another brand'

  const typingPeers = room.peers.filter((p) => (p.typingUntil || 0) > now && p.cursor?.field === 'body')
  const selectedText = selection.end > selection.start ? body.slice(selection.start, selection.end) : ''
  const revisionLabel = initialPost ? `REV ${initialPost.revision || 1}` : 'NEW DRAFT'

  return (
    <main className="composer">
      <div className="composer-heading">
        <div>
          <Link className="composer-back" href="/">← All posts</Link>
          <p className="composer-eyebrow">YOUR WORDS. BEFORE THE WORLD. TOGETHER.</p>
          <h1>{initialPost ? 'Make it yours. Again.' : 'Start with something to say.'}</h1>
          <p className="composer-intro">Write your post with your team in real time, choose your audience, then see how it might land.</p>
        </div>
        <PresenceBar room={room} revisionLabel={revisionLabel} />
      </div>
      <WhoIsWhere peers={room.peers} now={now} />

      {blockReason && <div className="composer-notice" role="alert">{blockReason} <Link href="/compose">Write a new post instead →</Link></div>}
      {!audiences.length && <div className="composer-notice" role="alert">No audiences are available yet. Add an audience in Studio before saving a post.</div>}
      {supersededBy && (
        <div className="composer-notice room-saved" role="status" style={{['--c' as any]: supersededBy.color}}>
          <b>{supersededBy.by}</b> saved this copy as revision {supersededBy.revision}. This room is now read-only so nobody overwrites it.{' '}
          <Link href={`/posts/${encodeURIComponent(supersededBy.postId)}`}>Open the live room →</Link>{' '}
          <Link href={`/compose?post=${encodeURIComponent(supersededBy.postId)}`}>Keep editing revision {supersededBy.revision} →</Link>
        </div>
      )}
      {!ready && !blockReason && <div className="composer-notice room-joining" role="status">{room.status === 'offline' ? 'Can’t reach the co-writing room yet. Retrying… Your saved post is safe.' : 'Joining the co-writing room…'}</div>}
      {flagState === 'missing' && <div className="composer-notice" role="status">The analyst flagged “{flag?.phrase}”, but that wording is no longer in the copy. Someone may have already fixed it.</div>}

      <form onSubmit={save} onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!busy && canSave) event.currentTarget.requestSubmit(primaryRef.current) }
      }} aria-busy={busy}>
        <div className="composer-grid">
          <section className="composer-editor" aria-labelledby="composer-editor-title">
            <div className="composer-section-heading"><h2 id="composer-editor-title">The draft</h2><span>01 / CO-WRITE</span></div>
            <fieldset disabled={fieldsDisabled} className="composer-fields">
              <legend className="composer-sr-only">Post content and settings</legend>
              <label htmlFor="composer-title">Internal title <span>Only shown in your workspace</span></label>
              <CollabField room={room} field="title" id="composer-title" name="title" required maxLength={160} placeholder="Give this idea a name" autoComplete="off" />

              <div className="composer-copy-label"><label htmlFor="composer-body">Post copy</label><span id="composer-count" className={body.length > 2000 ? 'is-over' : ''}>{body.length.toLocaleString()} / 2,000</span></div>
              <CollabField room={room} field="body" multiline id="composer-body" name="body" required maxLength={2000} rows={8} placeholder="What do you want your audience to hear?" aria-describedby="composer-count composer-copy-hint"
                onSelection={(start, end) => setSelection({start, end})} />
              <div className="collab-toolbar">
                <button type="button" onClick={() => room.undo.undo()} title="Undo your own last edit (Ctrl/⌘+Z). Co-writers’ edits are untouched.">↶ Undo mine</button>
                <button type="button" onClick={() => room.undo.redo()} title="Redo (Ctrl/⌘+Shift+Z)">↷ Redo</button>
                <span className="collab-toolbar-sep" />
                {pendingNote ? null : selectedText
                  ? <button type="button" className="collab-note-btn" onMouseDown={(e) => e.preventDefault()} onClick={startNote}>✎ Note on “{selectedText.length > 28 ? selectedText.slice(0, 28) + '…' : selectedText}”</button>
                  : <span className="collab-toolbar-hint">Select words to leave a note</span>}
              </div>
              {pendingNote && (
                <div className="collab-note-form" role="group" aria-label="New margin note">
                  <p>Note on <q>{pendingNote.quote.length > 80 ? pendingNote.quote.slice(0, 80) + '…' : pendingNote.quote}</q></p>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} maxLength={600} autoFocus placeholder="What should change here? Everyone in the room sees this."
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); addNote(e) } if (e.key === 'Escape') setPendingNote(null) }} />
                  <div><button type="button" onClick={() => addNote()} disabled={!noteText.trim()}>Pin note</button><button type="button" className="ghost" onClick={() => setPendingNote(null)}>Cancel</button></div>
                </div>
              )}
              <p className="composer-hint" id="composer-copy-hint">Your original copy. No AI rewrite unless you choose one later. Every keystroke syncs to everyone in this room.</p>

              <div className="composer-media-field">
                <div className="composer-copy-label"><label htmlFor="composer-media-description">Image/video description (optional)</label><span id="composer-media-count">{mediaDescription.length.toLocaleString()} / 1,000</span></div>
                <CollabField room={room} field="mediaDescription" multiline id="composer-media-description" name="mediaDescription" maxLength={MEDIA_DESCRIPTION_MAX_LENGTH} rows={3} placeholder="Describe the image or video that goes with this copy" aria-describedby="composer-media-count composer-media-hint" />
                <p className="composer-hint" id="composer-media-hint">The model reads this description, not the image or video itself. Update or clear old media details so they match your new copy.</p>
              </div>

              <div className="composer-two-fields">
                <div><label htmlFor="composer-platform">Platform</label><select id="composer-platform" value={platform} onChange={(e) => room.setSetting('platform', e.target.value)} required>
                  {PLATFORMS.map((item) => <option key={item} value={item}>{platformNames[item]}</option>)}
                </select></div>
                <div><label htmlFor="composer-audience">Test audience</label><select id="composer-audience" value={audienceId} onChange={(e) => room.setSetting('audienceId', e.target.value)} required aria-describedby="composer-audience-hint">
                  <option value="" disabled hidden>Choose an audience</option>
                  {initialPost?.audienceId && !audiences.some((a) => a._id === initialPost.audienceId) && <option value={initialPost.audienceId} disabled>Unavailable — choose another</option>}
                  {audiences.map((item) => <option key={item._id} value={item._id}>{item.title}</option>)}
                </select></div>
              </div>
              <p className="composer-hint" id="composer-audience-hint">{selectedAudience?.description || 'Choose the people who will react in your simulation.'}</p>

              <div className="composer-divider" />
              <label htmlFor="composer-brand">Who’s speaking?</label>
              <select id="composer-brand" value={brandId} onChange={(e) => room.setSetting('brandId', e.target.value)} required>
                <option value={NEW_BRAND}>Create my brand</option>
                {initialPost?.brandId && !brands.some((b) => b._id === initialPost.brandId) && <option value={initialPost.brandId} disabled>Unavailable — choose another</option>}
                {brands.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              {brandId === NEW_BRAND ? <div className="composer-brand-fields">
                <div><label htmlFor="composer-brand-name">Brand name <span>Optional</span></label><CollabField room={room} field="brandName" id="composer-brand-name" maxLength={100} placeholder="My brand" autoComplete="organization" /></div>
                <div><label htmlFor="composer-brand-voice">Brand voice <span>Optional</span></label><CollabField room={room} field="brandVoice" multiline id="composer-brand-voice" maxLength={1000} rows={2} placeholder="e.g. Warm, straightforward, a little playful" /></div>
                <p className="composer-hint">A new brand is created with this draft. Leave the name blank to use “My brand”.</p>
              </div> : <p className="composer-hint">{selectedBrand?.voice || 'This draft will use the selected brand. Its existing settings won’t change.'}</p>}
              {accessCodeRequired && <div className="composer-access">
                <label htmlFor="composer-access-code">Demo access code</label><input type="password" id="composer-access-code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required autoComplete="off" maxLength={256} aria-describedby="composer-access-hint" />
                <p className="composer-hint" id="composer-access-hint">Provided by the demo host. Held only for this save, never stored by the composer or shared with the room. This is not a user account.</p>
              </div>}
            </fieldset>
          </section>

          <aside className="composer-preview" aria-labelledby="composer-preview-title">
            <div className="composer-section-heading"><h2 id="composer-preview-title">A view from the feed</h2><span>02 / PREVIEW</span></div>
            <div className="composer-preview-stage">
              <div className="composer-preview-caption"><span>{platformNames[platform] || 'Social'} preview</span><span>NOT PUBLISHED</span></div>
              <article className="composer-social-card" aria-label="Live preview of your post">
                <header><span className="composer-brand-avatar" aria-hidden="true">{previewName.slice(0, 1).toUpperCase()}</span><div><strong>{previewName}</strong><span>{selectedBrand?.handle || 'Your original post'} · Just now</span></div><span className="composer-social-more" aria-hidden="true">···</span></header>
                <p className={`composer-social-copy${body ? '' : ' composer-placeholder'}`}>{body ? <HighlightedCopy body={body} notes={notes} focusId={focusNote} onFocusNote={setFocusNote} /> : 'Your words go here. Write something worth a second look.'}</p>
                {typingPeers.length > 0 && <p className="preview-typing" style={{['--c' as any]: typingPeers[0].user.color}}><span className="typing-dots"><i /><i /><i /></span>{typingPeers.map((p) => p.user.name).join(', ')} {typingPeers.length > 1 ? 'are' : 'is'} writing…</p>}
                <div className="composer-social-footer" aria-hidden="true"><span>Like</span><span>Comment</span><span>Share</span></div>
              </article>
              <p className="composer-preview-disclaimer">Text preview only. Final formatting varies by platform.</p>
            </div>
            <NotesPanel room={room} notes={notes} disabled={fieldsDisabled} focusId={focusNote} onFocusNote={setFocusNote} onJump={jumpTo} />
            <div className="composer-next"><span className="composer-next-number">↗</span><div><h3>A rehearsal, not a release.</h3><p>Save to your workspace first. In the live room, start a simulation when you’re ready. Nothing is posted to social media.</p></div></div>
            <div className="composer-summary"><span>TESTING WITH</span><strong>{selectedAudience?.title || 'Your chosen audience'}</strong></div>
            {initialPost && <p className="composer-revision-note">Changing copy or settings creates a new revision and returns the post to draft. Earlier simulation runs stay in its history.</p>}
          </aside>
        </div>

        <div className="composer-error" role="alert" tabIndex={-1} ref={errorRef} hidden={!error}>
          <strong>Draft not saved</strong><p>{error}</p>
          {conflict && <p>The room still has everyone’s text. Reload to pick up the latest saved revision before saving again.</p>}
        </div>
        <div className="composer-actions">
          <div><p role="status" aria-live="polite">{status || (room.status === 'offline' ? 'Offline: edits are kept in this browser and sync when the connection returns.' : 'Saved drafts open in the live room. You control what happens next.')}</p><span>Shared demo workspace · Anyone with this link can co-write · Don’t include private or sensitive content.</span></div>
          <div className="composer-action-buttons">
            <button type="submit" className="composer-button composer-secondary" disabled={busy || !canSave}>Save draft</button>
            <button type="submit" ref={primaryRef} className="composer-button composer-primary" disabled={busy || !canSave}>{busy ? 'Saving…' : 'Save & open simulation →'}</button>
          </div>
        </div>
      </form>
      <ActivityToasts room={room} describe={describeSetting} />
    </main>
  )
}
