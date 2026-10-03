import 'server-only'
import {validateCrowdBatch} from './crowdValidation'
import {sanity, ref, notDraft} from './sanity'
import {geminiJSON, MODEL, CROWD_MODEL} from './gemini'
import {computeCohorts, computeMetrics, EMOJI, type ReactionLite} from './metrics'
import {transition, type ActorInfo} from './workflowEngine'

const BATCH = Math.max(1, Math.min(16, Math.floor(Number(process.env.SIM_BATCH_SIZE) || 8))) // personas per model call
const PARALLEL = Math.max(1, Math.min(2, Math.floor(Number(process.env.SIM_PARALLEL_CALLS) || 2))) // model calls per step
export const MAX_PERSONAS = Math.max(5, Math.min(120, Math.floor(Number(process.env.SIM_MAX_PERSONAS) || 120)))

const PERSONA_FIELDS = `_id, handle, summary, region, generation, ageBracket, gender, politicalLean, religiosity,
  householdIncome, shoppingStyle, tone, mood, urbanicity, traits, attitudes`

const shortId = (id: string) => id.replace(/^persona-/, '').slice(0, 10)

function shuffle<T>(arr: T[]) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------------------------------------------------------------- create run

export async function createRun(postId: string, actor: ActorInfo, size?: number) {
  const post = await sanity.fetch(
    `*[_id == $id][0]{_id, title, body, mediaDescription, stage, revision, "audience": audience->{title, groqFilter, sampleSize}}`,
    {id: postId},
  )
  if (!post) throw new Error('Post not found. Publish it in Studio first.')

  const running = await sanity.fetch(
    `*[_type == "simulationRun" && post._ref == $id && status in ["running", "analyzing", "paused"]][0]._id`,
    {id: postId},
  )
  if (running) return {runId: running as string, resumed: true}

  const filter = post.audience?.groqFilter?.trim() || 'true'
  const ids: string[] = await sanity.fetch(`*[_type == "persona" && ${notDraft} && (${filter})]._id`)
  if (!ids.length) throw new Error('The audience filter matched no personas.')
  if (!['draft', 'needs_revision', 'ready_for_review'].includes(post.stage || 'draft')) throw new Error('This post cannot start a new simulation in its current stage.')
  const n = Math.max(1, Math.min(Math.floor(Number(size) || post.audience?.sampleSize || 60), MAX_PERSONAS, ids.length))
  const picked = shuffle(ids).slice(0, n)
  // Wave 1 reacts to the post cold. Waves 2-3 also see what wave 1 said.
  const w1 = Math.ceil(n * 0.5)
  const w2 = Math.ceil(n * 0.3)
  const queue = picked.map((id, i) => ({
    _key: shortId(id) + i,
    _type: 'slot',
    persona: ref(id),
    wave: i < w1 ? 1 : i < w1 + w2 ? 2 : 3,
  }))

  const run = await sanity.create({
    _type: 'simulationRun',
    post: ref(postId),
    revision: post.revision || 1,
    bodySnapshot: post.body,
    mediaSnapshot: post.mediaDescription || '',
    audienceSnapshot: post.audience ? `${post.audience.title} :: ${filter}` : 'Everyone',
    model: `crowd: ${CROWD_MODEL} · analyst: ${MODEL}`,
    status: 'running',
    personaCount: n,
    processed: 0,
    queue,
    startedAt: new Date().toISOString(),
  })

  await transition(postId, 'start_simulation', actor, {runId: run._id, set: {latestRun: ref(run._id)}})
  return {runId: run._id, resumed: false}
}

// ---------------------------------------------------------------- crowd step

const CROWD_SYSTEM = `You are a crowd simulator for social media. You play several DIFFERENT real people at once.
Each person is given as a persona card built from survey-grounded attributes. Stay strictly in character:
age, region, income, politics, religiosity, personality and attitudes must drive what each one does and how they write.

Behave like a real feed, not a focus group:
- Most people scroll past or just tap a reaction. Only some comment. A few share: people repost things they love ("omg this") and also things they hate (quote-dunking).
- People with low agreeableness / high anger are blunt; warm personas are kind; skeptics of influencers or brands say so.
- Write the way that person would type on their phone: short, slang, lowercase, emoji, typos are fine. No hashtags spam. Max 200 characters.
- Write in the language of the post.
- If visible comments are shown, people may reply to one of them (agree, argue, joke, pile on). Replies must make sense for the comment they answer.
- People who see comments usually like 1-3 comments they agree with (put their ids in likedCommentIds), even if they don't write anything.
- Never be uniformly positive. Disagreement is realistic.
- Flag only if THIS person would genuinely find the post offensive, insensitive, misleading, tone-deaf, legally dubious or off-brand.`

const CROWD_SCHEMA = {
  type: 'object',
  properties: {
    reactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          personaId: {type: 'string'},
          action: {type: 'string', enum: ['scroll', 'react', 'comment', 'reply', 'share']},
          emoji: {type: 'string', enum: [...EMOJI, 'none']},
          text: {type: 'string', description: 'Comment/reply/share caption. Empty for scroll/react.'},
          replyToId: {type: 'string', description: 'id of a visible comment, only when action=reply'},
          likedCommentIds: {type: 'array', items: {type: 'string'}},
          sentiment: {type: 'number', description: '-1 hostile .. 0 neutral .. 1 delighted, toward the post/brand'},
          flagCategory: {
            type: 'string',
            enum: ['none', 'offensive', 'insensitive', 'misleading', 'tone_deaf', 'legal', 'off_brand'],
          },
          flagReason: {type: 'string'},
          thought: {type: 'string', description: 'one short private sentence: why they reacted this way'},
        },
        required: ['personaId', 'action', 'emoji', 'sentiment', 'flagCategory', 'thought'],
      },
    },
  },
  required: ['reactions'],
}

type CrowdOut = {
  personaId: string
  action: ReactionLite['action']
  emoji: string
  text?: string
  replyToId?: string
  likedCommentIds?: string[]
  sentiment: number
  flagCategory: string
  flagReason?: string
  thought: string
}

function personaCard(p: any) {
  const t = p.traits || {}
  const a = p.attitudes || {}
  const bits = [
    p.summary,
    t.extraversion && `extraversion ${t.extraversion}`,
    t.anger && `anger ${t.anger}`,
    t.trust && `trust ${t.trust}`,
    a.brandLoyalty && `brand loyalty ${a.brandLoyalty}`,
    a.consumerism && `consumerism ${a.consumerism}`,
    a.trustLevel && `trust level ${a.trustLevel}`,
    p.mood && `current mood ${p.mood}`,
  ].filter(Boolean)
  return `[${shortId(p._id)}] @${p.handle}: ${bits.join('; ')}`
}

async function visibleFeed(runId: string) {
  // What a later-wave persona sees under the post: top comments plus the newest ones.
  type C = {_id: string; text: string; likes: number; handle: string; replyToHandle?: string}
  const proj = `{_id, text, "likes": coalesce(likes, 0), "handle": persona->handle, "replyToHandle": replyTo->persona->handle}`
  const base = `*[_type == "reaction" && run._ref == $run && action in ["comment", "reply"] && defined(text)]`
  const {top, recent} = await sanity.fetch<{top: C[]; recent: C[]}>(
    `{"top": ${base} | order(likes desc, seq asc)[0...8]${proj}, "recent": ${base} | order(seq desc)[0...4]${proj}}`,
    {run: runId},
  )
  const all = [...top, ...recent]
  return all.filter((c, i) => all.findIndex((x) => x._id === c._id) === i)
}

export async function stepRun(runId: string) {
  const run = await sanity.fetch(
    `*[_id == $id][0]{_id, _rev, status, processed, personaCount, bodySnapshot, queue,
      "post": post->{_id, title, platform, mediaDescription, "brand": brand->{name, handle}}}`,
    {id: runId},
  )
  if (!run) throw new Error('Run not found')
  if (!['running', 'paused'].includes(run.status) || !run.queue?.length)
    return {done: true, processed: run.processed, total: run.personaCount, status: run.status}

  // Do not mix cold readers and social-context readers in the same model batch.
  const take = run.queue.filter((s: any) => s.wave === run.queue[0].wave).slice(0, BATCH * PARALLEL)
  const personaIds = take.map((s: any) => s.persona._ref)
  const personas: any[] = await sanity.fetch(`*[_id in $ids]{${PERSONA_FIELDS}}`, {ids: personaIds})
  const byShort = new Map(personas.map((p) => [shortId(p._id), p]))
  const waveOf = new Map<string, number>(take.map((s: any) => [s.persona._ref as string, Number(s.wave)]))
  const laterWave = take.some((s: any) => s.wave > 1)
  const feed = laterWave ? await visibleFeed(runId) : []
  const feedIds = new Set(feed.map((c) => c._id))
  const feedText = feed.length
    ? feed
        .filter((c, i, a) => a.findIndex((x) => x._id === c._id) === i)
        .map((c) => `(${c._id}) @${c.handle}${c.replyToHandle ? ` ↪@${c.replyToHandle}` : ''} [${c.likes}❤]: ${c.text}`)
        .join('\n')
    : ''

  const postBlock = `POST by ${run.post?.brand?.name || 'a brand'} (@${run.post?.brand?.handle || 'brand'}) on ${
    run.post?.platform || 'social media'
  }:
"""
${run.bodySnapshot}
"""
${run.post?.mediaDescription ? `Attached media: ${run.post.mediaDescription}\n` : ''}`

  const batches: any[][] = []
  for (let i = 0; i < personas.length; i += BATCH) batches.push(personas.slice(i, i + BATCH))

  const results = await Promise.all(
    batches.map((group) => {
      const seesFeed = group.some((p) => (waveOf.get(p._id) || 1) > 1) && feedText
      const prompt = `${postBlock}
${seesFeed ? `VISIBLE COMMENTS (ids in parentheses):\n${feedText}\n\nPeople marked (sees comments) can reply to or like these.\n` : 'No comments yet — these people are among the first to see it.\n'}
PEOPLE (one reaction each, use the bracket id as personaId):
${group.map((p) => personaCard(p) + ((waveOf.get(p._id) || 1) > 1 && seesFeed ? ' (sees comments)' : '')).join('\n')}`
      return geminiJSON<{reactions: CrowdOut[]}>({system: CROWD_SYSTEM, prompt, schema: CROWD_SCHEMA, temperature: 1.05, model: CROWD_MODEL})
        .then((r) => ({reactions: validateCrowdBatch(r.reactions, group.map(p => shortId(p._id))) as CrowdOut[], error: null as string | null}))
        .catch((e) => ({reactions: [] as CrowdOut[], error: e instanceof Error ? e.message : 'Model request failed. This batch remains pending.'}))
    }),
  )

  const out = results.flatMap(r => r.reactions)
  const failure = results.find(r => r.error)?.error || (personas.length < take.length ? 'Some sampled persona documents are unavailable. Restore them before retrying.' : null)

  const tx = sanity.transaction()
  let seq = run.processed || 0
  const likeCounts = new Map<string, number>()
  const seen = new Set<string>()
  for (const r of out) {
    const p = byShort.get(String(r.personaId).replace(/^\[|\]$/g, ''))
    if (!p || seen.has(p._id)) continue
    seen.add(p._id)
    const action = ['scroll', 'react', 'comment', 'reply', 'share'].includes(r.action) ? r.action : 'scroll'
    const replyTo = action === 'reply' && r.replyToId && feedIds.has(r.replyToId) ? r.replyToId : undefined
    const finalAction = action === 'reply' && !replyTo ? 'comment' : action
    const text = ['comment', 'reply', 'share'].includes(finalAction) ? (r.text || '').slice(0, 280).trim() : ''
    ;(r.likedCommentIds || []).forEach((id) => feedIds.has(id) && likeCounts.set(id, (likeCounts.get(id) || 0) + 1))
    tx.create({
      _id: `reaction-${runId.slice(-12)}-${shortId(p._id)}`,
      _type: 'reaction',
      run: ref(runId),
      persona: ref(p._id),
      wave: waveOf.get(p._id) || 1,
      seq: seq++,
      action: finalAction === 'comment' && !text ? 'react' : finalAction,
      emoji: EMOJI.includes(r.emoji as any) ? r.emoji : undefined,
      text: text || undefined,
      sentiment: Math.max(-1, Math.min(1, Number(r.sentiment) || 0)),
      replyTo: replyTo ? ref(replyTo) : undefined,
      likes: 0,
      flag:
        r.flagCategory && r.flagCategory !== 'none'
          ? {category: r.flagCategory, reason: (r.flagReason || '').slice(0, 200)}
          : undefined,
      thought: (r.thought || '').slice(0, 240),
    })
  }
  // Failed or omitted responses stay in the queue. No synthetic scroll records.
  const rest = run.queue.filter((slot: any) => !seen.has(slot.persona._ref))
  likeCounts.forEach((k, id) => tx.patch(id, (pt) => pt.setIfMissing({likes: 0}).inc({likes: k})))
  // Optimistic lock: if another step already advanced this run, the whole batch is rejected.
  tx.patch(runId, (pt) => pt.ifRevisionId(run._rev).set({queue: rest, processed: seq, status: failure ? 'paused' : 'running', error: failure || null}))
  try {
    await tx.commit({visibility: 'sync', autoGenerateArrayKeys: true})
  } catch (e: any) {
    if (e?.statusCode === 409 || String(e?.message || e).includes('revision')) return {done: false, conflict: true, processed: run.processed, total: run.personaCount}
    throw e
  }
  return {done: rest.length === 0, paused: !!failure, error: failure, processed: seq, total: run.personaCount, status: failure ? 'paused' : 'running'}
}

// ---------------------------------------------------------------- analysis

const ANALYST_SYSTEM = `You are the pre-publish analyst for a brand's social team. You just watched a simulated crowd
(survey-grounded persona agents) react to a draft post. You also have the brand's memory: its voice, red lines and past incidents.
Be specific and evidence-based. Quote the exact phrase in the post that causes each problem (it must be a verbatim substring).
Connect problems to the brand's red lines or past incidents when they genuinely match; say so plainly.
Verdict: "ship" if backlash risk is below ~35 and nothing is high severity (minor polish goes in low-severity flags); "revise" for fixable problems; "kill" only if the idea itself is unsalvageable.
Then rewrite the post so it keeps the business goal and the energy but removes the risk. Same language as the original, similar length.`

const ANALYST_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {type: 'string', enum: ['ship', 'revise', 'kill']},
    headline: {type: 'string', description: 'one punchy sentence'},
    summary: {type: 'string', description: '2-4 sentences: who reacted how and why'},
    riskFlags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: {type: 'string'},
          why: {type: 'string'},
          severity: {type: 'string', enum: ['low', 'medium', 'high']},
          brandMemory: {type: 'string', description: 'matching red line or past incident, or empty'},
          evidenceIds: {type: 'array', items: {type: 'string'}},
        },
        required: ['phrase', 'why', 'severity'],
      },
    },
    suggestedRevision: {type: 'string'},
    changes: {type: 'array', items: {type: 'string'}},
  },
  required: ['verdict', 'headline', 'summary', 'riskFlags', 'suggestedRevision', 'changes'],
}

export async function finalizeRun(runId: string) {
  const run = await sanity.fetch(
    `*[_id == $id][0]{_id, _rev, status, queue, bodySnapshot, revision, analysisStartedAt,
      "post": post->{_id, title, platform, "brand": brand->{name, voice, audience, redLines, pastIncidents}}}`,
    {id: runId},
  )
  if (!run) throw new Error('Run not found')
  if (run.status === 'complete') return {status: 'complete'}
  if (run.status === 'cancelled') return {status: 'cancelled'}
  if (run.queue?.length) return {status: run.status, pending: run.queue.length}

  if (run.status === 'analyzing' && run.analysisStartedAt && Date.now() - Date.parse(run.analysisStartedAt) < 90000) return {status: 'analyzing'}
  // Lease prevents duplicate analysis, while a timed-out invocation can be retried.
  try {
    await sanity.patch(runId).ifRevisionId(run._rev).set({status: 'analyzing', analysisStartedAt: new Date().toISOString()}).commit()
  } catch {
    return {status: 'analyzing'}
  }

  const reactions: any[] = await sanity.fetch(
    `*[_type == "reaction" && run._ref == $id] | order(seq asc){
      _id, action, emoji, sentiment, likes, flag, replyTo, text,
      "persona": persona->{handle, generation, region, politicalLean, householdIncome, religion}
    }`,
    {id: runId},
  )
  const {n, ...metrics} = computeMetrics(reactions)
  const cohorts = computeCohorts(reactions)

  const talk = reactions.filter((r) => r.text)
  const neg = [...talk].sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0) || (b.likes || 0) - (a.likes || 0)).slice(0, 14)
  const pos = [...talk].sort((a, b) => (b.sentiment ?? 0) - (a.sentiment ?? 0)).slice(0, 6)
  const fmt = (r: any) =>
    `(${r._id}) @${r.persona?.handle} [${r.persona?.generation || '?'}, ${r.persona?.region || '?'}, ${
      r.persona?.politicalLean || '?'
    }] s=${r.sentiment} likes=${r.likes || 0}${r.flag?.category ? ` FLAG:${r.flag.category}` : ''}: ${r.text}`
  const b = run.post?.brand || {}

  let analysis: any
  let analysisMode = 'model'
  try {
    analysis = await geminiJSON<any>({
      system: ANALYST_SYSTEM,
      temperature: 0.4,
      schema: ANALYST_SCHEMA,
      prompt: `BRAND: ${b.name}
Voice: ${b.voice || '-'}
Audience: ${b.audience || '-'}
Red lines:
${(b.redLines || []).map((x: string) => `- ${x}`).join('\n') || '- none recorded'}
Past incidents:
${(b.pastIncidents || []).map((x: any) => `- ${x.date || ''} ${x.title}: ${x.whatHappened} (lesson: ${x.lesson})`).join('\n') || '- none recorded'}

DRAFT POST (revision ${run.revision}, ${run.post?.platform}):
"""
${run.bodySnapshot}
"""

CROWD RESULT (${n} personas): ${JSON.stringify(metrics)}
Worst cohorts: ${cohorts.slice(0, 6).map((c) => `${c.dimension}=${c.value} n=${c.n} avg=${c.avgSentiment} neg=${c.negativeShare}`).join('; ')}
Best cohorts: ${cohorts.slice(-3).map((c) => `${c.dimension}=${c.value} n=${c.n} avg=${c.avgSentiment}`).join('; ')}

MOST NEGATIVE COMMENTS:
${neg.map(fmt).join('\n')}

MOST POSITIVE COMMENTS:
${pos.map(fmt).join('\n')}`,
    })
  } catch (e: any) {
    analysisMode = 'metrics_only'
    analysis = {
      verdict: 'review',
      headline: 'Analyst unavailable — scores computed from the crowd only',
      summary: 'Only deterministic scores from completed reactions are available. No AI verdict or rewrite was produced. Human review is required. ' + String(e?.message || e).slice(0, 180),
      riskFlags: [],
      suggestedRevision: '',
      changes: [],
    }
  }

  const ids = new Set(reactions.map((r) => r._id))
  const riskFlags = (analysis.riskFlags || []).slice(0, 6).map((f: any, i: number) => ({
    _key: `f${i}`,
    _type: 'riskFlag',
    phrase: f.phrase,
    why: f.why,
    severity: f.severity,
    brandMemory: f.brandMemory || undefined,
    evidence: (f.evidenceIds || [])
      .map((x: string) => String(x).replace(/[()]/g, ''))
      .filter((x: string) => ids.has(x))
      .slice(0, 5)
      .map((x: string) => ({_key: x.slice(-10), ...ref(x)})),
  }))

  const current = await sanity.fetch('*[_id==$id][0]{_rev,status}', {id:runId})
  if (!current || current.status === 'cancelled') return {status:'cancelled'}
  await sanity
    .patch(runId)
    .ifRevisionId(current._rev)
    .set({
      status: 'complete',
      finishedAt: new Date().toISOString(),
      metrics: {_type: 'object', ...metrics},
      cohorts: cohorts.map((c, i) => ({_key: `c${i}`, _type: 'cohort', ...c})),
      analysis: {
        mode: analysisMode,
        verdict: analysis.verdict,
        headline: analysis.headline,
        summary: analysis.summary,
        riskFlags,
        suggestedRevision: analysis.suggestedRevision,
        changes: analysis.changes,
      },
    })
    .commit({visibility: 'sync'})

  // The agent moves the post forward. It can flag or clear; it cannot approve.
  const risky =
    analysisMode !== 'model' || analysis.verdict === 'kill' || metrics.backlashRisk >= 45 || riskFlags.some((f: any) => f.severity === 'high')
  const agent = {kind: 'agent' as const, name: 'Simulation analyst'}
  try {
    await transition(run.post._id, risky ? 'flag_risk' : 'clear_for_review', agent, {
      runId,
      note: `${analysis.headline} (risk ${metrics.backlashRisk}, trend ${metrics.trendScore})`,
    })
  } catch (e) {
    console.warn('transition after run skipped:', (e as Error).message)
  }
  return {status: 'complete', metrics, verdict: analysis.verdict, analysisMode}
}

// ---------------------------------------------------------------- revision

export async function applyRevision(postId: string, actor: ActorInfo) {
  const p = await sanity.fetch(
    `*[_id == $id][0]{revision, "suggestion": latestRun->analysis.suggestedRevision}`,
    {id: postId},
  )
  if (!p?.suggestion) throw new Error('No suggested revision on the latest run.')
  return transition(postId, 'apply_revision', actor, {
    note: 'Applied the analyst’s suggested revision',
    set: {body: p.suggestion, revision: (p.revision || 1) + 1},
  })
}
