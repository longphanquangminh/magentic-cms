'use client'

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useLiveAudio} from './useLiveAudio'
import '@/app/live-hype.css'
import AudienceWorld from './AudienceWorld'
import '@/app/live-v3.css'
import {SignalChart} from './AudienceStage'
import '@/app/live-v2.css'
import {computeCohorts, computeMetrics, EMOJI, type Emoji} from '@/lib/metrics'

const EMOJI_CHAR: Record<Emoji, string> = {like: '👍', love: '❤️', haha: '😆', wow: '😮', sad: '😢', angry: '😡'}
const STAGE_ORDER = ['draft', 'simulating', 'needs_revision', 'ready_for_review', 'approved', 'published']

type Reaction = {
  _id: string
  seq: number
  wave: number
  action: 'scroll' | 'react' | 'comment' | 'reply' | 'share'
  emoji?: Emoji
  text?: string
  sentiment?: number
  likes?: number
  flag?: {category?: string; reason?: string}
  thought?: string
  replyTo?: {_ref: string}
  persona?: any
}

type Bubble = {id: string; char: string; x: number; drift: number; dur: number; size: number}

function hue(seed = '') {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function Avatar({p, size = 32}: {p: any; size?: number}) {
  const h = hue(p?.avatarSeed || p?.handle)
  return (
    <span
      className="avatar"
      style={{width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 55% 42%)`}}
      title={p?.summary}
    >
      {(p?.displayName || p?.handle || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

function Gauge({label, value, danger}: {label: string; value: number; danger?: boolean}) {
  const v = Math.max(0, Math.min(100, value || 0))
  const color = danger ? (v >= 60 ? '#ff4d5e' : v >= 35 ? '#ffb020' : '#2fd17a') : v >= 60 ? '#2fd17a' : v >= 35 ? '#7c6cff' : '#5b6478'
  const r = 46
  const c = Math.PI * r
  return (
    <div className="gauge">
      <svg viewBox="0 0 110 64" width="100%">
        <path d="M8 58 A46 46 0 0 1 102 58" fill="none" stroke="#252a36" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M8 58 A46 46 0 0 1 102 58"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          style={{transition: 'stroke-dasharray .5s ease, stroke .5s'}}
        />
      </svg>
      <div className="gauge-num" style={{color}}>
        {Math.round(v)}
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  )
}

function highlight(body: string, flags: {phrase: string; severity: string}[] = []) {
  if (!flags.length) return body
  const parts: ReactNode[] = []
  let rest = body
  let key = 0
  while (rest) {
    let best: {i: number; f: any} | null = null
    for (const f of flags) {
      if (!f.phrase) continue
      const i = rest.toLowerCase().indexOf(f.phrase.toLowerCase())
      if (i >= 0 && (!best || i < best.i)) best = {i, f}
    }
    if (!best) {
      parts.push(rest)
      break
    }
    parts.push(rest.slice(0, best.i))
    parts.push(
      <mark key={key++} className={`flag-${best.f.severity}`} title={best.f.why}>
        {rest.slice(best.i, best.i + best.f.phrase.length)}
      </mark>,
    )
    rest = rest.slice(best.i + best.f.phrase.length)
  }
  return parts
}

export default function LiveRoom({
  initialPost,
  initialRunId,
  autorun,
  studioUrl,
}: {
  initialPost: any
  initialRunId: string | null
  autorun: boolean
  studioUrl: string | null
}) {
  const audio = useLiveAudio()
  const audioPlay = useRef(audio.play)
  audioPlay.current = audio.play
  const [hype, setHype] = useState(true)
  const [followLatest, setFollowLatest] = useState(true)
  const playbackStarted = useRef(false)
  const completionCue = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [post, setPost] = useState<any>(initialPost)
  const [runId, setRunId] = useState<string | null>(initialRunId)
  const [run, setRun] = useState<any>(null)
  const [shown, setShown] = useState<Reaction[]>([])
  const [likes, setLikes] = useState<Record<string, number>>({})
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [tab, setTab] = useState<'live' | 'threads'>('live')
  const [size, setSize] = useState<number>(initialPost.audience?.sampleSize || 60)
  const [replaying, setReplaying] = useState(false)
  const [railTab, setRailTab] = useState<'crowd' | 'analysis' | 'workflow'>('crowd')
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const playback = useRef({paused: false, speed: 1, hype:false})
  const feedBox = useRef<HTMLDivElement>(null)
  const autoFollow = useRef(true)
  useEffect(() => { playback.current = {paused, speed, hype} }, [paused, speed, hype])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const pending = useRef<Reaction[]>([])
  const lastSeq = useRef(-1)
  const known = useRef(new Set<string>())
  const feedEnd = useRef<HTMLDivElement>(null)
  const driving = useRef(false)
  const autoIter = useRef(0)

  const say = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 40))

  const refreshPost = useCallback(async () => {
    const r = await fetch(`/api/posts/${post._id}`, {cache: 'no-store'})
    if (r.ok) setPost(await r.json())
  }, [post._id])

  // ------------------------------------------------------------ data pull
  const pull = useCallback(
    async (id: string, instant = false) => {
      const r = await fetch(`/api/runs/${id}/reactions?after=${lastSeq.current}`, {cache: 'no-store'})
      if (!r.ok) return null
      const data = await r.json()
      setRun(data.run)
      setLikes(Object.fromEntries((data.likes || []).map((l: any) => [l._id, l.likes])))
      const fresh: Reaction[] = (data.reactions || []).filter((x: Reaction) => !known.current.has(x._id))
      fresh.forEach((x) => {
        known.current.add(x._id)
        lastSeq.current = Math.max(lastSeq.current, x.seq)
      })
      if (instant) setShown((s) => [...s, ...fresh])
      else pending.current.push(...fresh)
      return data.run
    },
    [],
  )

  const resetFeed = () => {
    playbackStarted.current=false
    completionCue.current=false
    autoFollow.current=true
    setFollowLatest(true)
    setSelectedId(null)
    setReplaying(false)
    setPaused(false)
    pending.current = []
    lastSeq.current = -1
    known.current = new Set()
    setShown([])
    setLikes({})
  }

  // ------------------------------------------------------------ reveal loop (the "livestream")
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const q = pending.current
      if (q.length && !playback.current.paused) {
        const next = q.shift()!
        playbackStarted.current=true
        setShown((s) => [...s, next])
        if(next.action !== 'scroll') audioPlay.current(next.flag?.category ? 'flag' : next.action === 'reply' ? 'reply' : next.text ? 'comment' : 'react')
        if (next.emoji) {
          // One floating emoji per real reaction, FB/TikTok-live style.
          const dur = 2.6 + Math.random() * 1.2
          const b = {id: next._id, char: EMOJI_CHAR[next.emoji], x: 15 + Math.random() * 55, drift: (Math.random() - 0.5) * 70, dur, size: 28 + Math.random() * 14}
          setBubbles((bs) => [...bs.slice(-40), b])
          setTimeout(() => setBubbles((bs) => bs.filter((x) => x.id !== b.id)), dur * 1000 + 100)
        }
      }
      // Reveal real records faster, never create synthetic audience events.
      const base = playback.current.hype ? (q.length > 10 ? 100 : 150) : 600
      const delay = q.length ? Math.max(65, base / playback.current.speed) : 180
      t = setTimeout(tick, delay)
    }
    t = setTimeout(tick, 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (tab === 'live' && autoFollow.current && feedBox.current) feedBox.current.scrollTo({top: feedBox.current.scrollHeight, behavior: 'auto'})
  }, [shown.length, tab])

  // ------------------------------------------------------------ initial load
  useEffect(() => {
    if (!runId) return
    resetFeed()
    pull(runId, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ real-time subscription (Sanity listener via SSE)
  useEffect(() => {
    if (!runId || !run || ['complete','failed','paused','cancelled'].includes(run.status)) return
    const es = new EventSource(`/api/runs/${runId}/stream`)
    let timer: ReturnType<typeof setTimeout> | null = null
    es.addEventListener('change', () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        pull(runId)
      }, 250)
    })
    // safety net if SSE is buffered by a proxy
    const poll = setInterval(() => pull(runId), 4000)
    return () => {
      es.close()
      clearInterval(poll)
      if (timer) clearTimeout(timer)
    }
  }, [runId, run?.status, pull])

  // ------------------------------------------------------------ driving a run (this tab is the orchestrator)
  const drive = useCallback(
    async (id: string) => {
      if (driving.current) return
      driving.current = true
      try {
        let fails = 0
        for (;;) {
          const r = await fetch(`/api/runs/${id}/step`, {method: 'POST'})
          const j = await r.json()
          if (!r.ok) {
            await pull(id)
            throw new Error(j.error || 'Simulation request failed. Progress is saved; retry manually.')
          }
          fails = 0
          if (j.conflict) {await pull(id); throw new Error('Another tab is processing this session. Wait for it to finish, then resume if needed.')}
          if (j.paused) {await pull(id); throw new Error(j.error || 'Model unavailable. Progress saved.')}
          if (j.status === 'cancelled') {await pull(id); return {status:'cancelled'}}
          setBusy(`Crowd reacting… ${j.processed}/${j.total}`)
          pull(id)
          if (j.done) break
        }
        setBusy('Analyst agent reading the room…')
        say('crowd done → analyst')
        const f = await fetch(`/api/runs/${id}/finalize`, {method: 'POST'})
        const fj = await f.json()
        if (!f.ok) throw new Error(fj.error)
        await pull(id)
        await refreshPost()
        say(`verdict: ${fj.verdict} (risk ${fj.metrics?.backlashRisk}, trend ${fj.metrics?.trendScore})`)
        return fj
      } catch (e: any) {
        setError(e.message || 'Session interrupted. Saved progress is retained.')
        await pull(id).catch(() => null)
        return {status:'paused'}
      } finally {
        driving.current = false
        setBusy(null)
      }
    },
    [pull, refreshPost],
  )

  const start = useCallback(
    async (opts: {agent?: boolean} = {}) => {
      setError(null)
      setBusy('Sampling personas with the audience GROQ filter…')
      try {
        const r = await fetch('/api/runs', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({postId: post._id, size, autopilot: opts.agent}),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error)
        resetFeed()
        setRailTab('crowd')
        setRunId(j.runId)
        history.replaceState(null, '', `/posts/${post._id}?run=${j.runId}`)
        say(`${opts.agent ? '🤖 autopilot' : '🧑 you'} started run ${j.runId.slice(-6)}`)
        await refreshPost()
        await pull(j.runId)
        const fj = await drive(j.runId)
        return fj
      } catch (e: any) {
        setError(e.message)
        setBusy(null)
      }
    },
    [post._id, size, drive, pull, refreshPost],
  )

  const act = useCallback(
    async (transitionId: string, opts: {as?: 'agent'; note?: string} = {}) => {
      setError(null)
      const r = await fetch(`/api/posts/${post._id}/transition`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({transitionId, ...opts}),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error)
        say(`✋ refused: ${j.error}`)
        return false
      }
      say(`${opts.as === 'agent' ? '🤖' : '🧑'} ${transitionId}: ${j.from} → ${j.to}`)
      await refreshPost()
      return true
    },
    [post._id, refreshPost],
  )

  // Autopilot: simulate → if flagged, apply the analyst's rewrite → simulate again (max 2 rewrites). Stops at review.
  const runAutopilot = useCallback(async () => {
    autoIter.current = 0
    let res: any = await start({agent: true})
    while (res?.status === 'complete' && res.analysisMode !== 'metrics_only' && res.verdict && res.verdict !== 'ship' && autoIter.current < 2) {
      autoIter.current++
      say(`🤖 autopilot rewrite #${autoIter.current}`)
      if (!(await act('apply_revision', {as: 'agent'}))) break
      res = await start({agent: true})
    }
    say('🤖 autopilot stopped — a human has to approve')
  }, [start, act])

  const replay = useCallback(async () => {
    if (!runId) return
    setError(null)
    resetFeed()
    setReplaying(true)
    setRailTab('crowd')
    await pull(runId, false)
  }, [runId, pull])

  // autorun from Studio's "Run simulation" action
  useEffect(() => {
    if (autorun && !driving.current) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A session that is still fresh (e.g. you pressed F5 mid-run) continues automatically.
  // Stale ones were already closed server-side and returned to draft.
  useEffect(() => {
    if (run && run.status === 'running' && !driving.current && (run.processed || 0) <= (run.personaCount || 0)) {
      setBusy('Resuming the live session…')
      drive(run._id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?._id])

  // ------------------------------------------------------------ derived
  const withLikes = useMemo(() => shown.map((r) => ({...r, likes: likes[r._id] ?? r.likes ?? 0})), [shown, likes])
  const live = useMemo(() => computeMetrics(withLikes as any), [withLikes])
  const cohorts = useMemo(() => computeCohorts(withLikes as any).slice(0, 6), [withLikes])
  const talk = withLikes.filter((r) => r.text)
  const byId = useMemo(() => new Map(withLikes.map((r) => [r._id, r])), [withLikes])
  const threads = useMemo(() => {
    const roots = talk.filter((r) => !r.replyTo).sort((a, b) => (b.likes || 0) - (a.likes || 0))
    const kids = new Map<string, Reaction[]>()
    talk.forEach((r) => r.replyTo && kids.set(r.replyTo._ref, [...(kids.get(r.replyTo._ref) || []), r]))
    return {roots, kids}
  }, [talk])

  const a = run?.analysis
  const done = run?.status === 'complete'
  const settled = done && shown.length >= (run?.personaCount || 0)
  // Background beat, one rule for every case:
  //  ON  while a simulation is starting/running/analysing (from the click until the result),
  //      while replay or the live reveal still has reactions to show.
  //  OFF when the session is paused (API error) / cancelled / finished and fully revealed,
  //      when the user pauses replay, or turns Sound off (handled inside the audio hook).
  const revealPending = !!run && shown.length < (run.personaCount || 0) && (replaying || pending.current.length > 0)
  const beatOn = !paused && !error && (!!busy || run?.status === 'running' || run?.status === 'analyzing' || revealPending)
  useEffect(() => { audio.setBeat(beatOn) }, [beatOn, busy, run?._id, run?.status, replaying, audio.setBeat])
  useEffect(() => {
    if(settled && playbackStarted.current && !completionCue.current){completionCue.current=true;audioPlay.current('complete')}
  }, [settled, paused, audio.silence])
  const flags = settled ? a?.riskFlags || [] : []
  const evidence = new Set<string>(flags.flatMap((f: any) => f.evidence || []))
  const body = run && post.revision !== run.revision ? run.bodySnapshot : post.body
  const stage = post.stage || 'draft'
  const humanMoves = (post.transitions || []).filter(
    (t: any) => t.from.includes(stage) && t.actors.includes('human') && t.id !== 'start_simulation',
  )
  const canStart = (post.transitions || []).some((t: any) => t.id === 'start_simulation' && t.from.includes(stage))
  const quadrantLabel: Record<string, string> = {
    viral_good: '🚀 Viral for the right reasons',
    viral_bad: '🔥 Viral for the wrong reasons',
    quiet_safe: '🫥 Safe but forgettable',
    quiet_risky: '⚠️ Low reach, still risky',
  }

  const revealing = replaying && shown.length < (run?.personaCount || 0)
  const liveActive = !!busy || run?.status === 'running' || revealing || pending.current.length > 0
  const metric = settled && run?.metrics ? run.metrics : live
  const recent = talk.slice(-2).reverse()
  const currentWave = shown.length ? shown[shown.length-1].wave : 0
  const progress = run?.personaCount ? Math.min(100, shown.length/run.personaCount*100) : 0

  const previousComplete = (post.runs || []).find((r: any) => r.status === 'complete' && r._id !== runId)
  const showSavedReplay = async () => {
    if (!previousComplete) return
    setError(null); resetFeed(); setRunId(previousComplete._id); setReplaying(true); setRailTab('crowd'); await pull(previousComplete._id, false)
  }
  const cancelSession = async () => {
    if (!runId || !window.confirm('Stop this session and return the post to draft? Saved reactions will be kept.')) return
    const r = await fetch(`/api/runs/${runId}/cancel`,{method:'POST'}); const d=await r.json()
    if (!r.ok) {setError(d.error); return}
    setError(null); await pull(runId); await refreshPost()
  }
  const choosePersona = (r: Reaction) => {setSelectedId(r._id); setRailTab('crowd'); setTab('live')}
  return <main className={`live-v2 live-v3 ${hype ? 'hype-mode' : ''}`}>
    <header className="session-head">
      <div><a className="session-back" href="/">← Rehearsals</a><h1>{post.title}</h1></div>
      <div className="session-meta"><a className="edit-draft-link" href={`/compose?post=${post._id}`}>Edit draft ↗︎</a><span className={`session-status ${liveActive ? 'active' : ''}`}><i/>{revealing ? 'REPLAY' : run?.status === 'paused' ? 'PAUSED · API ERROR' : run?.status === 'cancelled' ? 'CANCELLED' : liveActive ? 'ON AIR' : run ? 'SESSION COMPLETE' : 'STANDBY'}</span><span className="stage">{stage.replace(/_/g,' ')}</span></div>
    </header>
    <div className="session-grid">
      <section className="stage-column">
        <details className="v3-draft" open>
          <summary><span><b>{post.brand?.name}</b><small>{post.platform} · revision {run?.revision || post.revision || 1}</small></span><span>POST UNDER TEST <i>⌄</i></span></summary>
          <p>{highlight(body || '',flags)}</p>
          {post.mediaDescription && <small className="draft-media">Media description: {post.mediaDescription}</small>}
        </details>
        <div className="v3-world-wrap">
          <AudienceWorld reactions={withLikes} total={run?.personaCount || size} active={liveActive && !paused} selectedId={selectedId} onSelect={choosePersona}/>
          <div className="v3-floating-reactions" aria-hidden="true">{bubbles.map(b => <span className="live-heart" key={b.id} style={{left:`${b.x}%`, fontSize: b.size, animationDuration: `${b.dur}s`, ['--drift' as any]: `${b.drift}px`}}>{b.char}</span>)}</div>
        </div>
        <div className="wave-tracker v3-waves">{[1,2,3].map(w => <span key={w} className={currentWave===w && liveActive ? 'active' : currentWave>=w ? 'passed' : ''}><i/>WAVE 0{w}<small>{w===1 ? 'First impressions' : w===2 ? 'Reply & discussion' : 'Follow-up reactions'}</small></span>)}</div>
        <div className="control-deck"><div className="audience-select"><span className="micro-label">TEST AUDIENCE</span><strong>{post.audience?.title || 'Everyone'}</strong><select aria-label="Crowd size" value={size} disabled={!!busy} onChange={e => setSize(Number(e.target.value))}>{[20,40,60,90,120].map(n => <option key={n} value={n}>{n} personas</option>)}</select></div>
          <div className="btns"><button className="primary" disabled={!!busy || !canStart} onClick={() => start()}>▶ Run simulation</button><button disabled={!!busy || !done} onClick={replay} title="Play the saved session. No LLM calls.">↻ Replay</button></div>
        </div>
        <div className="live-presentation-controls" aria-label="Presentation settings">
          <button type="button" className={hype ? 'is-on' : ''} aria-pressed={hype} onClick={() => setHype(!hype)} title="Speed up the reveal of available reactions; no additional model calls">ϟ Hype {hype ? 'on' : 'off'}</button>
          <button type="button" className={audio.enabled ? 'is-on' : ''} aria-pressed={audio.enabled} onClick={audio.toggle}>♫ Sound {audio.enabled ? 'on' : 'off'}</button>
          {audio.enabled && <label className="volume-control">Volume<input type="range" aria-label="Sound volume" min="0" max="100" value={Math.round(audio.volume*100)} onChange={e => audio.changeVolume(Number(e.target.value)/100)}/></label>}
          <span>{hype ? 'Fast presentation · actual stored reactions only' : 'Optional presentation effects · no extra LLM calls'}</span>
        </div>
        {audio.audioError && <p className="sound-error" role="status">{audio.audioError}</p>}
        <details className="mode-guide"><summary>What do these buttons do?</summary><div><p><b>Run simulation</b> · Shows this draft to a new simulated audience (uses the LLM).</p><p><b>Replay</b> · Animate a saved session. No LLM calls, no new predictions.</p><p>Each model call handles up to 8 personas. Two calls run in parallel within one wave. Comments are revealed from completed batches, not token-streamed from separate agents.</p></div></details>
        {(error || run?.status === 'paused') && <section className="recovery-panel" role="alert"><b>Session interrupted — your progress is saved.</b><p>{error || run?.error}</p><p><a href="/">Browse saved sessions (no LLM calls)</a></p><p>Missing responses are pending, not counted as “scrolled past”. Saved sessions can still be replayed while the LLM is unavailable.</p><div className="btns">{runId && ['running','paused','analyzing'].includes(run?.status) && <><button disabled={!!busy} onClick={() => {setError(null); drive(runId)}}>Retry pending agents</button><button disabled={!!busy} onClick={cancelSession}>Stop & return to draft</button></>}{previousComplete && <button disabled={!!busy} onClick={showSavedReplay}>Replay last completed session</button>}</div></section>}
        {!error && !busy && run && ['running','analyzing'].includes(run.status) && <div className="btns recovery-resume"><button onClick={() => drive(run._id)}>Resume unfinished session</button><button onClick={cancelSession}>Stop & return to draft</button></div>}
        {(busy || revealing) && <div className="session-message" role="status">{(revealing ? 'Replaying stored reactions · no model calls' : busy)}{revealing && <div className="playback-controls"><button onClick={() => setPaused(!paused)}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button><button onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1)}>{speed}×</button></div>}</div>}
        <div className="signal-deck"><div className="score-block"><span className="micro-label">BACKLASH INDEX</span><strong className={metric.backlashRisk >= 45 ? 'negative' : 'positive'}>{metric.backlashRisk}<small>/100</small></strong><div className="score-meter"><i style={{width: `${metric.backlashRisk}%`, background: metric.backlashRisk >= 45 ? '#f29485' : '#d5f58d'}}/></div></div><div className="score-block"><span className="micro-label">ENGAGEMENT SIGNAL</span><strong>{metric.trendScore}<small>/100</small></strong><div className="score-meter"><i style={{width: `${metric.trendScore}%`}}/></div></div><div className="signal-plot"><div className="signal-plot-head"><span className="micro-label">THE ROOM, OVER TIME</span><span><i/>Risk <i/>Engagement</span></div><SignalChart reactions={withLikes}/></div></div>
        <div className="session-foot"><span>Simulated reactions, not a real-world forecast.</span><span>Sanity Content Lake <i/> MatrAIx personas</span></div>
      </section>
      <aside className="conversation-rail">
        <div className="rail-tabs">{(['crowd','analysis','workflow'] as const).map(t => <button key={t} onClick={() => setRailTab(t)} className={railTab===t ? 'on' : ''}>{t==='crowd' ? 'Conversation' : t==='analysis' ? 'Insights' : 'Workflow'}{t==='analysis' && settled && <i/>}</button>)}</div>
        {railTab === 'crowd' && <>
          <div className="conversation-heading"><div><b>The audience is talking.</b><span>{live.comments+live.replies} comments · {live.shares} shares · {live.scrolledPast} passed</span></div><div className="tabs"><button className={tab==='live'?'on':''} onClick={() => setTab('live')}>Live</button><button className={tab==='threads'?'on':''} onClick={() => setTab('threads')}>Threads</button></div></div>
          {hype && liveActive && <div className="hype-strip"><span className="hype-equalizer" aria-hidden="true"><i/><i/><i/><i/></span><b>{shown.length} / {run?.personaCount || size}</b><span>{revealing ? 'RECORDED SESSION · FAST REVEAL' : 'SIMULATED CROWD · BATCHED RESPONSES'}</span></div>}
          <div className="reaction-ribbon">{EMOJI.map(e => <span key={e}>{EMOJI_CHAR[e]}<b>{live.emoji[e]}</b></span>)}</div>
          <div className="reveal-progress"><i style={{width:`${progress}%`}}/></div>
          {!followLatest && <button className="follow-latest" onClick={() => {autoFollow.current=true;setFollowLatest(true);feedBox.current?.scrollTo({top:feedBox.current.scrollHeight,behavior:'auto'})}}>↓ Follow latest reactions</button>}
          <div className="feed" ref={feedBox} onScroll={e => { const el=e.currentTarget; const following=el.scrollHeight-el.scrollTop-el.clientHeight<100; autoFollow.current=following; setFollowLatest(following) }}>
            {!shown.length && <div className="standby"><div className="standby-orbit"><i/><i/><i/></div><b>{busy ? 'The room is warming up.' : 'Your first audience awaits.'}</b><p>{busy ? 'Agents are forming their first impressions.' : 'Run a simulation for a new simulation, or replay a saved session.'}</p></div>}
          {tab === 'live' &&
            withLikes.map((r) =>
              r.action === 'scroll' ? (
                null
              ) : r.action === 'react' && !r.text ? (
                <div key={r._id} className="react-row">
                  <Avatar p={r.persona} size={20} /> @{r.persona?.handle} reacted {r.emoji ? EMOJI_CHAR[r.emoji] : ''}
                </div>
              ) : (
                <Comment key={r._id} selected={selectedId === r._id} r={r} parent={r.replyTo ? byId.get(r.replyTo._ref) : undefined} evidence={evidence.has(r._id)} />
              ),
            )}
          {tab === 'threads' &&
            threads.roots.map((r) => (
              <div key={r._id} className="thread">
                <Comment r={r} evidence={evidence.has(r._id)} />
                {(threads.kids.get(r._id) || []).map((k) => (
                  <div key={k._id} className="reply-indent">
                    <Comment r={k} evidence={evidence.has(k._id)} />
                  </div>
                ))}
              </div>
            ))}

            <div ref={feedEnd}/>
          </div><div className="rail-foot"><span className={`tiny-dot ${liveActive ? 'on' : ''}`}/>{revealing ? 'Recorded session · replay' : busy ? 'Live from the Content Lake' : 'Stored in Sanity · source-linked'}<span>{shown.length}/{run?.personaCount || size}</span></div>
        </>}
        {railTab === 'analysis' && <div className="rail-scroll"><div className="insight-title"><span className="micro-label">EDITORIAL INTELLIGENCE</span><h2>Read the room.</h2><p>Evidence from this simulated audience, grounded in your brand history.</p></div>
        {settled && a && (
          <div className={`panel analyst v-${a.verdict}`}>
            <h4>
              {a.mode === 'metrics_only' ? 'Analyst unavailable: ' : 'Analyst verdict: '}<span className="verdict">{a.mode === 'metrics_only' ? 'human review' : a.verdict}</span>
            </h4>
            <p className="headline">{a.headline}</p>{a.mode === 'metrics_only' && <p className="fallback-label">METRICS ONLY · AI ANALYST UNAVAILABLE · HUMAN REVIEW REQUIRED</p>}
            <p className="small">{a.summary}</p>
            {flags.map((f: any, i: number) => (
              <div key={i} className={`rflag sev-${f.severity}`}>
                <b>“{f.phrase}”</b>
                <p className="small">{f.why}</p>
                {f.brandMemory && <p className="small memory">📚 Brand memory: {f.brandMemory}</p>}
              </div>
            ))}
            {a.suggestedRevision && (
              <>
                <h5>Suggested rewrite</h5>
                <p className="rewrite">{a.suggestedRevision}</p>
                {(a.changes || []).length > 0 && (
                  <ul className="small changes">
                    {a.changes.map((c: string, i: number) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
                {post.revision === run.revision &&
                  (post.transitions || []).some((t: any) => t.id === 'apply_revision' && t.from.includes(stage)) && (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={async () => {
                        if (await act('apply_revision')) start()
                      }}
                    >
                      Apply rewrite & re-run
                    </button>
                  )}
              </>
            )}
          </div>
        )}

        {cohorts.length > 0 && (
          <div className="panel">
            <h4>Who’s unhappy</h4>
            {cohorts.map((c) => (
              <div key={c.dimension + c.value} className="cohort">
                <span className="small">
                  {c.value} <span className="muted">· {c.dimension} · n={c.n}</span>
                </span>
                <div className="track center">
                  <div
                    className={`fill ${c.avgSentiment < 0 ? 'neg' : 'pos'}`}
                    style={{
                      width: `${Math.abs(c.avgSentiment) * 50}%`,
                      marginLeft: c.avgSentiment < 0 ? `${50 - Math.abs(c.avgSentiment) * 50}%` : '50%',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}


          {!settled && <div className="panel"><p className="muted">The analyst’s verdict appears when the session finishes.</p></div>}
        </div>}
        {railTab === 'workflow' && <div className="rail-scroll"><div className="insight-title"><span className="micro-label">HUMANS HAVE THE LAST WORD</span><h2>From draft to decision.</h2></div><div className="pipeline">{STAGE_ORDER.map(s => <span key={s} className={`pipe ${s===stage ? 'on' : ''} stage-${s}`}>{s.replace(/_/g,' ')}</span>)}</div>
        <div className="panel">
          <h4>Workflow</h4>
          <div className="btns">
            {humanMoves.map((t: any) => (
              <button
                key={t.id}
                className={t.id === 'approve' || t.id === 'publish' ? 'good' : t.id === 'override_approve' ? 'bad' : ''}
                onClick={() => {
                  const note = t.requiresNote ? window.prompt('This post was flagged. Why approve anyway?') || '' : undefined
                  if (t.requiresNote && !note) return
                  act(t.id, {note})
                }}
              >
                🧑 {t.title}
              </button>
            ))}
            {stage === 'ready_for_review' && (
              <button className="ghost" onClick={() => act('approve', {as: 'agent'})} title="Watch the workflow document refuse it">
                🤖 Let the agent approve?
              </button>
            )}
          </div>
          <ul className="events">
            {(post.events || []).map((e: any) => (
              <li key={e._id}>
                <span>{e.actor?.kind === 'agent' ? '🤖' : '🧑'}</span>
                <span>
                  <b>{e.actor?.name}</b> {e.from} → <b>{e.to}</b>
                  {e.note && <em className="muted"> — {e.note}</em>}
                </span>
              </li>
            ))}
          </ul>
          {studioUrl && (
            <a className="small" href={`${studioUrl}/intent/edit/id=${post._id};type=post`} target="_blank" rel="noopener noreferrer">
              Edit in Sanity Studio ↗︎
            </a>
          )}
        </div>
        {(post.runs || []).length > 0 && (
          <div className="panel">
            <h4>Runs</h4>
            <table className="runs mono small">
              <tbody>
                {post.runs.map((r: any) => (
                  <tr
                    key={r._id}
                    className={r._id === runId ? 'on' : ''}
                    onClick={() => {
                      resetFeed()
                      setRunId(r._id)
                      history.replaceState(null, '', `/posts/${post._id}?run=${r._id}`)
                      pull(r._id, true)
                    }}
                  >
                    <td>rev {r.revision}</td>
                    <td>{r.personaCount}p</td>
                    <td className={r.risk >= 45 ? 'bad' : 'good'}>risk {r.risk ?? '—'}</td>
                    <td>trend {r.trend ?? '—'}</td>
                    <td>{r.verdict || r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {log.length > 0 && (
          <div className="panel">
            <h4>Agent log</h4>
            <pre className="log">{log.join('\n')}</pre>
          </div>
        )}

          {post.audience?.groqFilter && <details className="panel"><summary>Audience query</summary><code className="groq">{post.audience.groqFilter}</code></details>}
        </div>}
      </aside>
    </div>
  </main>
}

function Comment({r, parent, evidence, selected}: {r: Reaction; parent?: Reaction; evidence?: boolean; selected?: boolean}) {
  const [open, setOpen] = useState(false)
  const s = r.sentiment ?? 0
  return (
    <div data-reaction-id={r._id} data-selected={selected || undefined} className={`comment ${r.flag?.category ? 'flagged' : ''} ${evidence ? 'evidence' : ''} enter`}>
      <Avatar p={r.persona} />
      <div className="cbody">
        <div className="cmeta">
          <b>@{r.persona?.handle}</b>
          <span className="muted small">
            {r.persona?.generation} · {r.persona?.region}
          </span>
          {r.action === 'share' && <span className="tag">shared</span>}
          {r.flag?.category && <span className="tag bad">⚑ {r.flag.category.replace('_', ' ')}</span>}
          <span className={`sent ${s <= -0.3 ? 'neg' : s >= 0.3 ? 'pos' : ''}`}>{s > 0 ? '+' : ''}{s.toFixed(1)}</span>
        </div>
        {parent && <div className="replying muted small">↪ replying to @{parent.persona?.handle}: “{parent.text?.slice(0, 60)}”</div>}
        <div className="ctext">
          {r.text} {r.emoji && <span>{EMOJI_CHAR[r.emoji]}</span>}
        </div>
        <div className="cfoot small muted">
          <span>❤ {r.likes || 0}</span>
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? 'hide' : 'why?'}
          </button>
        </div>
        {open && (
          <div className="why small">
            <div>💭 {r.thought || '—'}</div>
            {r.flag?.reason && <div>⚑ {r.flag.reason}</div>}
            <div className="muted">
              {r.persona?.summary} <br />
              MatrAIx record: {r.persona?.matraix?.source} / {r.persona?.matraix?.recordId}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
