// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Rubik's cube reactions, derived only from NeuralState (no parallel event bus).
// Pure functions so the behavior is unit-testable without a canvas.

import type { NeuralPhase } from '../hooks/useNeuralState'

/** How long the "solve" moment lasts after MISSION_COMPLETE. */
export const SOLVE_MS = 1200
const QUARTER = Math.PI / 2

/** Spin speed in radians/second. Blocked freezes; streaming follows token velocity. */
export function cubeSpinRate(phase: NeuralPhase, tokenVelocity: number, toolLit: boolean): number {
  const base =
    phase === 'blocked' ? 0
      : phase === 'executing' ? 1.6
      : phase === 'streaming' ? Math.min(4, 1 + Math.max(0, tokenVelocity) / 40)
      : phase === 'verifying' ? 0.8
      : phase === 'planning' ? 0.6
      : 0.15
  return base * (toolLit && phase !== 'blocked' ? 2 : 1)
}

/** Size multiplier: an in-flight tool's cube pops. */
export function cubeScale(toolLit: boolean, phase: NeuralPhase): number {
  return toolLit && phase !== 'blocked' ? 1.25 : 1
}

/** Error shake offset in px, scaled by severity; deterministic per node so cubes don't move in lockstep. */
export function cubeShake(errorLevel: 0 | 1 | 2, nowMs: number, nodeId: number): { dx: number; dy: number } {
  if (errorLevel === 0) return { dx: 0, dy: 0 }
  const amp = errorLevel * 2
  const t = nowMs / 1000
  return { dx: Math.sin(t * 40 + nodeId * 1.7) * amp, dy: Math.cos(t * 37 + nodeId * 2.3) * amp }
}

/** Progress 0..1 of the solve moment, or null when not solving. */
export function solveProgress(completedAt: number, nowMs: number): number | null {
  if (!completedAt) return null
  const elapsed = nowMs - completedAt
  return elapsed >= 0 && elapsed < SOLVE_MS ? elapsed / SOLVE_MS : null
}

/**
 * Next rotation angle. While solving, the cube eases to the nearest quarter turn
 * (looks "solved"/square); otherwise it integrates the spin rate.
 */
export function nextCubeAngle(angle: number, rate: number, dtSec: number, solving: boolean): number {
  if (solving) {
    const target = Math.round(angle / QUARTER) * QUARTER
    return angle + (target - angle) * Math.min(1, dtSec * 8)
  }
  return (angle + rate * dtSec) % (Math.PI * 2)
}
