'use client'

import {useEffect, useId, useMemo, useRef, useState} from 'react'
import type * as THREE from 'three'
import '../app/audience-world.css'

type Cohort = 'negative' | 'neutral' | 'positive' | 'pass'
type Props = {reactions: any[]; total: number; active: boolean; onSelect?: (r: any) => void; selectedId?: string | null}
type Snapshot = {reactions: any[]; selectedId: string | null; active: boolean}
type World = {sync: (data: Snapshot) => void; reset: () => void}
const COHORTS: Cohort[] = ['negative', 'neutral', 'positive', 'pass']
const COLORS = {negative: '#f29485', neutral: '#b8c0b1', positive: '#d5f58d', pass: '#77826e'}
const TITLES = {negative: 'NEGATIVE', neutral: 'NEUTRAL', positive: 'POSITIVE', pass: 'PASS / SCROLLED'}
// Same expressed-sentiment cutoffs as AudienceStage; scrolling is always separate.
function cohort(r: any): Cohort {
  if (r.action === 'scroll') return 'pass'
  const sentiment = Number(r.sentiment ?? 0)
  return sentiment < -.3 ? 'negative' : sentiment > .3 ? 'positive' : 'neutral'
}
function person(r: any) {return r?.persona?.handle ? `@${String(r.persona.handle).replace(/^@/, '')}` : r?.persona?.displayName || 'Unnamed participant'}

/** One miniature per stored reaction. All connectors represent stored replyTo references. */
export default function AudienceWorld({reactions, total, active, onSelect, selectedId}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<World | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [localId, setLocalId] = useState<string | null>(null)
  const [hover, setHover] = useState<{id: string; x: number; y: number} | null>(null)
  const selectId = selectedId === undefined ? localId : selectedId
  const labelId = useId()
  // Persisted records have IDs; ignore duplicate snapshots of the same record.
  const actual = useMemo(() => [...new Map(reactions.filter(r => r?._id).map(r => [String(r._id), r])).values()], [reactions])
  const groups = useMemo(() => Object.fromEntries(COHORTS.map(c => [c, actual.filter(r => cohort(r) === c)])) as Record<Cohort, any[]>, [actual])
  const selected = actual.find(r => r._id === selectId)
  const hovered = actual.find(r => r._id === hover?.id)
  const parent = selected ? actual.find(r => r._id === selected.replyTo?._ref) : null
  const children = selected ? actual.filter(r => r.replyTo?._ref === selected._id) : []
  const latestRef = useRef<Snapshot>({reactions: actual, selectedId: selectId, active})
  latestRef.current = {reactions: actual, selectedId: selectId, active}
  const chooseRef = useRef<(r: any) => void>(() => {})
  chooseRef.current = (r: any) => {setLocalId(r._id); onSelect?.(r)}

  useEffect(() => {
    worldRef.current?.sync(latestRef.current)
  }, [actual, selectId, active])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let stopped = false
    let release: (() => void) | undefined
    // No WebGL or browser-only library evaluation on the server.
    Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]).then(([T, {OrbitControls}]) => {
      if (stopped) return
      const scene = new T.Scene()
      scene.background = new T.Color('#192018')
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      const textures = new Set<THREE.Texture>()
      const geometry = <G extends THREE.BufferGeometry>(g: G): G => {geometries.add(g); return g}
      const material = <M extends THREE.Material>(m: M): M => {materials.add(m); return m}
      let renderer: THREE.WebGLRenderer | undefined
      let controls: InstanceType<typeof OrbitControls> | undefined
      let observer: ResizeObserver | undefined
      let frame = 0
      let disposed = false
      const listeners: (() => void)[] = []
      release = () => {
        if (disposed) return
        disposed = true
        cancelAnimationFrame(frame)
        observer?.disconnect()
        listeners.forEach(fn => fn())
        controls?.dispose()
        geometries.forEach(g => g.dispose())
        materials.forEach(m => m.dispose())
        textures.forEach(t => t.dispose())
        renderer?.dispose()
        renderer?.domElement.remove()
        worldRef.current = null
      }
      try {
        renderer = new T.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'low-power'})
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
        renderer.outputColorSpace = T.SRGBColorSpace
        renderer.setClearColor('#192018')
        const canvas = renderer.domElement
        canvas.setAttribute('aria-hidden', 'true')
        host.appendChild(canvas)
        const camera = new T.OrthographicCamera(-9, 9, 6, -6, .1, 150)
        controls = new OrbitControls(camera, canvas)
        controls.enableDamping = false
        controls.enablePan = false
        controls.minPolarAngle = .25
        controls.maxPolarAngle = Math.PI / 2.6
        controls.minZoom = .5
        controls.maxZoom = 3
        controls.rotateSpeed = .65
        controls.zoomSpeed = .7
        scene.add(new T.HemisphereLight('#fff9e9', '#26341f', 2.1))
        const sun = new T.DirectionalLight('#fff5df', 2.7)
        sun.position.set(-6, 12, 9)
        scene.add(sun)
        const draw = () => {
          if (stopped || disposed || document.hidden || frame) return
          frame = requestAnimationFrame(() => {
            frame = 0
            if (!stopped && !document.hidden) renderer?.render(scene, camera)
          })
        }
        controls.addEventListener('change', draw)
        let visible = true
        const visibility = () => {
          visible = !document.hidden
          if (!visible) {cancelAnimationFrame(frame); frame = 0}
          else draw()
        }
        document.addEventListener('visibilitychange', visibility)
        listeners.push(() => document.removeEventListener('visibilitychange', visibility))
        // Demand-rendering (no idle spin, auto-rotation or entrance animation) also respects reduced motion.
        const box = geometry(new T.BoxGeometry(1, 1, 1))
        const body = geometry(new T.CylinderGeometry(.12, .17, .34, 7))
        const head = geometry(new T.SphereGeometry(.12, 10, 8))
        const foot = geometry(new T.CylinderGeometry(.19, .21, .035, 12))
        const ringGeometry = geometry(new T.TorusGeometry(.25, .025, 6, 24))
        const actorMaterials = Object.fromEntries(COHORTS.map(c => [c, material(new T.MeshStandardMaterial({color: COLORS[c], roughness: .95, metalness: 0}))])) as Record<Cohort, THREE.MeshStandardMaterial>
        const slabMaterial = material(new T.MeshStandardMaterial({color: '#2a3623', roughness: 1}))
        const laneMaterial = material(new T.MeshStandardMaterial({color: '#202a1d', roughness: 1}))
        const tableMaterial = material(new T.MeshStandardMaterial({color: '#222d1d', roughness: 1}))
        const ringMaterial = material(new T.MeshBasicMaterial({color: '#eff1e8'}))
        const relationMaterial = material(new T.MeshBasicMaterial({color: '#fff1a3', transparent: true, opacity: .95, depthTest: false}))
        const table = new T.Mesh(box, tableMaterial)
        table.position.y = -.30
        scene.add(table)
        const slabs = COHORTS.map((c, i) => {
          const slab = new T.Mesh(box, c === 'pass' ? laneMaterial : slabMaterial)
          slab.position.set(c === 'pass' ? 0 : (i - 1) * 4.65, -.08, 0)
          scene.add(slab)
          return slab
        })
        const signs = COHORTS.map((c, i) => {
          const labelCanvas = document.createElement('canvas')
          labelCanvas.width = c === 'pass' ? 1024 : 512
          labelCanvas.height = 96
          const texture = new T.CanvasTexture(labelCanvas)
          texture.colorSpace = T.SRGBColorSpace
          textures.add(texture)
          const sign = new T.Mesh(geometry(new T.PlaneGeometry(c === 'pass' ? 8 : 3.9, .65)), material(new T.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, side: T.DoubleSide})))
          sign.rotation.x = -Math.PI / 2
          sign.position.set(c === 'pass' ? 0 : (i - 1) * 4.65, .065, 1.08)
          scene.add(sign)
          return {canvas: labelCanvas, texture, mesh: sign, count: -1}
        })
        type Actor = {group: THREE.Group; cohort: Cohort; slot: number; r: any}
        const actors = new Map<string, Actor>()
        const relations = new T.Group()
        scene.add(relations)
        const selection = new T.Mesh(ringGeometry, ringMaterial)
        selection.rotation.x = -Math.PI / 2
        selection.visible = false
        scene.add(selection)
        let depth = 4
        let passRows = 1
        let width = 1, height = 1
        let tableBack = -3, tableFront = 4
        const reset = () => {
          const centerZ = (tableBack + tableFront) / 2
          camera.position.set(8, 17 + depth * .18, 19 + centerZ)
          controls!.target.set(0, 0, centerZ)
          camera.zoom = 1
          controls!.update()
          fit()
        }
        const fit = () => {
          const aspect = width / height
          camera.updateMatrixWorld()
          // Fit actual tabletop bounds, including an arbitrarily long PASS lane.
          let extentX = 0, extentY = 0
          for (const x of [-7.7, 7.7]) for (const z of [tableBack - .5, tableFront + .5]) for (const y of [-.5, .8]) {
            const p = new T.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse)
            extentX = Math.max(extentX, Math.abs(p.x))
            extentY = Math.max(extentY, Math.abs(p.y))
          }
          const halfHeight = Math.max(extentY + .8, (extentX + .7) / aspect)
          camera.left = -halfHeight * aspect
          camera.right = halfHeight * aspect
          camera.top = halfHeight
          camera.bottom = -halfHeight
          camera.updateProjectionMatrix()
          draw()
        }
        const resize = () => {
          width = Math.max(1, host.clientWidth)
          height = Math.max(1, host.clientHeight)
          renderer!.setSize(width, height, false)
          fit()
        }
        observer = new ResizeObserver(resize)
        observer.observe(host)
        const sync = (data: Snapshot) => {
          const records = new Map(data.reactions.map(r => [String(r._id), r]))
          actors.forEach((a, id) => {
            const updated = records.get(id)
            if (!updated || cohort(updated) !== a.cohort) {
              scene.remove(a.group)
              actors.delete(id)
            }
          })
          for (const r of data.reactions) {
            const id = String(r._id)
            if (actors.has(id)) {actors.get(id)!.r = r; continue}
            const c = cohort(r)
            const used = new Set([...actors.values()].filter(a => a.cohort === c).map(a => a.slot))
            let slot = 0
            while (used.has(slot)) slot++
            const group = new T.Group()
            const torso = new T.Mesh(body, actorMaterials[c])
            torso.position.y = .23
            const face = new T.Mesh(head, actorMaterials[c])
            face.position.y = .53
            const base = new T.Mesh(foot, actorMaterials[c])
            base.position.y = .035
            group.add(torso, face, base)
            group.userData.reactionId = id
            const columns = c === 'pass' ? 22 : 6
            const column = slot % columns
            const row = Math.floor(slot / columns)
            group.position.set(c === 'pass' ? (column - 10.5) * .57 : (COHORTS.indexOf(c) - 1) * 4.65 + (column - 2.5) * .57, .05, c === 'pass' ? 3 + row * .59 : .35 - row * .66)
            scene.add(group)
            actors.set(id, {group, cohort: c, slot, r})
          }
          const mainSlots = [...actors.values()].filter(a => a.cohort !== 'pass').map(a => Math.floor(a.slot / 6) + 1)
          depth = Math.max(3.6, Math.max(0, ...mainSlots) * .66 + .75)
          passRows = Math.max(1, ...[...actors.values()].filter(a => a.cohort === 'pass').map(a => Math.floor(a.slot / 22) + 1))
          const passDepth = passRows * .59 + 1
          const back = .95 - depth
          const front = 2.5 + passDepth
          tableBack = back
          tableFront = front
          const shift = (front + back) / 2 - controls!.target.z
          controls!.target.z += shift
          camera.position.z += shift
          controls!.update()
          table.scale.set(14.8, .35, front - back + .65)
          table.position.z = (front + back) / 2
          slabs.forEach((slab, i) => {
            if (i === 3) {slab.scale.set(13.7, .2, passDepth); slab.position.z = 2.5 + passDepth / 2}
            else {slab.scale.set(4.25, .2, depth + .65); slab.position.z = 1.05 - depth / 2}
            const count = [...actors.values()].filter(a => a.cohort === COHORTS[i]).length
            const sign = signs[i]
            if (i === 3) sign.mesh.position.z = front - .23
            if (sign.count !== count) {
              sign.count = count
              const ctx = sign.canvas.getContext('2d')!
              ctx.clearRect(0, 0, sign.canvas.width, 96)
              ctx.fillStyle = COLORS[COHORTS[i]]
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.font = '500 36px sans-serif'
              ctx.fillText(`${TITLES[COHORTS[i]]}  /  ${count}`, sign.canvas.width / 2, 48)
              sign.texture.needsUpdate = true
            }
          })
          // Rebuild only the small relationship overlay, not the scene or its actors.
          for (const child of [...relations.children]) {
            const line = child as THREE.Line
            line.geometry.dispose()
            relations.remove(line)
          }
          actors.forEach((a,id) => a.group.scale.setScalar(id === data.selectedId ? 1.3 : 1))
          const picked = data.selectedId ? actors.get(data.selectedId) : undefined
          selection.visible = !!picked
          if (picked) {
            selection.position.copy(picked.group.position)
            selection.position.y = .095
            for (const a of actors.values()) {
              const parentId = a.r.replyTo?._ref
              if (!parentId || (a.r._id !== data.selectedId && parentId !== data.selectedId)) continue
              const p = actors.get(parentId)
              if (!p || p === a) continue
              const from = p.group.position.clone().add(new T.Vector3(0, .55, 0))
              const to = a.group.position.clone().add(new T.Vector3(0, .55, 0))
              const midpoint = from.clone().lerp(to, .5)
              midpoint.y += Math.min(1.6, from.distanceTo(to) * .17 + .35)
              const curve = new T.QuadraticBezierCurve3(from, midpoint, to)
              const line = new T.Mesh(new T.TubeGeometry(curve,28,.025,5,false), relationMaterial)
              line.renderOrder = 2
              relations.add(line)
            }
          }
          fit()
        }
        const raycaster = new T.Raycaster()
        const pointer = new T.Vector2()
        const hit = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect()
          pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1)
          raycaster.setFromCamera(pointer, camera)
          const intersections = raycaster.intersectObjects([...actors.values()].map(a => a.group), true)
          return intersections[0]?.object.parent?.userData.reactionId as string | undefined
        }
        let down: {x: number; y: number} | null = null
        const onDown = (e: PointerEvent) => {down = {x: e.clientX, y: e.clientY}; setHover(null)}
        const onMove = (e: PointerEvent) => {
          if (down) return
          const id = hit(e)
          canvas.style.cursor = id ? 'pointer' : 'grab'
          const bounds = host.getBoundingClientRect()
          setHover(id ? {id, x: Math.max(8, Math.min(e.clientX - bounds.left + 14, bounds.width - 260)), y: Math.max(8, Math.min(e.clientY - bounds.top + 16, bounds.height - 145))} : null)
        }
        const onUp = (e: PointerEvent) => {
          const origin = down
          down = null
          if (!origin || Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 6) return
          const id = hit(e)
          if (id) {const r = actors.get(id)?.r; if (r) chooseRef.current(r)}
        }
        const onLeave = () => {setHover(null); down = null; canvas.style.cursor = 'grab'}
        const onLost = (e: Event) => {e.preventDefault(); setStatus('fallback'); release?.()}
        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointerleave', onLeave)
        canvas.addEventListener('pointercancel', onLeave)
        canvas.addEventListener('webglcontextlost', onLost)
        listeners.push(() => {
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointerleave', onLeave)
          canvas.removeEventListener('pointercancel', onLeave)
          canvas.removeEventListener('webglcontextlost', onLost)
          relations.children.forEach(c => (c as THREE.Line).geometry.dispose())
        })
        worldRef.current = {sync, reset}
        sync(latestRef.current)
        resize()
        reset()
        setStatus('ready')
      } catch {
        release?.()
        if (!stopped) setStatus('fallback')
      }
    }).catch(() => {if (!stopped) setStatus('fallback')})
    return () => {stopped = true; release?.()}
  }, [])

  return <section className="audience-world" aria-labelledby={labelId}>
    <header className="aw-header">
      <div><h3 id={labelId}>The audience, in perspective</h3><p>One figure = one stored simulated reaction</p></div>
      <div className="aw-progress"><strong>{actual.length}<span> / {total}</span></strong><small>{Math.max(0, total - actual.length)} awaiting · {active ? 'Live' : 'Paused / complete'}</small></div>
    </header>
    <div className="aw-cohorts" aria-label="Actual reaction counts by expressed sentiment">
      {COHORTS.map(c => <div key={c} className={`aw-cohort aw-${c}`}><i aria-hidden="true"/><span>{TITLES[c]}</span><b>{groups[c].length}</b></div>)}
    </div>
    <div className={`aw-viewport ${status === 'fallback' ? 'aw-fallback' : ''}`}>
      <div className="aw-canvas" ref={hostRef}/>
      {status === 'loading' && <div className="aw-loading" role="status">Preparing audience table…<span>Participant selection is available below.</span></div>}
      {status === 'ready' && <><div className="aw-camera"><span>Drag to orbit · scroll / pinch to zoom</span><button type="button" onClick={() => worldRef.current?.reset()}>Reset view</button></div>
        {!actual.length && <div className="aw-empty">The room is ready.<span>Figures appear when reactions arrive.</span></div>}
        {hover && hovered && <div className="aw-tooltip" role="tooltip" style={{left: hover.x, top: hover.y}}><b>{person(hovered)}</b><small>{hovered.emoji} {hovered.action} · {TITLES[cohort(hovered)]}</small><p>{hovered.text || 'No written response.'}</p><span>Click to inspect this reaction</span></div>}</>}
      {status === 'fallback' && <div className="aw-fallback-content"><p className="aw-fallback-note">2D audience view · 3D is unavailable on this device. Every stored participant remains selectable.</p>
        <div className="aw-fallback-groups">{COHORTS.map(c => <section key={c} className={`aw-fallback-cohort aw-${c}`}><h4>{TITLES[c]} <span>{groups[c].length}</span></h4><div>{groups[c].map(r => <button type="button" key={r._id} aria-pressed={selectId === r._id} onClick={() => chooseRef.current(r)} title={`${person(r)} · ${r.action}${r.text ? ` · ${r.text}` : ''}`}><i className="aw-person" aria-hidden="true"/><span>{person(r)}</span></button>)}{!groups[c].length && <small>No reactions yet</small>}</div></section>)}</div>
      </div>}
    </div>
    <footer className="aw-footer">
      <div className="aw-select"><label htmlFor={`${labelId}-select`}>Inspect a participant</label><select id={`${labelId}-select`} value={selected ? selectId! : ''} onChange={e => {const r = actual.find(r => r._id === e.target.value); if (r) chooseRef.current(r)}}><option value="" disabled>{actual.length ? 'Choose a stored reaction…' : 'Awaiting first reaction…'}</option>{COHORTS.map(c => <optgroup key={c} label={`${TITLES[c]} (${groups[c].length})`}>{groups[c].map(r => <option key={r._id} value={r._id}>{person(r)} · {r.action}{r.text ? ` · ${String(r.text).slice(0, 90)}` : ''}</option>)}</optgroup>)}</select></div>
      <p className="aw-explanation">Grouped by expressed sentiment, never demographics. Coral &lt; −0.3 · stone −0.3 to +0.3 · lime &gt; +0.3. Missing scores use the neutral group; scroll actions stay in PASS.</p>
      <div className="aw-selection" aria-live="polite">{selected ? <><div><b>{person(selected)}</b><span>{selected.emoji} {selected.action} · {TITLES[cohort(selected)]}</span></div><p>{selected.text || 'No written response.'}</p>{selected.thought && <p><strong>Simulated reasoning:</strong> {selected.thought}</p>}<div className="aw-relations"><span>Actual reply links:</span>{parent && <button type="button" onClick={() => chooseRef.current(parent)}>Parent: {person(parent)}</button>}{selected.replyTo?._ref && !parent && <span>Parent not in loaded audience</span>}{children.map(r => <button type="button" key={r._id} onClick={() => chooseRef.current(r)}>Reply: {person(r)}</button>)}{!selected.replyTo?._ref && !children.length && <span>No parent or replies in this audience</span>}</div></> : <p>Select a figure or use the participant menu. Only its stored parent and reply relationships will be connected.</p>}</div>
    </footer>
  </section>
}
