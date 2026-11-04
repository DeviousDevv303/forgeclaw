// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BACK_MS, CHEST, DOCK_MS, FLAG_BACK_MS, NODES, OUT_MS, SEAT, UNRESOLVED_FADE_MS, backPath, buildPath, chooseAnchors, outPath, pathAt, poseOf, saccade, surfaceAt } from './spiderRoutes'
import type { SpiderRun } from '../lib/spiderlings'

const IMG_W = 1536, IMG_H = 1024
const FAR = chooseAnchors(() => true)
const NEAR = chooseAnchors(() => false)
const run = (over: Partial<SpiderRun> = {}): SpiderRun => ({ id: 's1', tool: 'qwen_reason', channel: 'network', startedAt: 1_000_000, timeoutMs: 60_000, ...over })
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 3) => Math.hypot(a.x - b.x, a.y - b.y) <= tol

describe('anchors are on the painting', () => {
  it('every node, the seat and the chest lie inside the 1536x1024 image', () => {
    const pts = [SEAT, CHEST, ...Object.values(NODES).flatMap(n => [n.far, n.near])]
    for (const p of pts) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(IMG_W); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(IMG_H) }
  })
  it('uses the far (floor cube) node when it is on screen and the near node when the crop hides it', () => {
    for (const c of ['browser', 'sandbox', 'network'] as const) { expect(FAR[c]).toEqual(NODES[c].far); expect(NEAR[c]).toEqual(NODES[c].near) }
    // a phone's "cover" crop shows only x 502..1034 of the painting: every channel must still get an anchor inside it
    const phone = chooseAnchors(p => p.x >= 502 && p.x <= 1034)
    for (const c of ['browser', 'sandbox', 'network'] as const) { expect(phone[c].x).toBeGreaterThanOrEqual(502); expect(phone[c].x).toBeLessThanOrEqual(1034) }
  })
})

describe('paths', () => {
  it('arc-length lookup runs from the first point to the last', () => {
    const p = buildPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    expect(near(pathAt(p, 0), { x: 0, y: 0 }, 0.01)).toBe(true); expect(near(pathAt(p, 1), { x: 100, y: 100 }, 0.01)).toBe(true)
    expect(pathAt(p, -5).x).toBe(0); expect(near(pathAt(p, 9), { x: 100, y: 100 }, 0.01)).toBe(true)
  })
  it('the way out starts at the seat and ends on the task node; the way back ends at the chest circle', () => {
    for (const set of [FAR, NEAR]) for (const c of ['browser', 'sandbox', 'network'] as const) {
      const out = outPath(c, set)
      expect(near(pathAt(out, 0), SEAT, 0.01)).toBe(true); expect(near(pathAt(out, 1), set[c], 0.01)).toBe(true)
      expect(near(pathAt(backPath(set[c]), 1), CHEST, 0.01)).toBe(true)
    }
  })
})

describe('where a spider is, moment by moment', () => {
  const r0 = run()
  it('in flight: leaves the seat, reaches its node, then works there', () => {
    expect(poseOf(r0, r0.startedAt, FAR)).toMatchObject({ phase: 'out' })
    const mid = poseOf(r0, r0.startedAt + OUT_MS / 2, FAR)!
    expect(mid.phase).toBe('out'); expect(near(mid, FAR.network, 1)).toBe(false)
    const there = poseOf(r0, r0.startedAt + OUT_MS + 500, FAR)!
    expect(there).toMatchObject({ phase: 'working', tone: 'work' }); expect(near(there, FAR.network, 0.01)).toBe(true)
  })
  it('success: climbs back, docks at the chest in OK tone, then is gone (its lines stay in the ledger)', () => {
    const r = run({ endedAt: r0.startedAt + 8_000, outcome: 'ok' })
    const back = poseOf(r, r.endedAt! + BACK_MS / 2, FAR)!
    expect(back).toMatchObject({ phase: 'back', tone: 'ok' })
    const dock = poseOf(r, r.endedAt! + BACK_MS + DOCK_MS / 2, FAR)!
    expect(dock).toMatchObject({ phase: 'dock', tone: 'ok' }); expect(near(dock, CHEST, 0.01)).toBe(true)
    expect(poseOf(r, r.endedAt! + BACK_MS + DOCK_MS + 1, FAR)).toBeNull()
  })
  it('failure: the same journey in flag tone (red thread, red ring)', () => {
    const r = run({ endedAt: r0.startedAt + 8_000, outcome: 'failed' })
    expect(poseOf(r, r.endedAt! + 100, FAR)).toMatchObject({ phase: 'back', tone: 'flag' })
    expect(poseOf(r, r.endedAt! + BACK_MS + 100, FAR)).toMatchObject({ phase: 'dock', tone: 'flag' })
  })
  it('the way back starts exactly where the way out left off, node or not (no teleport)', () => {
    const late = run({ endedAt: r0.startedAt + 9_000, outcome: 'ok' })
    expect(near(poseOf(late, late.endedAt!, FAR)!, FAR.network, 0.5)).toBe(true)
    const early = run({ endedAt: r0.startedAt + 600, outcome: 'ok' }) // answered before it reached the node
    const before = poseOf(run(), r0.startedAt + 600, FAR)!
    expect(near(poseOf(early, early.endedAt!, FAR)!, before, 0.5)).toBe(true)
  })
  it('past the timeout with no end event: UNKNOWN at the node, still, never working', () => {
    const p = poseOf(r0, r0.startedAt + r0.timeoutMs + 1, FAR)!
    expect(p).toMatchObject({ phase: 'unknown', tone: 'unknown' }); expect(near(p, FAR.network, 0.01)).toBe(true)
  })
  it('unresolved (mission ended, no end event): grey marker that fades away', () => {
    const r = run({ endedAt: r0.startedAt + 5_000, outcome: 'unresolved' })
    const a = poseOf(r, r.endedAt! + 1_000, FAR)!, b = poseOf(r, r.endedAt! + UNRESOLVED_FADE_MS - 1_000, FAR)!
    expect(a).toMatchObject({ phase: 'unknown', tone: 'unknown' }); expect(b.alpha).toBeLessThan(a.alpha)
    expect(poseOf(r, r.endedAt! + UNRESOLVED_FADE_MS + 1, FAR)).toBeNull()
  })
  it('the way back climbs the nearer thigh-light: left of the seat goes left, right goes right', () => {
    const leftFrom = pathAt(backPath({ x: 300, y: 700 }), 0.5), rightFrom = pathAt(backPath({ x: 1200, y: 700 }), 0.5)
    expect(leftFrom.x).toBeLessThan(SEAT.x); expect(rightFrom.x).toBeGreaterThan(SEAT.x)
  })
})

describe('locomotion (owner realism and stealth passes, 2026-11-04)', () => {
  it('saccade: exact at both ends, never goes backwards, and really stops between bursts', () => {
    expect(saccade(0, 4).u).toBe(0); expect(saccade(1, 4).u).toBe(1)
    let prev = 0, frozen = 0, moving = 0
    for (let i = 0; i <= 1000; i++) { const r = saccade(i / 1000, 4); expect(r.u).toBeGreaterThanOrEqual(prev - 1e-12); prev = r.u; if (r.moving) moving++; else frozen++ }
    expect(frozen).toBeGreaterThan(300); expect(moving).toBeGreaterThan(300)
  })
  it('outbound stalks: freezes along the way (legs still), never one constant-speed glide', () => {
    const r0 = run(), states = Array.from({ length: 100 }, (_, i) => poseOf(r0, r0.startedAt + (i / 100) * OUT_MS, FAR)!)
    expect(states.some(p => p.phase === 'out' && !p.moving)).toBe(true); expect(states.some(p => p.phase === 'out' && p.moving)).toBe(true)
  })
  it('outcome-encoded return: a flagged spider is back sooner and weaves; a clean one is calm and on the line', () => {
    const ok = run({ endedAt: 2_000_000, outcome: 'ok' }), bad = run({ endedAt: 2_000_000, outcome: 'failed' })
    expect(FLAG_BACK_MS).toBeLessThan(BACK_MS)
    expect(poseOf(bad, bad.endedAt! + FLAG_BACK_MS + 50, FAR)!.phase).toBe('dock')
    expect(poseOf(ok, ok.endedAt! + FLAG_BACK_MS + 50, FAR)!.phase).toBe('back')
    const back = backPath(poseOf(ok, ok.endedAt!, FAR)!)
    const off = (p: { x: number; y: number }) => Math.min(...Array.from({ length: 2001 }, (_, i) => { const q = pathAt(back, i / 2000); return Math.hypot(q.x - p.x, q.y - p.y) }))
    const okOff = Math.max(...[0.2, 0.4, 0.6].map(f => off(poseOf(ok, ok.endedAt! + f * BACK_MS, FAR)!)))
    const badOff = Math.max(...[0.1, 0.2, 0.3, 0.4, 0.5].map(f => off(poseOf(bad, bad.endedAt! + f * FLAG_BACK_MS, FAR)!)))
    expect(okOff).toBeLessThan(1); expect(badOff).toBeGreaterThan(2)
  })
  it('terrain: the throne\'s faces are the chair, the network is the floor; climbing the chair pitches the body', () => {
    expect(surfaceAt({ x: 760, y: 400 })).toBe('chair'); expect(surfaceAt(NODES.browser.far)).toBe('floor')
    const ok = run({ endedAt: 2_000_000, outcome: 'ok' })
    const climbing = Array.from({ length: 60 }, (_, i) => poseOf(ok, ok.endedAt! + (i / 60) * BACK_MS, FAR)!).filter(p => p.phase === 'back' && p.surface === 'chair')
    expect(climbing.some(p => p.pitch > 0)).toBe(true)
  })
})
