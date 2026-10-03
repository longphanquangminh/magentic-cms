import {sanity} from '@/lib/sanity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Server-Sent Events bridge over Sanity's real-time listener.
 * The browser never sees the token: we subscribe to the Content Lake here and
 * forward lightweight "something changed" pings; the client then pulls the delta.
 */
export async function GET(req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const enc = new TextEncoder()
  let sub: {unsubscribe(): void} | null = null
  let ping: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* closed */
        }
      }
      send('ready', {id})
      sub = sanity
        .listen(`*[(_type == "reaction" && run._ref == $id) || _id == $id]`, {id}, {includeResult: false, visibility: 'query'})
        .subscribe({
          next: (ev: any) => {
            if (ev.type === 'mutation') send('change', {doc: ev.documentId, t: ev.transition})
          },
          error: (err: any) => send('error', {message: String(err?.message || err)}),
        })
      ping = setInterval(() => send('ping', Date.now()), 15000)
      req.signal.addEventListener('abort', () => {
        sub?.unsubscribe()
        if (ping) clearInterval(ping)
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      sub?.unsubscribe()
      if (ping) clearInterval(ping)
    },
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
