import {sanity} from '@/lib/sanity'
import {failure, roomParam} from '@/lib/collab/http'
import type {StreamEvent} from '@/lib/collab/protocol'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * SSE fan-out for a co-writing room, bridged from Sanity's real-time listener
 * (same pattern as /api/runs/[id]/stream). Unlike the run stream, events carry
 * the Yjs payload itself, so remote keystrokes need no extra round-trip.
 *
 * `ready` is sent on (re)connect of the upstream listener. The browser answers
 * every `ready` with a full resync, which closes any gap: Yjs updates are
 * idempotent, so receiving something twice is harmless.
 */
export async function GET(req: Request, {params}: {params: Promise<{room: string}>}) {
  let room: string
  try { room = await roomParam(params) } catch (error) { return failure(error) }
  const enc = new TextEncoder()
  let sub: {unsubscribe(): void} | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  const stop = () => { sub?.unsubscribe(); if (ping) clearInterval(ping) }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StreamEvent | {type: 'ping'}) => {
        try { controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) } catch { /* closed */ }
      }
      sub = sanity
        .listen(
          `*[_type in ["collabUpdate", "collabPresence"] && room == $room]`,
          {room},
          {includeResult: true, includePreviousRevision: false, events: ['welcome', 'mutation', 'reconnect']},
        )
        .subscribe({
          next: (ev: any) => {
            if (ev.type === 'welcome' || ev.type === 'reconnect') return send({type: 'ready'})
            if (ev.type !== 'mutation') return
            const id: string = ev.documentId || ''
            if (id.startsWith('collabUpdate.')) {
              if (ev.transition === 'appear' && ev.result?.data) send({type: 'update', id, update: ev.result.data, client: ev.result.client ?? undefined})
            } else if (id.startsWith('collabPresence.')) {
              const client = Number(id.split('.').pop())
              if (!Number.isInteger(client)) return
              send({type: 'presence', client, update: ev.transition === 'disappear' ? null : ev.result?.data ?? null})
            }
          },
          error: () => { try { controller.close() } catch {} }, // EventSource reconnects and resyncs
        })
      ping = setInterval(() => send({type: 'ping'}), 15000)
      req.signal.addEventListener('abort', () => { stop(); try { controller.close() } catch {} })
    },
    cancel: stop,
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
