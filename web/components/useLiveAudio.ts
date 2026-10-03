'use client'

import {useCallback, useEffect, useRef, useState} from 'react'

type AudioWindow = Window & {webkitAudioContext?: typeof AudioContext}
type Cue = 'comment' | 'reply' | 'react' | 'flag' | 'complete'

/**
 * Locally synthesized livestream audio: punchy cues per reaction plus a driving
 * beat while the room is live. On by default at full volume. Browsers only allow
 * audio after a user gesture, so the context unlocks on the first click/keypress.
 */
export function useLiveAudio() {
  const [enabled, setEnabled] = useState(true)
  const [volume, setVolume] = useState(1)
  const [audioError, setAudioError] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const master = useRef<GainNode | null>(null)
  const noise = useRef<AudioBuffer | null>(null)
  const settings = useRef({enabled: true, volume: 1})
  const lastCue = useRef(0)
  const beat = useRef<{timer: ReturnType<typeof setInterval> | null; next: number; step: number}>({timer: null, next: 0, step: 0})
  const wantBeat = useRef(false)

  const applyGain = useCallback(() => {
    const ctx = ctxRef.current
    if (ctx && master.current) master.current.gain.setTargetAtTime(settings.current.enabled ? settings.current.volume : 0, ctx.currentTime, 0.015)
  }, [])

  const ensure = useCallback(async () => {
    try {
      if (!ctxRef.current) {
        const Ctor = window.AudioContext || (window as AudioWindow).webkitAudioContext
        if (!Ctor) throw new Error('no audio')
        const ctx = new Ctor()
        const gain = ctx.createGain()
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -10
        comp.knee.value = 6
        comp.ratio.value = 4
        comp.attack.value = 0.002
        comp.release.value = 0.12
        gain.connect(comp)
        comp.connect(ctx.destination)
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
        ctxRef.current = ctx
        master.current = gain
        noise.current = buf
      }
      if (ctxRef.current.state !== 'running') await ctxRef.current.resume()
      applyGain()
      const ok = ctxRef.current.state === 'running'
      setUnlocked(ok)
      return ok
    } catch {
      setAudioError('Sound unavailable in this browser. The simulation still works.')
      return false
    }
  }, [applyGain])

  // ---------------------------------------------------------------- instruments
  const osc = (type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number) => {
    const ctx = ctxRef.current!, out = master.current!
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + dur + 0.02)
    o.onended = () => { o.disconnect(); g.disconnect() }
  }
  const hiss = (t: number, dur: number, peak: number, freq: number) => {
    const ctx = ctxRef.current!, out = master.current!
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = noise.current
    f.type = 'highpass'
    f.frequency.value = freq
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(out)
    src.start(t)
    src.stop(t + dur + 0.02)
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect() }
  }
  const kick = (t: number) => { osc('sine', 165, 42, t, 0.32, 1); hiss(t, 0.015, 0.4, 3000) }
  const clap = (t: number) => { hiss(t, 0.11, 0.55, 1200); hiss(t + 0.012, 0.09, 0.4, 1500) }
  const hat = (t: number, open = false) => hiss(t, open ? 0.12 : 0.035, open ? 0.22 : 0.16, 8000)
  const bass = (t: number, f: number) => osc('sawtooth', f, f * 0.98, t, 0.2, 0.28)

  const live = () => !!ctxRef.current && ctxRef.current.state === 'running' && settings.current.enabled && !document.hidden

  const play = useCallback((kind: Cue) => {
    if (!live()) return
    const now = performance.now()
    if (kind !== 'complete' && now - lastCue.current < 85) return
    lastCue.current = now
    const t = ctxRef.current!.currentTime + 0.005
    if (kind === 'comment') { osc('triangle', 1250, 620, t, 0.11, 0.85); osc('square', 2500, 1800, t, 0.03, 0.12) }
    else if (kind === 'reply') { osc('triangle', 900, 1350, t, 0.07, 0.8); osc('triangle', 1350, 1800, t + 0.07, 0.09, 0.7) }
    else if (kind === 'flag') { osc('sawtooth', 300, 120, t, 0.24, 0.5); osc('square', 150, 90, t, 0.24, 0.3) }
    else if (kind === 'react') { osc('sine', 1700, 1150, t, 0.06, 0.6) }
    else {
      ;[523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, f, t + i * 0.09, 0.28, 0.75))
      hiss(t + 0.36, 0.5, 0.35, 5000)
    }
  }, [])

  // ---------------------------------------------------------------- beat loop (128 BPM)
  const tick = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !live() || !wantBeat.current) return
    const sixteenth = 60 / 128 / 4
    if (beat.current.next < ctx.currentTime) beat.current.next = ctx.currentTime + 0.03
    while (beat.current.next < ctx.currentTime + 0.25) {
      const t = beat.current.next, s = beat.current.step % 16
      if (s % 4 === 0) kick(t)
      if (s === 4 || s === 12) clap(t)
      if (s % 2 === 1) hat(t, s === 7 || s === 15)
      if (s === 0 || s === 3 || s === 6 || s === 10) bass(t, s < 8 ? 55 : 49)
      beat.current.next += sixteenth
      beat.current.step++
    }
  }, [])

  const setBeat = useCallback((on: boolean) => {
    wantBeat.current = on
    const b = beat.current
    if (on && !b.timer) {
      b.next = 0
      b.step = 0
      b.timer = setInterval(tick, 60)
    } else if (!on && b.timer) {
      clearInterval(b.timer)
      b.timer = null
    }
  }, [tick])

  const silence = useCallback(() => setBeat(false), [setBeat])

  const toggle = useCallback(async () => {
    const next = !settings.current.enabled
    settings.current.enabled = next
    setEnabled(next)
    setAudioError('')
    if (next) await ensure()
    applyGain()
  }, [ensure, applyGain])

  const changeVolume = useCallback((v: number) => {
    settings.current.volume = Math.max(0, Math.min(1, v))
    setVolume(settings.current.volume)
    applyGain()
  }, [applyGain])

  // Unlock on the first real interaction (browser autoplay policy).
  useEffect(() => {
    const unlock = () => { if (settings.current.enabled) ensure() }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    const vis = () => { if (document.hidden) ctxRef.current?.suspend().catch(() => {}); else if (settings.current.enabled) ctxRef.current?.resume().catch(() => {}) }
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      document.removeEventListener('visibilitychange', vis)
      if (beat.current.timer) clearInterval(beat.current.timer)
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    }
  }, [ensure])

  return {enabled, volume, audioError, unlocked, toggle, changeVolume, play, silence, setBeat}
}
