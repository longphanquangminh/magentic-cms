export const REACTION_PROJECTION = `{
  _id, seq, wave, action, emoji, text, sentiment, likes, flag, thought, "replyTo": replyTo,
  "persona": persona->{_id, handle, displayName, avatarSeed, region, generation, ageBracket, politicalLean, householdIncome, religion, summary,
    "matraix": matraix{source, recordId}}
}`

export const RUN_PROJECTION = `{
  _id, revision, status, processed, personaCount, model, error, startedAt, finishedAt, bodySnapshot, audienceSnapshot,
  metrics, cohorts, analysis{mode, verdict, headline, summary, suggestedRevision, changes,
    riskFlags[]{phrase, why, severity, brandMemory, "evidence": evidence[]._ref}}
}`

export const POST_PROJECTION = `{
  _id, title, body, platform, mediaDescription, stage, revision,
  "brand": brand->{name, handle, voice, redLines, pastIncidents},
  "audience": audience->{title, description, groqFilter, sampleSize},
  "latestRunId": latestRun._ref,
  "runs": *[_type == "simulationRun" && post._ref == ^._id] | order(startedAt desc)[0...8]{
    _id, revision, status, startedAt, personaCount, "risk": metrics.backlashRisk, "trend": metrics.trendScore, "verdict": analysis.verdict
  },
  "events": *[_type == "workflowEvent" && post._ref == ^._id] | order(at desc)[0...12]{_id, transition, from, to, actor, note, at},
  "transitions": *[_id == "workflow.socialPost"][0].transitions,
  "stages": *[_id == "workflow.socialPost"][0].stages
}`
