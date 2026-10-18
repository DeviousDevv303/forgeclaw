import { describe, expect, it } from 'vitest'
import { CALM_SOUL, CELEBRATE_MS, EXPLODE_MS, WAVE_MS, WAVE_STAGGER_MS, cubeJitter, cubeLook, explodeAmount, type SoulSignal } from './cubeMotion'

const soul = (emotion: SoulSignal['emotion'], extra: Partial<SoulSignal> = {}): SoulSignal => ({ ...CALM_SOUL, emotion, energy: 80, emotionAt: 10_000, ...extra })
const range = (f: (t: number) => number, from = 10_000, to = 12_000, step = 7) => {
  let lo = Infinity, hi = -Infinity
  for (let t = from; t < to; t += step) { const v = f(t); lo = Math.min(lo, v); hi = Math.max(hi, v) }
  return { lo, hi, span: hi - lo }
}

describe('living cubes: the behavior table', () => {
  it('idle: slow drift, breathing glow, occasional lazy quarter turn', () => {
    const l = cubeLook(CALM_SOUL, 0, 0, 3)
    expect(l.spin).toBeLessThan(0.3)
    expect(range(t => cubeLook(CALM_SOUL, t, 0, 3).glow, 0, 5_000).span).toBeGreaterThan(0.1)
    const turn = range(t => cubeLook(CALM_SOUL, t, 0, 3).angleOffset, 0, 9_000, 20)
    expect(turn.hi).toBeCloseTo(Math.PI / 2, 1)
    expect(cubeLook(CALM_SOUL, 0, 0, 3).jitterPx).toBe(0)
  })

  it('AI thinking: rapid micro-rotations, pulsing glow, slight jitter', () => {
    const micro = range(t => cubeLook(soul('curious'), t, 0, 1).angleOffset, 10_000, 10_500, 3)
    expect(micro.span).toBeGreaterThan(0.08)
    expect(micro.hi).toBeLessThan(0.1)
    expect(range(t => cubeLook(soul('curious'), t, 0, 1).glow).span).toBeGreaterThan(0.1)
    expect(cubeLook(soul('curious'), 10_000, 0, 1).jitterPx).toBeGreaterThan(0)
  })

  it('shell running: frantic scrambling, shaking, intense glow', () => {
    const l = cubeLook(soul('frantic'), 10_100, 0, 1)
    expect(l.scrambled).toBe(true)
    expect(l.spin).toBeGreaterThan(4)
    expect(l.jitterPx).toBeGreaterThan(2)
    expect(l.glow).toBeGreaterThan(0.6)
  })

  it('git fetch: a Mexican wave, left to right', () => {
    const s = soul('excited', { gesture: 'wave', gestureAt: 20_000 })
    const at = 20_000 + WAVE_STAGGER_MS * 2 + WAVE_MS / 2
    const first = cubeLook(s, at, 0, 1).angleOffset
    const third = cubeLook(s, at, 2, 1).angleOffset
    const later = cubeLook(s, at, 9, 1).angleOffset
    expect(first).toBeGreaterThan(third)   // the wave already passed cube 0
    expect(third).toBeGreaterThan(later)   // and hasn't reached cube 9 yet
    expect(cubeLook(s, at, 2, 1).flash?.color).toEqual({ r: 68, g: 136, b: 255 })
    expect(cubeLook(s, 20_000 + WAVE_STAGGER_MS * 20 + WAVE_MS, 2, 1).flash).toBeNull()
  })

  it('success: calm green "click" glow that fades', () => {
    const now = cubeLook(soul('satisfied'), 10_050, 0, 1)
    expect(now.glowColor).toEqual({ r: 0, g: 255, b: 136 })
    expect(now.flash?.alpha).toBeGreaterThan(0.3)
    expect(cubeLook(soul('satisfied'), 12_000, 0, 1).flash).toBeNull()
    expect(now.spin).toBeLessThan(1)
  })

  it('error: violent shake, red flash, pieces explode outward then snap back', () => {
    const l = cubeLook(soul('angry'), 10_200, 0, 1)
    expect(l.glowColor).toEqual({ r: 255, g: 0, b: 68 })
    expect(l.flash?.color).toEqual({ r: 255, g: 0, b: 68 })
    expect(l.jitterPx).toBeGreaterThanOrEqual(3)
    expect(explodeAmount(10_000, 10_000)).toBe(0)
    expect(explodeAmount(10_000, 10_000 + EXPLODE_MS * 0.4)).toBeCloseTo(1)
    expect(explodeAmount(10_000, 10_000 + EXPLODE_MS * 0.99)).toBeLessThan(0.05)
    expect(explodeAmount(10_000, 10_000 + EXPLODE_MS)).toBe(0)
    expect(cubeLook(soul('pain'), 10_300, 0, 1).explode).toBeGreaterThan(0.5)
  })

  it('user typing: anticipatory wobble', () => {
    const wob = range(t => cubeLook(soul('anticipatory'), t, 0, 2).angleOffset)
    expect(wob.span).toBeGreaterThan(0.3)
    expect(range(t => cubeLook(soul('anticipatory'), t, 0, 2).scale).span).toBeGreaterThan(0.05)
  })

  it('celebrate: staggered victory spin in gold', () => {
    const s = soul('satisfied', { gesture: 'celebrate', gestureAt: 30_000 })
    const mid = cubeLook(s, 30_000 + CELEBRATE_MS / 2, 0, 1)
    expect(mid.angleOffset).toBeGreaterThan(Math.PI)
    expect(mid.glowColor).toEqual({ r: 255, g: 215, b: 0 })
  })

  it('energy scales intensity, and cubes are not in lockstep', () => {
    expect(cubeLook({ ...soul('frantic'), energy: 100 }, 10_100, 0, 1).glow).toBeGreaterThan(cubeLook({ ...soul('frantic'), energy: 0 }, 10_100, 0, 1).glow)
    expect(cubeJitter(3, 500, 1).dx).not.toBeCloseTo(cubeJitter(3, 500, 2).dx, 3)
    expect(cubeJitter(0, 500, 1)).toEqual({ dx: 0, dy: 0 })
  })
})
