import {failure, json, readJson, roomParam} from '@/lib/collab/http'
import {isClientId} from '@/lib/collab/protocol'
import {RoomError, writePresence} from '@/lib/collab/room'
import {sanityCollabStore} from '@/lib/collab/sanityStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Awareness (name, colour, caret) of one tab. `update: null` = the tab left. */
export async function POST(req: Request, {params}: {params: Promise<{room: string}>}) {
  try {
    const room = await roomParam(params)
    const body = await readJson(req, 8_000)
    if (!isClientId(body.client)) throw new RoomError('Invalid client id.')
    await writePresence(sanityCollabStore, room, body.client, body.update ?? null)
    return json({ok: true})
  } catch (error) {
    return failure(error)
  }
}
