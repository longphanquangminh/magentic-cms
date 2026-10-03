import Link from 'next/link'
import './home-v2.css'
import {sanity, notDraft} from '@/lib/sanity'
import {healStaleRuns} from '@/lib/heal'

export const dynamic = 'force-dynamic'

type Row = {
  _id: string
  title: string
  body: string
  stage?: string
  platform?: string
  revision?: number
  brand?: {name: string}
  audience?: {title: string}
  last?: {risk?: number; trend?: number; verdict?: string; status?: string}
  runs: number
}

export default async function Home() {
  await healStaleRuns().catch(() => null)
  const [posts, stats] = await Promise.all([
    sanity.fetch<Row[]>(
      `*[_type == "post" && ${notDraft}] | order(_updatedAt desc){
        _id, title, body, stage, platform, revision, "brand": brand->{name}, "audience": audience->{title},
        "last": latestRun->{"risk": metrics.backlashRisk, "trend": metrics.trendScore, "verdict": analysis.verdict, status},
        "runs": count(*[_type == "simulationRun" && post._ref == ^._id])
      }`,
    ),
    sanity.fetch<{personas: number; reactions: number; runs: number}>(
      `{"personas": count(*[_type == "persona"]), "reactions": count(*[_type == "reaction"]), "runs": count(*[_type == "simulationRun"])}`,
    ),
  ])
  const featured = posts[0]
  const format = (value: number) => value.toLocaleString('en-US')

  return (
    <main className="homev2">
      <div className="homev2-shell">
        <section className="homev2-hero" aria-labelledby="homev2-title">
          <div className="homev2-intro">
            <p className="homev2-eyebrow"><span className="homev2-dot" /> PUBLICATION REHEARSAL</p>
            <h1 id="homev2-title">Your next post.<br /><em>Meet its first<br className="homev2-desktop-break" /> audience.</em></h1>
            <p className="homev2-lede">A little friction. A different perspective. A better draft. Put your words in front of a simulated audience before the world weighs in.</p>
            <a className="homev2-cta" href="/compose">Write & test your post <span aria-hidden="true">↗︎</span></a>
            <p className="homev2-note">Survey-grounded personas. Live reactions. Human approval.</p>
          </div>
          <div className="homev2-theatre" aria-label="Simulated audience illustration and latest draft">
            <div className="homev2-theatre-top"><span className="homev2-mono">THE REHEARSAL ROOM</span><span className="homev2-simulation">SIMULATED AUDIENCE</span></div>
            <div className="homev2-orbit" aria-hidden="true">
              <div className="homev2-orbit-ring homev2-orbit-ring-outer" />
              <div className="homev2-orbit-ring homev2-orbit-ring-inner" />
              <svg className="homev2-connectors" viewBox="0 0 500 330" fill="none"><path d="M90 100L250 180L410 85M115 270L250 180L415 255M250 30V180" stroke="currentColor" strokeDasharray="3 7" /></svg>
              <span className="homev2-avatar homev2-avatar-a">P₁</span><span className="homev2-avatar homev2-avatar-b">P₂</span><span className="homev2-avatar homev2-avatar-c">P₃</span><span className="homev2-avatar homev2-avatar-d">P₄</span><span className="homev2-avatar homev2-avatar-e">P₅</span>
              <div className="homev2-core"><svg width="46" height="46" viewBox="0 0 48 48" fill="none"><path d="M10 34V14L24 26L38 14V34" stroke="currentColor" strokeWidth="3" /><circle cx="24" cy="9" r="3" fill="currentColor" /></svg><span>YOUR DRAFT</span></div>
              <span className="homev2-orbit-label">Different lenses. One conversation.</span>
            </div>
            <div className="homev2-feature">
              <div className="homev2-feature-meta"><span className="homev2-mono">{featured ? 'LATEST IN THE ROOM' : 'THE ROOM IS YOURS'}</span><span aria-hidden="true">↗︎</span></div>
              {featured ? <Link href={`/posts/${featured._id}`} className="homev2-feature-link"><h2>{featured.title}</h2><p>{featured.audience?.title || 'Everyone'} <span>· {featured.runs} {featured.runs === 1 ? 'rehearsal' : 'rehearsals'}</span></p></Link> : <><h2>Start with a draft.<br />Make room for perspective.</h2><p>Create your first post in Studio to begin.</p></>}
            </div>
            <p className="homev2-illustration-note">Abstract persona illustration · not real people or live activity</p>
          </div>
        </section>
        <section className="homev2-data" aria-label="Current Content Lake statistics">
          <div className="homev2-data-intro"><span className="homev2-mono">CONNECTED TO SANITY</span><p>The audience,<br />behind the conversation.</p></div>
          <div className="homev2-stat"><strong>{format(stats.personas)}</strong><span>Persona agents</span></div>
          <div className="homev2-stat"><strong>{format(stats.runs)}</strong><span>Simulation runs</span></div>
          <div className="homev2-stat"><strong>{format(stats.reactions)}</strong><span>Recorded reactions</span></div>
        </section>
        <section className="homev2-posts" id="homev2-posts" aria-labelledby="homev2-posts-title">
          <div className="homev2-section-head"><div><p className="homev2-eyebrow">FROM DRAFT TO DIALOGUE</p><h2 id="homev2-posts-title">On the rehearsal floor<span>.</span></h2></div><span className="homev2-count">{format(posts.length)} {posts.length === 1 ? 'POST' : 'POSTS'} / LATEST FIRST</span></div>
          <div className="homev2-grid">
            {posts.map((p, index) => (
              <Link key={p._id} href={`/posts/${p._id}`} className="homev2-card">
                <div className="homev2-card-top"><span className={`homev2-stage homev2-stage-${p.stage || 'draft'}`}>{(p.stage || 'draft').replace(/_/g, ' ')}</span><span className="homev2-card-index">{String(index + 1).padStart(2, '0')} <span aria-hidden="true">↗︎</span></span></div>
                <p className="homev2-card-platform">{p.platform || 'Post'} <span>/ REV {p.revision || 1}</span></p>
                <h3>{p.title}</h3>
                <p className="homev2-card-body">{p.body || 'Your next conversation starts here.'}</p>
                <div className="homev2-card-audience"><span className="homev2-brand-avatar" aria-hidden="true">{(p.brand?.name || 'MC').slice(0, 2).toUpperCase()}</span><div><strong>{p.brand?.name || 'Unassigned brand'}</strong><span>For {p.audience?.title || 'Everyone'}</span></div></div>
                <div className="homev2-card-bottom"><span>{p.runs} {p.runs === 1 ? 'rehearsal' : 'rehearsals'}</span>{p.last?.risk != null || p.last?.trend != null ? <div className="homev2-scores">{p.last?.risk != null && <span>Risk <b>{p.last.risk}</b></span>}{p.last?.trend != null && <span>Trend <b>{p.last.trend}</b></span>}</div> : <span className="homev2-awaiting">Awaiting simulation</span>}</div>
              </Link>
            ))}
          </div>
          {!posts.length && <div className="homev2-empty"><span className="homev2-mono">NO DRAFTS ON THE FLOOR — YET</span><h3>Every conversation starts somewhere.</h3><p>Create a post in Studio, or run the seed script to explore your first rehearsal.</p></div>}
        </section>
        <footer className="homev2-footer"><span className="homev2-mono">REHEARSE. REFINE. RELEASE.</span><p>Simulations offer perspective, not predictions. The decision to publish stays with you.</p></footer>
      </div>
    </main>
  )
}
