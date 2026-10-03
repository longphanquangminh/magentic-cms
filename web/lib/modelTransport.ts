export class ModelError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ModelError' }
}

/** Bounded, explicit failover. Never returns fabricated model output or raw provider errors. */
export async function requestJSON<T>(opts: {
  key: string; models: string[]; body: unknown; fetcher?: typeof fetch;
  timeoutMs?: number; budgetMs?: number; sleep?: (ms: number) => Promise<void>
}): Promise<T> {
  if (!opts.key) throw new ModelError('missing_key', 'Gemini key is missing. Add GEMINI_API_KEY on the server, then retry. Saved-session Replay does not use a model.')
  const fetcher = opts.fetcher || fetch
  const wait = opts.sleep || ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const end = Date.now() + (opts.budgetMs || 43000)
  let last = new ModelError('unavailable', 'The model is temporarily unavailable. Progress is saved; retry or replay a saved session.')
  for (const model of [...new Set(opts.models.filter(Boolean))]) {
    for (let attempt = 0; attempt < 2 && Date.now() < end; attempt++) {
      try {
        const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: {'content-type': 'application/json', 'x-goog-api-key': opts.key},
          body: JSON.stringify(opts.body), signal: AbortSignal.timeout(Math.max(1, Math.min(opts.timeoutMs || 18000, end-Date.now()))),
        })
        if (res.status === 401 || res.status === 403) throw new ModelError('auth', 'Gemini rejected this key or its permissions. Check the key and API access, then retry. No reactions were invented.')
        if (res.ok) {
          const d = await res.json()
          const text = (d?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('')
          try { return JSON.parse(text) as T } catch { last = new ModelError('invalid_response', 'The model returned an incomplete response. This batch stays pending; retry when ready.') }
        } else {
          // Provider error bodies can include input data. Do not log or surface them.
          last = res.status === 429
            ? new ModelError('quota', 'Gemini quota or rate limit reached. Progress is saved. Wait, check billing/quota, or use saved-session Replay.')
            : res.status === 404
            ? new ModelError('model_not_found', 'Configured model is unavailable for this key. Check GEMINI_MODEL and GEMINI_CROWD_MODEL, then retry.')
            : new ModelError('unavailable', `Model request failed (HTTP ${res.status}). Progress is saved; retry or use saved-session Replay.`)
          if (res.status < 500 && res.status !== 429 && res.status !== 404) throw last
          if (res.status === 404) break
        }
      } catch (e) {
        if (e instanceof ModelError) throw e
        last = new ModelError('network', 'Model connection timed out or failed. Progress is saved; retry when the connection returns.')
      }
      if (!attempt && Date.now()+750 < end) await wait(750)
    }
  }
  throw last
}
