import { describe, expect, it } from 'vitest'
import { SOLVE_MS, TURN_MS, MAX_SCRAMBLE, cubeLook, cubeScale, cubeShake, cubeSpinRate, nextCubeAngle, solveProgress, turnAngle, turnMode, CALM_SOUL, type SoulSignal } from './cubeMotion'
import type { Move } from './rubikModel'

describe('cube reactions', () => {
  it('spins faster as the agent gets busier, and freezes when blocked', () => {
    const r = (p: Parameters<typeof cubeSpinRate>[0]) => cubeSpinRate(p, 0, false)
    expect(r('idle')).toBeLessThan(r('planning'))
    expect(r('planning')).toBeLessThan(r('verifying'))
    expect(r('verifying')).toBeLessThan(r('executing'))
    expect(r('blocked')).toBe(0)
    expect(cubeSpinRate('blocked', 0, true)).toBe(0)
  })

  it('follows token velocity while streaming, capped', () => {
    expect(cubeSpinRate('streaming', 80, false)).toBeGreaterThan(cubeSpinRate('streaming', 0, false))
    expect(cubeSpinRate('streaming', 10_000, false)).toBe(4)
  })

  it('doubles spin and pops size for a cube carrying an in-flight tool', () => {
    expect(cubeSpinRate('executing', 0, true)).toBe(2 * cubeSpinRate('executing', 0, false))
    expect(cubeScale(true, 'executing')).toBeGreaterThan(1)
    expect(cubeScale(false, 'executing')).toBe(1)
    expect(cubeScale(true, 'blocked')).toBe(1)
  })

  it('shakes only on errors, harder for severity 2, and not in lockstep', () => {
    expect(cubeShake(0, 1234, 1)).toEqual({ dx: 0, dy: 0 })
    let max1 = 0
    let max2 = 0
    for (let t = 0; t < 2000; t += 7) {
      max1 = Math.max(max1, Math.abs(cubeShake(1, t, 3).dx))
      max2 = Math.max(max2, Math.abs(cubeShake(2, t, 3).dx))
    }
    expect(max1).toBeGreaterThan(1)
    expect(max1).toBeLessThanOrEqual(2)
    expect(max2).toBeGreaterThan(max1)
    expect(cubeShake(2, 500, 1).dx).not.toBeCloseTo(cubeShake(2, 500, 2).dx, 3)
  })

  it('solves for SOLVE_MS after completion, then stops', () => {
    expect(solveProgress(0, 5000)).toBeNull()
    expect(solveProgress(1000, 1000)).toBe(0)
    expect(solveProgress(1000, 1000 + SOLVE_MS / 2)).toBeCloseTo(0.5)
    expect(solveProgress(1000, 1000 + SOLVE_MS)).toBeNull()
    expect(solveProgress(1000, 999)).toBeNull()
  })

  it('squares up to the nearest quarter turn while solving, and integrates spin otherwise', () => {
    let a = 1.0
    for (let i = 0; i < 60; i++) a = nextCubeAngle(a, 3, 1 / 60, true)
    expect(a).toBeCloseTo(Math.PI / 2, 2)
    expect(nextCubeAngle(0.5, 2, 0.25, false)).toBeCloseTo(1.0)
  })
})

describe('real layer turns', () => {
  const soul = (emotion: SoulSignal['emotion']): SoulSignal => ({ ...CALM_SOUL, emotion, energy: 80, emotionAt: 10_000 })

  it('turnMode maps phase and emotion to turning modes', () => {
    expect(turnMode('blocked', 'calm', false)).toBe('frozen')
    expect(turnMode('streaming', 'calm', false)).toBe('working')
    expect(turnMode('executing', 'calm', false)).toBe('working')
    expect(turnMode('planning', 'calm', false)).toBe('working')
    expect(turnMode('verifying', 'calm', false)).toBe('working')
    expect(turnMode('idle', 'frantic', false)).toBe('frantic')
    expect(turnMode('idle', 'curious', false)).toBe('working')
    expect(turnMode('idle', 'excited', false)).toBe('working')
    expect(turnMode('idle', 'calm', false)).toBe('calm')
    expect(turnMode('idle', 'satisfied', false)).toBe('idle')
    // Solving overrides everything, even blocked.
    expect(turnMode('blocked', 'frantic', true)).toBe('solving')
    expect(turnMode('idle', 'calm', true)).toBe('solving')
  })

  it('turn constants leave room to solve a full scramble', () => {
    expect(MAX_SCRAMBLE).toBe(20)
    expect(MAX_SCRAMBLE * TURN_MS.solving).toBeLessThanOrEqual(SOLVE_MS)
    expect(TURN_MS.frantic).toBeLessThan(TURN_MS.working)
    expect(TURN_MS.working).toBeLessThan(TURN_MS.calm)
  })

  it('turnAngle is 0 at p=0, ±π/2 at p=1, and monotonic in between', () => {
    const fwd: Move = { axis: 'x', layer: 1, dir: 1 }
    const rev: Move = { axis: 'x', layer: 1, dir: -1 }
    expect(turnAngle(fwd, 0)).toBe(0)
    expect(turnAngle(fwd, 1)).toBeCloseTo(Math.PI / 2)
    expect(turnAngle(rev, 1)).toBeCloseTo(-Math.PI / 2)
    let prev = -Infinity
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const a = turnAngle(fwd, Math.min(1, p))
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  it('cubeLook: buffering emotions no longer shake or fake-scramble; errors still shake and explode', () => {
    for (const emotion of ['curious', 'excited', 'frantic'] as const) {
      const look = cubeLook(soul(emotion), 10_100, 0, 1)
      expect(look.jitterPx).toBe(0)
      expect(look.scrambled).toBe(false)
    }
    const angry = cubeLook(soul('angry'), 10_200, 0, 1)
    expect(angry.jitterPx).toBeGreaterThan(0)
    expect(angry.explode).toBeGreaterThan(0)
  })
})
