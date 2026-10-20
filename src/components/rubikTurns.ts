// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * rubikTurns — the turn machine for one background cube (pure, no canvas).
 * Working modes scramble with real quarter-turns and unwind back to solved
 * every MAX_SCRAMBLE moves; the completion moment plays the history back fast;
 * at rest the cube tidies itself up, then only does a lazy turn-and-return,
 * so a resting cube always ends up solved.
 */

import { applyMove, inverseMove, moveSequence, solvedCubies, type Cubie, type Move } from './rubikModel'
import { MAX_SCRAMBLE, TURN_MS, turnAngle, type turnMode } from './cubeMotion'

export type TurnMode = ReturnType<typeof turnMode>

export interface RubikRunner {
  seed: number
  cubies: Cubie[]
  history: Move[]
  queue: Move[]
  current: { move: Move; startedAt: number; ms: number; unwind: boolean } | null
  unwinding: boolean
  nextCalmAt: number
}

/** Seconds between lazy turns at rest; staggered per cube. */
export function calmInterval(seed: number): number {
  return 9000 + (seed % 7) * 600
}

export function newRubikRunner(seed: number): RubikRunner {
  return { seed, cubies: solvedCubies(), history: [], queue: moveSequence(seed, 30), current: null, unwinding: false, nextCalmAt: 0 }
}

function finishTurn(rk: RubikRunner): void {
  const cur = rk.current
  if (!cur) return
  rk.cubies = applyMove(rk.cubies, cur.move)
  if (cur.unwind) rk.history.pop(); else rk.history.push(cur.move)
  if (rk.history.length === 0) rk.unwinding = false
  rk.current = null
}

function startTurn(rk: RubikRunner, move: Move, now: number, ms: number, unwind: boolean): void {
  rk.current = { move, startedAt: now, ms, unwind }
  if (unwind) rk.unwinding = true
}

function unwindOne(rk: RubikRunner, now: number, ms: number): void {
  startTurn(rk, inverseMove(rk.history[rk.history.length - 1]), now, ms, true)
}

function scrambleOrUnwind(rk: RubikRunner, now: number, ms: number): void {
  if (rk.unwinding || rk.history.length >= MAX_SCRAMBLE) {
    // Fully scrambled: play the history back to solved, then scramble again.
    if (rk.history.length > 0) { unwindOne(rk, now, ms); return }
    rk.unwinding = false
  }
  if (rk.queue.length === 0) rk.queue = moveSequence(rk.seed + rk.history.length, 30)
  startTurn(rk, rk.queue.shift()!, now, ms, false)
}

/** Advance one frame: finish a completed turn, then start the next one the mode allows. */
export function stepRubik(rk: RubikRunner, mode: TurnMode, frameNow: number): void {
  // A turn that ended between frames hands its exact end time to the next one, so a sequence keeps its
  // pace instead of losing part of a frame per turn (a 20-move solve must fit SOLVE_MS). Capped, so a
  // long pause (background tab) doesn't replay missed turns.
  let now = frameNow
  if (mode === 'frozen') finishTurn(rk) // blocked: finish the in-flight turn instantly, then hold
  else if (rk.current && frameNow - rk.current.startedAt >= rk.current.ms) {
    now = Math.max(rk.current.startedAt + rk.current.ms, frameNow - 32)
    finishTurn(rk)
  } else if (mode === 'solving' && rk.current && !rk.current.unwind) finishTurn(rk) // stop scrambling at once
  if (rk.current || mode === 'frozen' || mode === 'idle') return
  if (mode === 'solving') {
    if (rk.history.length > 0) unwindOne(rk, now, TURN_MS.solving)
  } else if (mode === 'working') {
    scrambleOrUnwind(rk, now, TURN_MS.working)
  } else if (mode === 'frantic') {
    scrambleOrUnwind(rk, now, TURN_MS.frantic)
  } else if (mode === 'calm') {
    // At rest: first tidy up (ungated), then a lazy turn every ~9 s that the next step turns straight back.
    if (rk.history.length > 0) unwindOne(rk, now, TURN_MS.calm)
    else if (rk.nextCalmAt === 0) rk.nextCalmAt = now + 2000 + (rk.seed % 7) * 1300 // first lazy turn: staggered, not all at once on load
    else if (now >= rk.nextCalmAt) {
      rk.nextCalmAt = now + calmInterval(rk.seed)
      if (rk.queue.length === 0) rk.queue = moveSequence(rk.seed, 30)
      startTurn(rk, rk.queue.shift()!, now, TURN_MS.calm, false)
    }
  }
}

/** The layer turning right now and its eased angle, or null. */
export function rubikTurning(rk: RubikRunner, now: number): { move: Move; angle: number } | null {
  const cur = rk.current
  return cur ? { move: cur.move, angle: turnAngle(cur.move, Math.min(1, (now - cur.startedAt) / cur.ms)) } : null
}
