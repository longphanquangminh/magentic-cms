'use client'

import {useMemo} from 'react'
import {computeMetrics} from '@/lib/metrics'

/** The dots are audience slots, coloured only by actual stored reaction data. */
export function AudienceStage({reactions, total, active}: {reactions: any[]; total: number; active: boolean}) {
  const nodes = useMemo(() => Array.from({length: Math.min(120, total)}, (_, i) => {
    const lane = i % 3
    const angle = (i / Math.max(1, total) * Math.PI * 2) + lane * .36
    return {x: 500 + Math.cos(angle) * (315 + lane * 55), y: 275 + Math.sin(angle) * (165 + lane * 33)}
  }), [total])
  const latest = reactions.length - 1
  return <svg className="audience-field" viewBox="0 0 1000 550" aria-label={`${reactions.length} of ${total} simulated audience members processed`}>
    {[0,1,2].map(l => <ellipse key={l} cx="500" cy="275" rx={315+l*55} ry={165+l*33} fill="none" stroke="#353b36" strokeDasharray={l === 1 ? '2 7' : undefined} opacity=".65" />)}
    {nodes.map((p,i) => {
      const r = reactions[i]
      const c = !r ? '#303831' : r.action === 'scroll' ? '#5b645d' : (r.sentiment || 0) < -.3 ? '#f29485' : (r.sentiment || 0) > .3 ? '#d5f58d' : '#b8c0b1'
      const fresh = active && i > latest-4 && i <= latest
      return <g key={r?._id || i}>
        {fresh && <path className="audience-ray" d={`M500 275 L${p.x} ${p.y}`} stroke={c} strokeWidth="1" opacity=".35" />}
        {fresh && <circle className="audience-pulse" cx={p.x} cy={p.y} r="20" fill="none" stroke={c} />}
        <circle cx={p.x} cy={p.y} r={r ? 13 : 5} fill={r ? '#202720' : c} stroke={r ? c : 'none'} strokeWidth="1.3" />
        {r && <text x={p.x} y={p.y+4} textAnchor="middle" fill={c} fontSize="10" fontFamily="Inter, sans-serif">{(r.persona?.displayName || r.persona?.handle || '·').slice(0,1).toUpperCase()}</text>}
        <title>{r ? `@${r.persona?.handle} · ${r.action} · sentiment ${r.sentiment || 0}` : 'Awaiting reaction'}</title>
      </g>
    })}
  </svg>
}

/** A trajectory computed from cumulative reactions, never a decorative fake graph. */
export function SignalChart({reactions}: {reactions: any[]}) {
  const data = useMemo(() => {
    if (!reactions.length) return []
    const stride = Math.max(1, Math.ceil(reactions.length / 36))
    const a = []
    for (let i = 1; i < reactions.length; i += stride) a.push(computeMetrics(reactions.slice(0,i)))
    a.push(computeMetrics(reactions))
    return a
  }, [reactions])
  const path = (key: 'backlashRisk' | 'trendScore') => data.map((d,i) => `${i ? 'L' : 'M'}${8+i/Math.max(1,data.length-1)*484},${84-d[key]*.7}`).join(' ')
  return <svg className="signal-chart" viewBox="0 0 500 95" role="img" aria-label="Cumulative simulated backlash and engagement scores">
    {[14,49,84].map(y => <line key={y} x1="8" x2="492" y1={y} y2={y} stroke="#30362f" strokeDasharray="2 5"/>)}
    {data.length > 0 && <><path d={path('backlashRisk')} fill="none" stroke="#f29485" strokeWidth="2"/><path d={path('trendScore')} fill="none" stroke="#d5f58d" strokeWidth="2"/></>}
    {!data.length && <text x="250" y="50" fill="#737e71" fontSize="11" textAnchor="middle">Signal appears as the audience reacts</text>}
  </svg>
}
