# MagenticCMS

**V3:** Web composer at `/compose`, interactive Three.js audience, and resumable API-failure handling. Updating an existing copy? Preserve your env files, run `npm install` in `web`, and restart. Do not reseed your existing dataset.

**Rehearse the crowd before you post.** Your draft goes "live" to a room of persona agents grounded in real survey records ([MatrAIx Persona-1M](https://huggingface.co/datasets/MatrAIx2026/MatrAIx_Persona_1M)). They react, comment and argue with each other in real time. An analyst agent reads your brand's memory (red lines, past incidents), flags the exact phrase that will get you dragged, and drafts a fix. A workflow stored as data in Sanity decides who may move the post forward: agents can flag and clear, only humans can approve.

Built for the DEV × Sanity Challenge (Path Two).

```
magenticcms/
├─ studio/     Sanity Studio: schemas, workflow actions, live "Simulation" tab, stage badges
├─ web/        Next.js live room + simulation engine (API routes)
├─ scripts/    build_personas.py (MatrAIx → Sanity docs), seed.py (dataset seed)
└─ data/       MatrAIx sample shard + generated personas.ndjson
```

## Run it

```bash
# 1. Personas + demo content into your dataset
pip install pandas pyarrow
python3 scripts/build_personas.py 400          # data/matraix_sample.parquet -> data/personas.ndjson
SANITY_PROJECT_ID=xxx SANITY_DATASET=production SANITY_API_TOKEN=xxx python3 scripts/seed.py
#   add --reset-posts to put the demo posts back to draft rev 1

# 2. Studio
cd studio && cp .env.example .env    # fill in project id + web URL
npm install && npm run dev            # http://localhost:3333
npx sanity schema deploy && npx sanity deploy    # hosted Studio (optional)

# 3. Live room
cd ../web && cp .env.example .env.local   # Sanity token + Gemini key
npm install && npm run dev            # http://localhost:3000
```

Deploy `web/` to Vercel (root directory = `web`) with the same env vars. If you embed links from Studio to the live room, set `SANITY_STUDIO_WEB_URL` to the Vercel URL.

## How a run works

1. **Sample** – the post's `audience` is a GROQ filter over `persona` docs (`householdIncome in ["<$25k","$25k-50k"] || shoppingStyle == "Bargain hunter"`). N personas are drawn and split into 3 waves; the queue is stored on the `simulationRun` document.
2. **Crowd** – each step takes the next 16 personas and asks Gemini to play them (8 per call, 2 calls in parallel). Wave 1 sees only the post. Waves 2–3 also see the top + newest comments and can reply to or like them, so agents genuinely respond to each other. Every action is written as a `reaction` document in one transaction together with an optimistic-locked update of the run's queue.
3. **Live** – the browser subscribes to Sanity's real-time listener (bridged through an SSE route so the token stays server-side) and reveals reactions as they land: chat feed, threads, floating emoji, live meters.
4. **Score** – `lib/metrics.ts` computes backlash risk / trend score / cohort breakdown from the reactions. Same function in the browser and on the server, so the live gauge equals the saved number.
5. **Analyse** – the analyst agent gets the metrics, worst cohorts, most negative/positive comments and the brand document (voice, red lines, past incidents) and returns a verdict, risk flags (verbatim phrase + evidence reaction refs + matching brand memory) and a rewrite.
6. **Workflow** – the analyst calls `flag_risk` or `clear_for_review` on the `workflow.socialPost` document. `approve` and `publish` list only `human` as an allowed actor, so the agent physically can't ship. Every move writes a `workflowEvent`.

## Honest limitations

- Personas are LLM role-play conditioned on survey-derived attributes, not real people. Use it to catch obvious misses before posting, not to replace real research.
- The crowd is batched (8 personas per model call) to fit free-tier rate limits. Agents in the same batch don't see each other; agents in later waves do see earlier ones.
- Text only — media is described in a field, not seen.
- The live-room buttons are unauthenticated in this demo; Studio actions use the real Sanity user.
