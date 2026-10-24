/**
 * Wire protocol for the co-writing room. Isomorphic: imported by the browser
 * provider, the API routes and the offline tests.
 *
 * Transport: Vercel functions cannot hold WebSockets, so Yjs updates travel
 *   browser --POST--> route handler --> Sanity document (collabUpdate)
 *   Sanity listener --> SSE route --> every other browser in the room.
 * Yjs updates are commutative and idempotent, so duplicates, reordering and
 * replays after a reconnect are all harmless.
 */

export const MAX_UPDATE_BYTES = 64 * 1024 // one merged batch from one client
export const MAX_ROOM_BYTES = 1024 * 1024 // a draft room never needs more than this
export const MAX_AWARENESS_BYTES = 4 * 1024
export const COMPACT_AFTER = 40 // merge update docs into the snapshot after this many
export const PRESENCE_STALE_MS = 60_000

const POST_ROOM = /^post\.([a-zA-Z0-9][a-zA-Z0-9_.-]{0,100})\.r(\d{1,6})$/
const DRAFT_ROOM = /^draft\.[a-zA-Z0-9-]{8,64}$/

export function isRoomId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 120) return false
  if (DRAFT_ROOM.test(value)) return true
  const m = POST_ROOM.exec(value)
  return !!m && !/^(drafts|versions|system)\./.test(m[1])
}

/** One room per saved revision: a new revision starts from the saved copy. */
export const postRoom = (postId: string, revision?: number) => `post.${postId}.r${revision || 1}`

export function parsePostRoom(room: string): {postId: string; revision: number} | null {
  const m = POST_ROOM.exec(room)
  return m ? {postId: m[1], revision: Number(m[2])} : null
}

export function newDraftRoom(uuid: string) {
  return `draft.${uuid}`
}

export function isClientId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 2 ** 32
}

// ---------------------------------------------------------------- base64 (browser + node)
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export const base64Bytes = (value: string) => Math.floor((value.length * 3) / 4)

// ---------------------------------------------------------------- payloads
export type RoomState = {
  room: string
  /** Full merged document state (base64 Yjs update). */
  state: string
  /** State vector of `state`, so a client can push exactly what the server lacks. */
  vector: string
  /** Awareness updates of people currently in the room (base64). */
  presence: string[]
}

export type StreamEvent =
  | {type: 'ready'}
  | {type: 'update'; id: string; update: string; client?: number}
  | {type: 'presence'; client: number; update: string | null}
