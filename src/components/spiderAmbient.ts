// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Ambient spiders: life on the painting, not telemetry. They hop between painted nodes, spin silk, build the odd web, and one
 * climbs the chair's frame, slips, and catches itself.
 *
 * LAW: ambient never claims state. Nothing in this file reads the spider ledger or any event (the boundary is asserted by a test
 * that scans this file's imports); no ambient spider adds to a counter, appears in a ledger line, or is labelled as a tool run.
 *
 * Behaviour is a seeded, weighted behaviour tree evaluated per EPOCH: a selector over {idle, groom, hop, web} whose weights depend on
 * the previous action, drawn from a counter-based hash of (seed, actor, epoch), never from a running RNG. So the scene is a PURE
 * FUNCTION of (seed, time): the same seed at the same time gives the same pose, in any order and at any frame rate. That is what
 * makes a screenshot reproducible: it is named by its seed and its time.
 */
import { NODES, type Pt } from './spiderRoutes'

export const EPOCH_MS = 7000
export const HOP_MS = 650
export const WEB_BUILD_MS = 4400
export const DEFAULT_AMBIENT_SEED = 11

/** Painted floor nodes the hoppers may use (backdrop pixels). The caller passes the ones that are on screen. */
export const AMBIENT_NODES: Pt[] = [
  NODES.browser.far, NODES.browser.near, { x: 680, y: 770 }, { x: 865, y: 768 }, NODES.sandbox.near, NODES.sandbox.far, NODES.network.far,
]
/** The chair's left frame rail, bottom to top, where the wall spider lives. */
export const WALL: { bottom: Pt; top: Pt } = { bottom: { x: 653, y: 440 }, top: { x: 656, y: 176 } }

/** Counter-based hash to [0, 1): no state, so any (seed, a, b) can be asked in any order. */
export function rnd(seed: number, a: number, b = 0): number {
  let x = (seed ^ Math.imul((a + 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35)) >>> 0
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

export type AmbientAction = 'idle' | 'groom' | 'hop' | 'web'
const ACTIONS: AmbientAction[] = ['idle', 'groom', 'hop', 'web']
/** Weights per previous action: after a web, no web; after a hop, less hopping; idle is the resting state. */
const WEIGHTS: Record<AmbientAction | 'start', number[]> = {
  start: [3, 1, 3, 1], idle: [2, 2, 4, 1.5], groom: [3, 0.5, 4, 1.5], hop: [4, 1.5, 1.5, 2], web: [4, 2, 3, 0],
}

function pickAction(seed: number, actor: number, epoch: number, prev: AmbientAction | 'start'): AmbientAction {
  const w = WEIGHTS[prev], total = w.reduce((a, b) => a + b, 0)
  let r = rnd(seed, actor * 7919 + 1, epoch) * total
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return ACTIONS[i] }
  return 'idle'
}

/** Chooses a hop target other than the current node, nearer nodes more likely. */
function pickTarget(seed: number, actor: number, epoch: number, from: number, nodes: readonly Pt[]): number {
  const w = nodes.map((p, i) => (i === from ? 0 : 1 / (1 + Math.hypot(p.x - nodes[from].x, p.y - nodes[from].y) / 260)))
  const total = w.reduce((a, b) => a + b, 0)
  let r = rnd(seed, actor * 104729 + 3, epoch) * total
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i }
  return (from + 1) % nodes.length
}

interface Step { action: AmbientAction; node: number; to: number }
const memo = new Map<string, Step[]>()
/** The actor's action and node at the START of each epoch up to `epoch` (inclusive), built by walking the tree from epoch 0. */
function steps(seed: number, actor: number, nodes: readonly Pt[], epoch: number): Step[] {
  const key = `${seed}:${actor}:${nodes.map(p => `${p.x},${p.y}`).join(';')}`
  const list = memo.get(key) ?? []
  if (!memo.has(key)) memo.set(key, list)
  while (list.length <= epoch) {
    const e = list.length, prev = e === 0 ? null : list[e - 1]
    const node = prev ? (prev.action === 'hop' ? prev.to : prev.node) : Math.floor(rnd(seed, actor * 31 + 5, 0) * nodes.length)
    const action = pickAction(seed, actor, e, prev ? prev.action : 'start')
    list.push({ action, node, to: action === 'hop' ? pickTarget(seed, actor, e, node, nodes) : node })
  }
  return list
}

export interface AmbientSpider { id: string; kind: 'hopper' | 'climber'; x: number; y: number; heading: number; lift: number; moving: boolean; groom: boolean; action: string }
export interface Silk { pts: Pt[]; alpha: number }
export interface AmbientScene { spiders: AmbientSpider[]; silk: Silk[] }

/** A silk line from a to b with a slight sag (gravity), as a short polyline. */
export function sagLine(a: Pt, b: Pt, sag = 0.07, n = 10): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y), out: Pt[] = []
  for (let i = 0; i <= n; i++) { const u = i / n; out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u + Math.sin(Math.PI * u) * len * sag }) }
  return out
}

const ease = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c) }
const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })

/** A web hung around `c`: spokes to five anchors, then three rings; returns its segments in build order. */
export function webSegments(c: Pt, seed: number, epoch: number): Pt[][] {
  const R = 40 + rnd(seed, epoch, 11) * 14, rot = rnd(seed, epoch, 12) * Math.PI * 2, N = 5
  const anchor = (i: number, k: number): Pt => ({ x: c.x + Math.cos(rot + (i * 2 * Math.PI) / N) * R * k, y: c.y - 14 + Math.sin(rot + (i * 2 * Math.PI) / N) * R * k * 0.8 })
  const segs: Pt[][] = []
  for (let i = 0; i < N; i++) segs.push(sagLine({ x: c.x, y: c.y - 14 }, anchor(i, 1), 0.03, 4))
  for (const k of [0.38, 0.65, 0.92]) for (let i = 0; i < N; i++) segs.push(sagLine(anchor(i, k), anchor((i + 1) % N, k), 0.05, 4))
  return segs
}

function hopper(seed: number, actor: number, nodes: readonly Pt[], t: number, scene: AmbientScene) {
  const epoch = Math.max(0, Math.floor(t / EPOCH_MS)), o = t - epoch * EPOCH_MS
  const list = steps(seed, actor, nodes, epoch)
  const s = list[epoch], here = nodes[s.node]
  const id = `hopper-${actor}`
  // Leftovers from the previous epoch: its silk dragline and web linger, fading over the first seconds.
  if (epoch > 0) {
    const p = list[epoch - 1], fade = 1 - ease(o / 4000)
    if (fade > 0 && p.action === 'hop') scene.silk.push({ pts: sagLine(nodes[p.node], nodes[p.to]), alpha: 0.75 * fade })
    if (fade > 0 && p.action === 'web') for (const seg of webSegments(nodes[p.node], seed, epoch - 1)) scene.silk.push({ pts: seg, alpha: 0.7 * fade })
  }
  const base: AmbientSpider = { id, kind: 'hopper', x: here.x, y: here.y, heading: rnd(seed, actor * 13 + 7, epoch) * Math.PI * 2, lift: 0, moving: false, groom: false, action: s.action }
  if (s.action === 'groom') base.groom = true
  if (s.action === 'hop') {
    const start = 600 + rnd(seed, actor * 17 + 9, epoch) * 2600, to = nodes[s.to], dist = Math.hypot(to.x - here.x, to.y - here.y)
    if (o < start) { scene.spiders.push({ ...base, heading: Math.atan2(to.y - here.y, to.x - here.x) }); return }
    const u = Math.min(1, (o - start) / HOP_MS), p = lerp(here, to, ease(u)), heading = Math.atan2(to.y - here.y, to.x - here.x)
    const fresh = o - start
    scene.silk.push({ pts: sagLine(here, to), alpha: Math.min(0.85, fresh / 200) * (1 - ease((o - start - 2500) / 4000)) })
    if (u < 1) { scene.spiders.push({ ...base, x: p.x, y: p.y, heading, lift: Math.sin(Math.PI * u) * (22 + dist * 0.1), moving: true }); return }
    scene.spiders.push({ ...base, x: to.x, y: to.y, heading })
    return
  }
  if (s.action === 'web') {
    const segs = webSegments(here, seed, epoch), p = Math.min(1, Math.max(0, (o - 500) / WEB_BUILD_MS)), shown = p * segs.length
    for (let i = 0; i < segs.length; i++) if (i < Math.floor(shown)) scene.silk.push({ pts: segs[i], alpha: 0.8 })
    const part = Math.floor(shown)
    if (part < segs.length && p > 0) { const seg = segs[part], f = shown - part; scene.silk.push({ pts: seg.slice(0, Math.max(2, Math.round(f * seg.length))), alpha: 0.8 }); const head = seg[Math.min(seg.length - 1, Math.round(f * (seg.length - 1)))]; scene.spiders.push({ ...base, x: head.x, y: head.y, moving: true, heading: Math.atan2(seg[seg.length - 1].y - seg[0].y, seg[seg.length - 1].x - seg[0].x) }); return }
    scene.spiders.push({ ...base, y: here.y - 14, moving: false })
    return
  }
  scene.spiders.push(base)
}

const CYCLE_MS = 38_000, ASCEND_MS = 15_000, PAUSE_MS = 3_500, DESCEND_MS = 13_000, SLIP_MS = 240

/** The wall spider: climbs the rail, slips once in a while (a quick drop), catches itself on a silk line, goes on, comes back down. */
function climber(seed: number, t: number, scene: AmbientScene) {
  const c = Math.max(0, Math.floor(t / CYCLE_MS)), o = t - c * CYCLE_MS
  const reach = 0.55 + rnd(seed, 900, c) * 0.4, slips = rnd(seed, 901, c) < 0.75
  const slipAt = 3000 + rnd(seed, 902, c) * 8000, drop = 0.07 + rnd(seed, 903, c) * 0.07
  const slipOffset = slips && o >= slipAt ? drop * ease((o - slipAt) / SLIP_MS) : 0
  let u = 0, moving = true, heading = -Math.PI / 2
  if (o < ASCEND_MS) u = reach * ease(o / ASCEND_MS) - slipOffset
  else if (o < ASCEND_MS + PAUSE_MS) { u = reach - (slips ? drop : 0); moving = false }
  else if (o < ASCEND_MS + PAUSE_MS + DESCEND_MS) { const end = reach - (slips ? drop : 0); u = end * (1 - ease((o - ASCEND_MS - PAUSE_MS) / DESCEND_MS)); heading = Math.PI / 2 }
  else { u = 0; moving = false }
  u = Math.max(0, u)
  const at = (v: number): Pt => lerp(WALL.bottom, WALL.top, v)
  const pos = at(u)
  if (slips && o >= slipAt && o < slipAt + 2600) { // the catch line: from where it slipped to where it stopped
    const before = at(Math.max(0, reach * ease(slipAt / ASCEND_MS))), after = at(Math.max(0, reach * ease(slipAt / ASCEND_MS) - drop))
    scene.silk.push({ pts: sagLine(before, after, 0.02, 4), alpha: 0.85 * (1 - ease((o - slipAt - 800) / 1800)) })
  }
  const slipping = slips && o >= slipAt && o < slipAt + SLIP_MS
  scene.spiders.push({ id: 'climber', kind: 'climber', x: pos.x, y: pos.y, heading: slipping ? heading + 0.5 : heading, lift: 0, moving: moving && !slipping, groom: false, action: slipping ? 'slip' : moving ? (heading < 0 ? 'climb' : 'descend') : 'rest' })
}

/** The whole ambient scene at time `tMs` (since the rig mounted, or a frozen frame) for a seed. Pure. */
export function ambientScene(seed: number, tMs: number, nodes: readonly Pt[] = AMBIENT_NODES): AmbientScene {
  const scene: AmbientScene = { spiders: [], silk: [] }
  const t = Math.max(0, tMs)
  if (nodes.length >= 2) { hopper(seed, 1, nodes, t, scene); hopper(seed, 2, nodes, t, scene) }
  climber(seed, t, scene)
  return scene
}

/** A compact, rounded description of a scene: equal for equal (seed, time), used to prove a screenshot is reproducible. */
export function ambientSignature(scene: AmbientScene): string {
  const r = (n: number) => Math.round(n)
  return scene.spiders.map(s => `${s.id}:${s.action}@${r(s.x)},${r(s.y)}^${r(s.lift)}`).join('|') + `#${scene.silk.length}`
}

export interface AmbientConfig { enabled: boolean; seed: number; /** When set, the ambient clock is frozen at this many ms: a named, reproducible frame. */ freezeMs?: number }

/** `?ambient=0` turns it off, `?spiderSeed=N` names the seed, `?spiderFreeze=MS` freezes the ambient clock at MS (for reproducible screenshots). */
export function parseAmbientParams(search: string): AmbientConfig {
  const q = new URLSearchParams(search), seed = Number(q.get('spiderSeed')), freeze = q.get('spiderFreeze')
  return {
    enabled: q.get('ambient') !== '0',
    seed: q.get('spiderSeed') !== null && Number.isInteger(seed) ? seed : DEFAULT_AMBIENT_SEED,
    ...(freeze !== null && Number.isFinite(Number(freeze)) && Number(freeze) >= 0 ? { freezeMs: Number(freeze) } : {}),
  }
}
