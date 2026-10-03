// Pure scoring functions. Shared by the server (final numbers stored on the
// run) and the browser (live meters while the run streams in), so the number
// you watch climb is the same number that gets saved.

export type Emoji = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry'
export const EMOJI: Emoji[] = ['like', 'love', 'haha', 'wow', 'sad', 'angry']

export type ReactionLite = {
  _id: string
  action: 'scroll' | 'react' | 'comment' | 'reply' | 'share'
  emoji?: Emoji | null
  sentiment?: number | null
  likes?: number | null
  flag?: {category?: string | null} | null
  replyTo?: {_ref: string} | null
  persona?: Record<string, any> | null
}

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const r2 = (x: number) => Math.round(x * 100) / 100

export function computeMetrics(rs: ReactionLite[]) {
  const n = rs.length
  const engaged = rs.filter((r) => r.action !== 'scroll')
  const comments = rs.filter((r) => r.action === 'comment').length
  const replies = rs.filter((r) => r.action === 'reply').length
  const shares = rs.filter((r) => r.action === 'share').length
  const flagged = rs.filter((r) => r.flag?.category).length
  const emoji = Object.fromEntries(EMOJI.map((e) => [e, 0])) as Record<Emoji, number>
  rs.forEach((r) => r.emoji && emoji[r.emoji] !== undefined && emoji[r.emoji]++)
  const emojiTotal = EMOJI.reduce((a, e) => a + emoji[e], 0)

  const sent = engaged.map((r) => r.sentiment ?? 0)
  const avgSentiment = sent.length ? sent.reduce((a, b) => a + b, 0) / sent.length : 0
  const negShare = engaged.length ? engaged.filter((r) => (r.sentiment ?? 0) <= -0.3).length / engaged.length : 0
  const intensity = sent.length ? sent.reduce((a, b) => a + Math.abs(b), 0) / sent.length : 0

  // Amplification: of all likes on comments, how many went to negative ones.
  const talk = rs.filter((r) => r.action === 'comment' || r.action === 'reply')
  const likeSum = talk.reduce((a, r) => a + (r.likes || 0), 0)
  const negLikes = talk.filter((r) => (r.sentiment ?? 0) <= -0.3).reduce((a, r) => a + (r.likes || 0), 0)
  const negAmplification = likeSum ? negLikes / likeSum : negShare

  const angryShare = emojiTotal ? (emoji.angry + emoji.sad * 0.5) / emojiTotal : 0
  const flaggedShare = n ? flagged / n : 0

  const backlashRisk = Math.round(
    100 * clamp(0.35 * negShare + 0.25 * clamp(flaggedShare * 3) + 0.15 * angryShare + 0.25 * negAmplification),
  )

  const engagementRate = n ? engaged.length / n : 0
  const shareRate = n ? shares / n : 0
  const replyDepth = comments ? replies / comments : 0
  const trendScore = Math.round(
    100 * clamp(0.4 * engagementRate + 0.3 * clamp(shareRate * 4) + 0.2 * clamp(replyDepth) + 0.1 * intensity),
  )

  const quadrant =
    trendScore >= 50 ? (backlashRisk >= 45 ? 'viral_bad' : 'viral_good') : backlashRisk >= 45 ? 'quiet_risky' : 'quiet_safe'

  return {
    backlashRisk,
    trendScore,
    engagementRate: r2(engagementRate),
    avgSentiment: r2(avgSentiment),
    comments,
    replies,
    shares,
    scrolledPast: n - engaged.length,
    flagged,
    emoji,
    quadrant,
    n,
  }
}

export const COHORT_DIMENSIONS = ['generation', 'region', 'politicalLean', 'householdIncome', 'religion'] as const

export function computeCohorts(rs: ReactionLite[], minN = 3) {
  const out: {dimension: string; value: string; n: number; avgSentiment: number; negativeShare: number}[] = []
  for (const dim of COHORT_DIMENSIONS) {
    const groups = new Map<string, ReactionLite[]>()
    rs.forEach((r) => {
      const v = r.persona?.[dim]
      if (!v) return
      groups.set(v, [...(groups.get(v) || []), r])
    })
    groups.forEach((g, value) => {
      if (g.length < minN) return
      const s = g.map((r) => (r.action === 'scroll' ? 0 : r.sentiment ?? 0))
      out.push({
        dimension: dim,
        value,
        n: g.length,
        avgSentiment: r2(s.reduce((a, b) => a + b, 0) / g.length),
        negativeShare: r2(g.filter((r) => (r.sentiment ?? 0) <= -0.3).length / g.length),
      })
    })
  }
  return out.sort((a, b) => a.avgSentiment - b.avgSentiment)
}
