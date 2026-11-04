// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AMBIENT_NODES, DEFAULT_AMBIENT_SEED, EPOCH_MS, ESCAPE_MS, HOP_MS, WALL, ambientScene, leanAt, scanHead, ambientSignature, parseAmbientParams, rnd, sagLine, webSegments } from './spiderAmbient'

const SECONDS = (n: number) => n * 1000

describe('seeded means reproducible', () => {
  it('rnd is a counter-based hash: in [0,1), the same for the same inputs, different for different seeds', () => {
    for (let i = 0; i < 200; i++) { const v = rnd(7, i, 3); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); expect(rnd(7, i, 3)).toBe(v) }
    expect(rnd(1, 5)).not.toBe(rnd(2, 5))
  })
  it('the scene is a pure function of (seed, time): the same at any call order, and equal across two evaluations', () => {
    const times = [SECONDS(2.5), SECONDS(11), SECONDS(19.5), SECONDS(27), SECONDS(90), SECONDS(301)]
    const forward = times.map(t => ambientSignature(ambientScene(11, t)))
    const backward = [...times].reverse().map(t => ambientSignature(ambientScene(11, t))).reverse()
    expect(backward).toEqual(forward)
    expect(times.map(t => ambientSignature(ambientScene(11, t)))).toEqual(forward)
  })
  it('different seeds behave differently; the named default is 11', () => {
    const sig = (seed: number) => Array.from({ length: 30 }, (_, i) => ambientSignature(ambientScene(seed, SECONDS(i * 4)))).join('/')
    expect(sig(11)).not.toBe(sig(12)); expect(sig(12)).not.toBe(sig(13)); expect(DEFAULT_AMBIENT_SEED).toBe(11)
  })
})

describe('the behaviour tree', () => {
  const epochs = 400
  const actionsOf = (seed: number, actor: 'hopper-1' | 'hopper-2') => Array.from({ length: epochs }, (_, e) => ambientScene(seed, e * EPOCH_MS + 100).spiders.find(s => s.id === actor)!.action)
  it('uses every action over time (weighted choice, not stuck), and a web is never followed by a web', () => {
    for (const actor of ['hopper-1', 'hopper-2'] as const) {
      const list = actionsOf(11, actor)
      for (const a of ['idle', 'groom', 'hop', 'web']) expect(list, `${actor} ${a}`).toContain(a)
      for (let i = 1; i < list.length; i++) if (list[i - 1] === 'web') expect(list[i]).not.toBe('web')
    }
  })
  it('weights, not coin flips: idle is the commonest, and the shares are stable across seeds', () => {
    const share = (seed: number) => { const l = actionsOf(seed, 'hopper-1'); return (a: string) => l.filter(x => x === a).length / l.length }
    for (const seed of [11, 12, 99]) { const f = share(seed); expect(f('idle')).toBeGreaterThan(f('web')); expect(f('hop')).toBeGreaterThan(0.15); expect(f('web')).toBeGreaterThan(0.04) }
  })
  it('a hopper rests on a node, or is between two nodes in the air only while hopping, with a lift', () => {
    const on = (x: number, y: number) => AMBIENT_NODES.some(n => Math.hypot(n.x - x, n.y - y) < 20)
    for (let e = 0; e < 120; e++) for (const off of [100, 1800, 3200, 5200]) {
      for (const s of ambientScene(11, e * EPOCH_MS + off).spiders.filter(x => x.kind === 'hopper')) {
        if (s.lift > 0) expect(s.action).toBe('hop'); else if (s.action !== 'web') expect(on(s.x, s.y), `${s.id} e${e}+${off} ${s.action}`).toBe(true)
        expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.heading)).toBe(true)
      }
    }
  })
  it('a hop lasts HOP_MS and lands on a node other than the one it left', () => {
    let hops = 0
    for (let e = 0; e < 200 && hops < 5; e++) {
      const at = (o: number) => ambientScene(11, e * EPOCH_MS + o).spiders.find(s => s.id === 'hopper-1')!
      if (at(100).action !== 'hop') continue
      hops++
      const start = at(100), end = at(EPOCH_MS - 50)
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(30)
      let airborne = 0; for (let o = 0; o < EPOCH_MS; o += 25) if (at(o).lift > 0) airborne += 25
      expect(airborne).toBeGreaterThan(HOP_MS * 0.6); expect(airborne).toBeLessThan(HOP_MS * 1.5)
    }
    expect(hops).toBeGreaterThan(0)
  })
  it('only the nodes it is given: restricted to two nodes, a hopper never leaves them', () => {
    const two = [AMBIENT_NODES[2], AMBIENT_NODES[3]]
    for (let e = 0; e < 60; e++) for (const s of ambientScene(11, e * EPOCH_MS + 6000, two).spiders.filter(x => x.kind === 'hopper')) {
      expect(two.some(n => Math.hypot(n.x - s.x, n.y - s.y) < 30 || s.action === 'web'), `${s.id} e${e}`).toBe(true)
    }
  })
})

describe('the wall spider', () => {
  const climbers = (seed: number) => Array.from({ length: 3800 }, (_, i) => ambientScene(seed, i * 100).spiders.find(s => s.id === 'climber')!)
  it('stays on the rail, between its bottom and top', () => {
    for (const c of climbers(11)) { expect(Math.abs(c.x - WALL.bottom.x)).toBeLessThan(6); expect(c.y).toBeLessThanOrEqual(WALL.bottom.y + 1); expect(c.y).toBeGreaterThanOrEqual(WALL.top.y - 1) }
  })
  it('climbs, rests, descends, and sometimes slips: a sudden drop while climbing, then it carries on up', () => {
    const list = climbers(11), actions = new Set(list.map(c => c.action))
    for (const a of ['climb', 'descend', 'rest', 'slip']) expect(actions, a).toContain(a)
    let slips = 0
    for (let i = 1; i < list.length - 20; i++) {
      if (list[i].action === 'slip' && list[i - 1].action !== 'slip') {
        slips++
        const before = list[i - 1].y, settled = list[i + 3].y, later = list[i + 40]
        expect(settled - before).toBeGreaterThan(8) // a real drop within ~300 ms (y grows downward), not a drift
        expect(list[i + 20].action).not.toBe('slip') // it caught itself
        if (later.action === 'climb') expect(later.y).toBeLessThan(settled) // and carried on up
      }
    }
    expect(slips).toBeGreaterThan(0)
  })
  it('a slip leaves a short catch line of silk', () => {
    const slip = climbers(11).findIndex(c => c.action === 'slip')
    expect(ambientScene(11, (slip + 5) * 100).silk.length).toBeGreaterThan(0)
  })
})

describe('silk and webs', () => {
  it('silk sags slightly: a line between two level points dips in the middle by about 7% of its length', () => {
    const a = { x: 0, y: 0 }, b = { x: 200, y: 0 }, pts = sagLine(a, b)
    const mid = pts[Math.floor(pts.length / 2)]
    expect(mid.y).toBeGreaterThan(10); expect(mid.y).toBeLessThan(20); expect(pts[0]).toEqual(a); expect(pts[pts.length - 1].y).toBeCloseTo(0, 6)
  })
  it('a web is five spokes and three rings, built in order over time', () => {
    expect(webSegments({ x: 500, y: 600 }, 11, 4).length).toBe(20)
    for (let e = 0; e < 200; e++) {
      if (ambientScene(11, e * EPOCH_MS + 100).spiders.find(s => s.id === 'hopper-1')!.action !== 'web') continue
      const n = (o: number) => ambientScene(11, e * EPOCH_MS + o).silk.length
      expect(n(900)).toBeLessThanOrEqual(n(2500)); expect(n(2500)).toBeLessThan(n(5200)); expect(n(5200)).toBeGreaterThanOrEqual(20)
      return
    }
    throw new Error('no web epoch found')
  })
})

describe('ambient never claims state', () => {
  it('this module imports nothing about events or the ledger: it cannot read them', () => {
    const src = readFileSync(new URL('./spiderAmbient.ts', import.meta.url), 'utf8')
    const imports = [...src.matchAll(/^import .* from '(.+)'/gm)].map(m => m[1])
    expect(imports).toEqual(['./spiderRoutes'])
    expect(src).not.toMatch(/spiderlings|forgeOps|useSpiderlings|AgentEvent|SpiderLedger/)
  })
  it('the spiders it returns carry no tone, tool or run: nothing a counter could count', () => {
    for (const s of ambientScene(11, 12_345).spiders) expect(Object.keys(s).sort()).toEqual(['action', 'crouch', 'groom', 'headTurn', 'heading', 'id', 'kind', 'lean', 'lift', 'moving', 'squash', 'x', 'y'])
  })
})

describe('parseAmbientParams', () => {
  it('defaults on, seed 11, not frozen; reads the seed and the freeze; ?ambient=0 turns it off; junk falls back', () => {
    expect(parseAmbientParams('?rig=1')).toEqual({ enabled: true, seed: 11 })
    expect(parseAmbientParams('?rig=1&spiderSeed=7&spiderFreeze=2500')).toEqual({ enabled: true, seed: 7, freezeMs: 2500 })
    expect(parseAmbientParams('?ambient=0').enabled).toBe(false)
    expect(parseAmbientParams('?spiderSeed=abc&spiderFreeze=-5')).toEqual({ enabled: true, seed: 11 })
  })
})

describe('realism and stealth (owner passes, 2026-11-04)', () => {
  it('statue-still is the resting state: idle outweighs every other action by a wide margin', () => {
    const list = Array.from({ length: 400 }, (_, e) => ambientScene(11, e * EPOCH_MS + 100).spiders.find(s => s.id === 'hopper-1')!.action)
    const share = (a: string) => list.filter(x => x === a).length / list.length
    expect(share('idle')).toBeGreaterThan(0.4); expect(share('hop')).toBeLessThan(share('idle'))
  })
  it('a jump is a crouch, a flight, and a landing that compresses and settles', () => {
    for (let e = 0; e < 300; e++) {
      const at = (o: number) => ambientScene(11, e * EPOCH_MS + o).spiders.find(s => s.id === 'hopper-1')!
      if (at(100).action !== 'hop') continue
      let first = -1; for (let o = 0; o < EPOCH_MS; o += 10) if (at(o).lift > 0) { first = o; break }
      expect(at(first - 60).squash).toBeGreaterThan(0) // crouched just before takeoff
      let land = -1; for (let o = first; o < EPOCH_MS; o += 10) if (at(o).lift === 0) { land = o; break }
      expect(at(land + 40).squash).toBeGreaterThan(0.5); expect(at(land + 600).squash).toBe(0) // squashed on landing, settled after
      return
    }
    throw new Error('no hop found')
  })
  it('escape reflex: on a startle every spider drops on its dragline, hangs motionless, then climbs back; pure in (seed, time, startles)', () => {
    const t0 = 50_000, calm = ambientScene(11, t0)
    const hang = ambientScene(11, t0 + 2000, AMBIENT_NODES, [t0])
    expect(hang.spiders.every(s => s.action === 'escape' && !s.moving)).toBe(true)
    for (const s of hang.spiders) { const before = calm.spiders.find(c => c.id === s.id)!; expect(s.y).toBeGreaterThan(before.y + 10); expect(Math.abs(s.x - before.x)).toBeLessThan(0.01) }
    expect(hang.silk.length).toBe(hang.spiders.length) // each hangs on its own line
    expect(ambientScene(11, t0 + 5200, AMBIENT_NODES, [t0]).spiders.every(s => s.moving)).toBe(true) // the cautious climb back
    expect(ambientScene(11, t0 + ESCAPE_MS + 10, AMBIENT_NODES, [t0]).spiders.some(s => s.action === 'escape')).toBe(false)
    expect(ambientSignature(ambientScene(11, t0 + 2000, AMBIENT_NODES, [t0]))).toBe(ambientSignature(hang))
    expect(ambientSignature(ambientScene(11, t0 - 10, AMBIENT_NODES, [t0]))).toBe(ambientSignature(ambientScene(11, t0 - 10))) // a future startle changes nothing
  })
})

describe('head tilt, lean and crouch (owner, 2026-11-04: "everything realistic")', () => {
  it('the head scans in snaps: it holds an angle, then turns to the next within ~90 ms, never a slow sweep', () => {
    const at = (t: number) => scanHead(11, 1, t)
    expect(at(650 * 4 + 200)).toBeCloseTo(at(650 * 4 + 600), 10) // held
    expect(Math.abs(at(650 * 5 + 95) - at(650 * 5 - 5))).toBeGreaterThan(0) // snapped at the step
    for (let t = 0; t < 60_000; t += 37) expect(Math.abs(at(t))).toBeLessThanOrEqual(0.35 + 1e-9)
  })
  it('the weight shifts side to side within bounds, and both ways over time', () => {
    const vals = Array.from({ length: 200 }, (_, i) => leanAt(11, 1, i * 1000))
    expect(Math.max(...vals)).toBeGreaterThan(0.2); expect(Math.min(...vals)).toBeLessThan(-0.2); expect(vals.every(v => Math.abs(v) <= 0.7)).toBe(true)
  })
  it('it gathers into a crouch before it jumps, and travels with its head forward and weight centred', () => {
    for (let e = 0; e < 300; e++) {
      const at = (o: number) => ambientScene(11, e * EPOCH_MS + o).spiders.find(s => s.id === 'hopper-1')!
      if (at(100).action !== 'hop') continue
      let first = -1; for (let o = 0; o < EPOCH_MS; o += 10) if (at(o).lift > 0) { first = o; break }
      expect(at(first - 20).crouch).toBeGreaterThan(0.8)
      expect([at(first + 100).headTurn, at(first + 100).lean]).toEqual([0, 0])
      return
    }
    throw new Error('no hop found')
  })
  it('watching spiders sometimes sit in a crouch, and turn their heads', () => {
    const idle = Array.from({ length: 400 }, (_, e) => ambientScene(11, e * EPOCH_MS + 3000).spiders.find(s => s.id === 'hopper-1')!).filter(s => s.action === 'idle')
    expect(idle.some(s => s.crouch > 0)).toBe(true); expect(idle.some(s => s.crouch === 0)).toBe(true)
    expect(new Set(idle.map(s => s.headTurn.toFixed(3))).size).toBeGreaterThan(10)
  })
})
