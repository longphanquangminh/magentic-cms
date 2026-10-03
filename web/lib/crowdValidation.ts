const ACTIONS = ['scroll','react','comment','reply','share']
const EMOJI = ['none','like','love','haha','wow','sad','angry']
const FLAGS = ['none','offensive','insensitive','misleading','tone_deaf','legal','off_brand']

/** An omitted persona is not evidence of scrolling. Reject the whole affected batch. */
export function validateCrowdBatch(rows: unknown, expected: string[]): any[] {
  if (!Array.isArray(rows) || rows.length !== expected.length) throw new Error('Incomplete crowd response. Missing personas remain pending.')
  const remaining = new Set(expected)
  const clean = []
  for (const input of rows) {
    if (!input || typeof input !== 'object') throw new Error('Invalid crowd response.')
    const r: any = input
    const id = String(r.personaId || '').replace(/^\[|\]$/g, '')
    if (!remaining.delete(id) || !ACTIONS.includes(r.action) || !EMOJI.includes(r.emoji) ||
      !FLAGS.includes(r.flagCategory) || typeof r.sentiment !== 'number' || !Number.isFinite(r.sentiment) ||
      r.sentiment < -1 || r.sentiment > 1 ||
      (['comment','reply','share'].includes(r.action) && (typeof r.text !== 'string' || !r.text.trim()))) {
      throw new Error('Invalid or duplicated persona output. The affected batch remains pending.')
    }
    clean.push({...r, personaId: id})
  }
  return clean
}
