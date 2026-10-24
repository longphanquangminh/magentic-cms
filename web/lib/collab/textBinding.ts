/**
 * Minimal, dependency-free binding helpers between a native <input>/<textarea>
 * and a Y.Text. Kept pure so they can be tested without a DOM.
 */

export type TextChange = {index: number; remove: number; insert: string}
type DeltaOp = {insert?: string | object; delete?: number; retain?: number}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * Smallest single splice turning `prev` into `next`. `cursor` (selectionEnd after
 * the edit) disambiguates repeated characters: typing "a" between "a|a" is an
 * insert at 1, not at 2. Never splits a surrogate pair (emoji, rare CJK).
 */
export function diffText(prev: string, next: string, cursor?: number | null): TextChange | null {
  if (prev === next) return null
  const maxSuffix = Math.min(prev.length, next.length, cursor == null ? Infinity : Math.max(0, next.length - cursor))
  let suffix = 0
  while (suffix < maxSuffix && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++
  const maxPrefix = Math.min(prev.length - suffix, next.length - suffix)
  let prefix = 0
  while (prefix < maxPrefix && prev[prefix] === next[prefix]) prefix++
  if (prefix > 0 && isLowSurrogate(next.charCodeAt(prefix)) ) prefix--
  if (suffix > 0 && isLowSurrogate(next.charCodeAt(next.length - suffix))) suffix--
  return {index: prefix, remove: prev.length - suffix - prefix, insert: next.slice(prefix, next.length - suffix)}
}

/**
 * Move a caret/selection index through a remote Y.Text delta. A remote insert
 * exactly at the caret stays after the caret's left neighbour (we don't jump),
 * deletions before the caret pull it left.
 */
export function transformIndex(index: number, delta: DeltaOp[]): number {
  let pos = 0
  let shift = 0
  for (const op of delta) {
    if (pos > index) break
    if (op.retain != null) {
      pos += op.retain
    } else if (op.insert != null) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1
      if (pos < index) shift += len
    } else if (op.delete != null) {
      if (pos < index) shift -= Math.min(op.delete, index - pos)
      pos += op.delete
    }
  }
  return Math.max(0, index + shift)
}

/** Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y → 'undo' | 'redo' | null */
export function historyKey(e: {key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean}) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !e.shiftKey) return 'redo'
  return null
}
