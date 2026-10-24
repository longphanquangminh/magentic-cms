import {failure, json, readJson, roomParam} from '@/lib/collab/http'
import {isClientId} from '@/lib/collab/protocol'
import {readRoom, writeUpdate} from '@/lib/collab/room'
import {sanityCollabStore} from '@/lib/collab/sanityStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Full room state for a joining (or reconnecting) browser. Seeds post rooms on first visit. */
export async function GET(_req: Request, {params}: {params: Promise<{room: string}>}) {
  try {
    return json(await readRoom(sanityCollabStore, await roomParam(params)))
  } catch (error) {
    return failure(error)
  }
}

/** One merged batch of Yjs updates from one browser. Fanned out by the stream route. */
export async function POST(req: Request, {params}: {params: Promise<{room: string}>}) {
  try {
    const room = await roomParam(params)
    const body = await readJson(req, 96_000)
    const id = await writeUpdate(sanityCollabStore, room, body.update, isClientId(body.client) ? body.client : undefined)
    return json({ok: true, id}, 201)
  } catch (error) {
    return failure(error)
  }
}
