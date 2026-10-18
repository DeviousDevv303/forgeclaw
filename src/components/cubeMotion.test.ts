import { describe, expect, it } from 'vitest'
import { SOLVE_MS, cubeScale, cubeShake, cubeSpinRate, nextCubeAngle, solveProgress } from './cubeMotion'

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
