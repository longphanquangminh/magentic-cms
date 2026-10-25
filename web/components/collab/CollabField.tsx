'use client'

import {useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes} from 'react'
import * as Y from 'yjs'
import {LOCAL_ORIGIN, type TextField} from '@/lib/collab/schema'
import {diffText, historyKey, transformIndex} from '@/lib/collab/textBinding'
import {caretCoordinates} from './caret'
import type {CollabRoom, PeerState} from './useCollabRoom'
import {useYText} from './useCollabRoom'

type Shared = {
  room: CollabRoom
  field: TextField
  /** Called with the local selection whenever it changes (body uses it for notes). */
  onSelection?: (start: number, end: number) => void
  className?: string
}
type Props =
  | (Shared & {multiline?: false} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'className'>)
  | (Shared & {multiline: true} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange' | 'className'>)

type Field = HTMLInputElement | HTMLTextAreaElement

/**
 * A native input/textarea bound to a Y.Text:
 *  - local typing becomes a minimal Y.Text splice (works with Vietnamese IMEs,
 *    autocorrect and paste, since it diffs the value rather than the key)
 *  - remote edits rewrite the value and move the caret through the Yjs delta
 *  - remote updates are deferred while an IME composition is open
 *  - Ctrl/Cmd+Z undoes only this person's edits (Y.UndoManager)
 *  - other writers' carets are drawn on top, from relative positions in awareness
 */
export default function CollabField(props: Props) {
  const {room, field, onSelection, className, multiline, ...rest} = props as Shared & {multiline?: boolean} & Record<string, any>
  const ytext = room.texts[field]
  const ref = useRef<Field>(null)
  const composing = useRef(false)
  const deferred = useRef<any[][]>([])
  const [, setLayoutTick] = useState(0)
  const value = useYText(ytext)
  const onSelectionRef = useRef(onSelection)
  onSelectionRef.current = onSelection

  // initial value + remote changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.value = ytext.toString()
    const apply = (deltas: any[][]) => {
      const node = ref.current
      if (!node) return
      const next = ytext.toString()
      if (node.value === next) return
      const focused = document.activeElement === node
      let start = node.selectionStart ?? 0
      let end = node.selectionEnd ?? 0
      for (const delta of deltas) { start = transformIndex(start, delta); end = transformIndex(end, delta) }
      const {scrollTop, scrollLeft} = node
      node.value = next
      start = Math.min(start, next.length); end = Math.min(end, next.length)
      if (focused) node.setSelectionRange(start, end)
      // keep the parent's copy of the selection (used for "Note on …") aligned with the moved text
      onSelectionRef.current?.(start, end)
      node.scrollTop = scrollTop
      node.scrollLeft = scrollLeft
    }
    const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN) return
      if (composing.current) { deferred.current.push(event.delta as any[]); return }
      apply([event.delta as any[]])
    }
    ytext.observe(observer)
    ;(el as any).__applyDeferred = () => { const d = deferred.current; deferred.current = []; if (d.length) apply(d) }
    return () => ytext.unobserve(observer)
  }, [ytext])

  // remote carets need a re-measure on scroll / resize
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bump = () => setLayoutTick((t) => t + 1)
    el.addEventListener('scroll', bump)
    const ro = new ResizeObserver(bump)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', bump); ro.disconnect() }
  }, [])

  const publishSelection = () => {
    const el = ref.current
    if (!el || document.activeElement !== el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    onSelection?.(start, end)
    room.setCursor({
      field,
      anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, start)),
      head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, end)),
    })
  }

  useEffect(() => {
    const onSelectionChange = () => { if (document.activeElement === ref.current) publishSelection() }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  })

  const onInput = () => {
    const el = ref.current
    if (!el) return
    const change = diffText(ytext.toString(), el.value, el.selectionEnd)
    if (!change) return
    room.doc.transact(() => {
      if (change.remove) ytext.delete(change.index, change.remove)
      if (change.insert) ytext.insert(change.index, change.insert)
    }, LOCAL_ORIGIN)
    room.markTyping()
    publishSelection()
  }

  const handlers = {
    ref: ref as any,
    className: `collab-input ${className || ''}`,
    onInput,
    onChange: () => {}, // uncontrolled on purpose: Yjs owns the value
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: () => { composing.current = false; onInput(); (ref.current as any)?.__applyDeferred?.() },
    onFocus: publishSelection,
    onBlur: () => room.setCursor(null),
    onKeyDown: (e: React.KeyboardEvent<Field>) => {
      const action = historyKey(e)
      if (!action) return (rest.onKeyDown as any)?.(e)
      e.preventDefault()
      if (action === 'undo') room.undo.undo(); else room.undo.redo()
    },
  }

  const here = room.peers.filter((p) => p.cursor?.field === field)
  return (
    <div className={`collab-field ${multiline ? 'is-multiline' : ''} ${here.length ? 'has-peers' : ''}`} style={here.length ? {['--peer' as any]: here[0].user.color} : undefined}>
      {multiline ? <textarea {...rest} {...handlers} /> : <input {...rest} {...handlers} />}
      <RemoteCarets el={ref.current} peers={here} doc={room.doc} ytext={ytext} value={value} />
    </div>
  )
}

function RemoteCarets({el, peers, doc, ytext, value}: {el: Field | null; peers: PeerState[]; doc: Y.Doc; ytext: Y.Text; value: string}) {
  if (!el || !peers.length || typeof window === 'undefined') return null
  const resolve = (json: unknown) => {
    try {
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc)
      return abs && abs.type === ytext ? abs.index : null
    } catch { return null }
  }
  return (
    <div className="collab-carets" aria-hidden="true" data-len={value.length}>
      {peers.map((peer) => {
        const head = resolve(peer.cursor?.head)
        if (head == null) return null
        const anchor = resolve(peer.cursor?.anchor) ?? head
        const pos = caretCoordinates(el, head)
        const top = el.offsetTop + pos.top
        const left = el.offsetLeft + pos.left
        if (pos.top < -2 || pos.top > el.clientHeight - 4 || pos.left < 0 || pos.left > el.clientWidth + 2) return null
        const typing = (peer.typingUntil || 0) > Date.now()
        return (
          <span key={peer.clientId} className={`collab-caret ${typing ? 'is-typing' : ''}`} style={{top, left, height: pos.height, ['--c' as any]: peer.user.color}}>
            <span className="collab-caret-flag">{peer.user.name}{anchor !== head ? ` · ${Math.abs(head - anchor)} selected` : ''}</span>
          </span>
        )
      })}
    </div>
  )
}
