import * as Y from 'yjs'

/**
 * Shape of a co-writing room (one Y.Doc):
 *   text:<field>  Y.Text  – title, body, media description, new-brand name/voice
 *   settings      Y.Map   – platform, audienceId, brandId (last writer wins)
 *   settingsBy    Y.Map   – who last changed each setting, for the activity line
 *   notes         Y.Array<Y.Map> – margin notes anchored with Y.RelativePosition
 *   meta          Y.Map   – base (the saved post this room started from), saved
 */

export const TEXT_FIELDS = ['title', 'body', 'mediaDescription', 'brandName', 'brandVoice'] as const
export type TextField = (typeof TEXT_FIELDS)[number]
export const FIELD_LABEL: Record<TextField, string> = {
  title: 'Internal title',
  body: 'Post copy',
  mediaDescription: 'Media description',
  brandName: 'Brand name',
  brandVoice: 'Brand voice',
}

export type SettingKey = 'platform' | 'audienceId' | 'brandId'

/** Transaction origin for edits typed in this tab. Only these are undoable by "my" undo. */
export const LOCAL_ORIGIN = {source: 'local-edit'}

export const getText = (doc: Y.Doc, field: TextField) => doc.getText(`text:${field}`)
export const getSettings = (doc: Y.Doc) => doc.getMap<string>('settings')
export const getSettingsBy = (doc: Y.Doc) => doc.getMap<Author & {at: number}>('settingsBy')
export const getMeta = (doc: Y.Doc) => doc.getMap<any>('meta')
export const getNotes = (doc: Y.Doc) => doc.getArray<Y.Map<any>>('notes')

export type Author = {name: string; color: string}
export type RoomBase = {postId: string; revision: number; rev: string}
export type SavedMarker = {postId: string; revision: number; by: string; color: string; at: number}

// ---------------------------------------------------------------- deterministic seed
export type SeedPost = {
  postId: string; revision: number; rev: string
  title: string; body: string; mediaDescription?: string
  platform?: string; audienceId?: string; brandId?: string
}

/** Fixed client id: two servers seeding the same post produce byte-identical updates. */
export const SEED_CLIENT_ID = 1

export function seedUpdate(post: SeedPost): Uint8Array {
  const doc = new Y.Doc()
  doc.clientID = SEED_CLIENT_ID
  doc.transact(() => {
    getText(doc, 'title').insert(0, post.title || '')
    getText(doc, 'body').insert(0, post.body || '')
    getText(doc, 'mediaDescription').insert(0, post.mediaDescription || '')
    const settings = getSettings(doc)
    if (post.platform) settings.set('platform', post.platform)
    if (post.audienceId) settings.set('audienceId', post.audienceId)
    if (post.brandId) settings.set('brandId', post.brandId)
    getMeta(doc).set('base', {postId: post.postId, revision: post.revision, rev: post.rev} satisfies RoomBase)
  })
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

// ---------------------------------------------------------------- margin notes
export type NoteReply = Author & {text: string; at: number}
export type NoteView = {
  id: string
  kind: 'human' | 'analyst'
  author: string
  color: string
  text: string
  quote: string
  createdAt: number
  resolved: boolean
  replies: NoteReply[]
  /** Live range in the current body, or null when the anchored words were deleted. */
  range: {start: number; end: number} | null
  current: string
}

export function createNote(
  doc: Y.Doc,
  input: {start: number; end: number; text: string; author: Author; kind?: 'human' | 'analyst'; id?: string},
) {
  const body = getText(doc, 'body')
  const start = Math.max(0, Math.min(input.start, body.length))
  const end = Math.max(start, Math.min(input.end, body.length))
  if (end === start) return null
  const id = input.id || `n-${Math.random().toString(36).slice(2, 10)}`
  doc.transact(() => {
    const note = new Y.Map<any>()
    note.set('id', id)
    note.set('kind', input.kind || 'human')
    note.set('author', input.author.name)
    note.set('color', input.author.color)
    note.set('text', input.text.slice(0, 600))
    note.set('quote', body.toString().slice(start, end))
    note.set('createdAt', Date.now())
    note.set('resolved', false)
    // assoc 0 = sticks to the first quoted char; assoc -1 = sticks to the last one.
    // Text typed just outside the quote is therefore never pulled into the note.
    note.set('start', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(body, start, 0)))
    note.set('end', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(body, end, -1)))
    note.set('replies', new Y.Array<NoteReply>())
    getNotes(doc).push([note])
  }, LOCAL_ORIGIN)
  return id
}

export function resolveRange(doc: Y.Doc, startBytes: Uint8Array, endBytes: Uint8Array) {
  try {
    const s = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(startBytes), doc)
    const e = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(endBytes), doc)
    if (!s || !e || e.index <= s.index) return null
    return {start: s.index, end: e.index}
  } catch {
    return null
  }
}

export function readNotes(doc: Y.Doc): NoteView[] {
  const body = getText(doc, 'body').toString()
  const seen = new Set<string>()
  const out: NoteView[] = []
  for (const note of getNotes(doc).toArray()) {
    const id = note.get('id')
    if (!id || seen.has(id)) continue // concurrent creation of the same analyst note
    seen.add(id)
    const range = note.get('start') && note.get('end') ? resolveRange(doc, note.get('start'), note.get('end')) : null
    const replies = note.get('replies') as Y.Array<NoteReply> | undefined
    out.push({
      id,
      kind: note.get('kind') === 'analyst' ? 'analyst' : 'human',
      author: note.get('author') || 'Someone',
      color: note.get('color') || '#d5f58d',
      text: note.get('text') || '',
      quote: note.get('quote') || '',
      createdAt: note.get('createdAt') || 0,
      resolved: !!note.get('resolved'),
      replies: replies ? replies.toArray() : [],
      range,
      current: range ? body.slice(range.start, range.end) : '',
    })
  }
  return out
}

export function findNote(doc: Y.Doc, id: string) {
  return getNotes(doc).toArray().find((n) => n.get('id') === id)
}

/** Stable id for an analyst flag, so two editors opening the same link create one note. */
export function flagNoteId(phrase: string) {
  let h = 2166136261
  for (let i = 0; i < phrase.length; i++) h = Math.imul(h ^ phrase.charCodeAt(i), 16777619)
  return `flag-${(h >>> 0).toString(36)}`
}

/** Locate an analyst phrase in the body: exact first, then case-insensitive. */
export function locatePhrase(body: string, phrase: string) {
  const needle = phrase.trim()
  if (!needle) return null
  let at = body.indexOf(needle)
  if (at < 0) at = body.toLowerCase().indexOf(needle.toLowerCase())
  return at < 0 ? null : {start: at, end: at + needle.length}
}
