import { describe, expect, it } from 'vitest'
import { calmInterval, newRubikRunner, rubikTurning, stepRubik, type TurnMode } from './rubikTurns'
import { isSolved } from './rubikModel'
import { MAX_SCRAMBLE, SOLVE_MS, TURN_MS } from './cubeMotion'

/** Drive one cube frame by frame (16 ms) in a mode; returns the time reached. */
function run(rk: ReturnType<typeof newRubikRunner>, mode: TurnMode, from: number, ms: number): number {
  let t = from
  for (; t < from + ms; t += 16) stepRubik(rk, mode, t)
  return t
}

describe('rubik turn machine', () => {
  it('scrambles with real turns while working, and never goes past MAX_SCRAMBLE moves from solved', () => {
    const rk = newRubikRunner(3)
    let maxDepth = 0
    for (let t = 0; t < 20_000; t += 16) { stepRubik(rk, 'working', t); maxDepth = Math.max(maxDepth, rk.history.length) }
    expect(maxDepth).toBe(MAX_SCRAMBLE)
    expect(rubikTurning(rk, 20_000)).not.toBeNull()
  })

  it('a resting cube tidies itself up to solved after work stops (no "task complete" needed)', () => {
    const rk = newRubikRunner(5)
    const t = run(rk, 'working', 0, 3_000) // ~10 turns at 280 ms
    expect(rk.history.length).toBeGreaterThan(5)
    expect(isSolved(rk.cubies)).toBe(false)
    run(rk, 'calm', t, rk.history.length * TURN_MS.calm + 1_000)
    expect(rk.history.length).toBe(0)
    expect(isSolved(rk.cubies)).toBe(true)
  })

  it('at rest it does a lazy turn and turns straight back, so it stays solved', () => {
    const rk = newRubikRunner(2)
    let sawTurn = false
    for (let t = 0; t < calmInterval(2) * 2 + 3_000; t += 16) {
      stepRubik(rk, 'calm', t)
      if (rk.current) sawTurn = true
    }
    expect(sawTurn).toBe(true)
    run(rk, 'calm', 100_000, 2 * TURN_MS.calm + 100)
    expect(isSolved(rk.cubies)).toBe(true)
  })

  it('the completion moment solves a fully scrambled cube within SOLVE_MS', () => {
    const rk = newRubikRunner(9)
    let t = 0
    while (rk.history.length < MAX_SCRAMBLE) { stepRubik(rk, 'working', t); t += 16 }
    run(rk, 'solving', t, SOLVE_MS)
    expect(isSolved(rk.cubies)).toBe(true)
  })

  it('blocked finishes the turn in flight and then holds still', () => {
    const rk = newRubikRunner(4)
    stepRubik(rk, 'working', 0)
    expect(rk.current).not.toBeNull()
    stepRubik(rk, 'frozen', 50)
    expect(rk.current).toBeNull()
    const before = rk.cubies
    run(rk, 'frozen', 100, 2_000)
    expect(rk.cubies).toBe(before)
  })
})
