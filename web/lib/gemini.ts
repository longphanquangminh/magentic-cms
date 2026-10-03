import 'server-only'
import {requestJSON} from './modelTransport'

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash'
/** Cheaper/faster model for the crowd (many calls); MODEL is used for the analyst. */
export const CROWD_MODEL = process.env.GEMINI_CROWD_MODEL || 'gemini-3.5-flash-lite'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

type Schema = Record<string, unknown>

/**
 * Calls Gemini in JSON mode with a response schema, retrying on rate limits.
 * Returns the parsed JSON object.
 */
export async function geminiJSON<T>(opts: {
  system: string
  prompt: string
  schema: Schema
  temperature?: number
  model?: string
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY || ''
  const model = opts.model || MODEL
  const body = {
    systemInstruction: {parts: [{text: opts.system}]},
    contents: [{role: 'user', parts: [{text: opts.prompt}]}],
    generationConfig: {
      temperature: opts.temperature ?? 1,
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
    },
  }

  const fallback = (process.env.GEMINI_FALLBACK_MODEL || '').split(',').map(x => x.trim()).filter(Boolean).slice(0,1)
  return requestJSON<T>({key, models: [model, ...fallback], body})
}
