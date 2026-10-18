// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Rubik's cube reactions, derived only from NeuralState (no parallel event bus).
// Pure functions so the behavior is unit-testable without a canvas.

import type { NeuralPhase } from '../hooks/useNeuralState'
import type { CoreEmotion, CoreGesture } from '../core/forgeclawReactiveCore'

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

// ─── Living cubes: emotional body ────────────────────────────────────────────
// Driven by the reactive core's `forgeclaw:state` (emotion, energy, gesture).
// Everything is a pure function of timestamps so the render loop needs no
// timers per cube (bursts of events can't pile up setTimeouts).


export type RGB = { r: number; g: number; b: number }
export const WAVE_STAGGER_MS = 100
export const WAVE_MS = 700
export const CELEBRATE_STAGGER_MS = 50
export const CELEBRATE_MS = 1000
export const EXPLODE_MS = 800
export const FLASH_MS = 900
const LAZY_TURN_EVERY_S = 9
const LAZY_TURN_S = 0.8

export interface SoulSignal {
  emotion: CoreEmotion
  energy: number
  /** When `emotion` last changed (ms). */
  emotionAt: number
  gesture?: CoreGesture
  /** When the last gesture arrived (ms). */
  gestureAt: number
}

export const CALM_SOUL: SoulSignal = { emotion: 'calm', energy: 0, emotionAt: 0, gestureAt: 0 }

export interface CubeLook {
  /** Base spin rate, rad/s (integrated by the caller). */
  spin: number
  /** Instant angle offset added on top of the integrated angle (micro-rotations, wobble, gestures). */
  angleOffset: number
  jitterPx: number
  scale: number
  /** 0..1 glow strength and color. */
  glow: number
  glowColor: RGB
  /** Draw a scrambled sprite instead of the solved one. */
  scrambled: boolean
  /** 0..1 how far the 9 pieces have flown apart. */
  explode: number
  /** Short colored flash over the cube, or null. */
  flash: { color: RGB; alpha: number } | null
}

const CYAN: RGB = { r: 6, g: 182, b: 212 }
const BLUE: RGB = { r: 68, g: 136, b: 255 }
const GREEN: RGB = { r: 0, g: 255, b: 136 }
const RED: RGB = { r: 255, g: 0, b: 68 }
const GOLD: RGB = { r: 255, g: 215, b: 0 }

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
const window01 = (now: number, start: number, dur: number) => {
  const p = (now - start) / dur
  return p >= 0 && p < 1 ? p : null
}

/** Pieces fly out fast, then snap back: 0 → 1 over the first 40%, back to 0 by the end. */
export function explodeAmount(emotionAt: number, nowMs: number): number {
  const p = window01(nowMs, emotionAt, EXPLODE_MS)
  if (p === null) return 0
  return p < 0.4 ? 1 - Math.pow(1 - p / 0.4, 3) : 1 - Math.pow((p - 0.4) / 0.6, 2)
}

/**
 * How one cube should look right now. `order` is the cube's left-to-right
 * index (for the Mexican wave), `nodeId` de-synchronizes cubes.
 */
export function cubeLook(soul: SoulSignal, nowMs: number, order: number, nodeId: number): CubeLook {
  const t = nowMs / 1000
  const e = Math.min(100, Math.max(0, soul.energy)) / 100
  const energyGlow = 0.6 + 0.4 * e
  let look: CubeLook = { spin: 0.15, angleOffset: 0, jitterPx: 0, scale: 1, glow: 0.12, glowColor: CYAN, scrambled: false, explode: 0, flash: null }

  switch (soul.emotion) {
    case 'calm': {
      // Gentle breathing glow and an occasional lazy quarter turn.
      const phase = (t + nodeId * 1.37) % LAZY_TURN_EVERY_S
      const turn = phase < LAZY_TURN_S ? easeInOut(phase / LAZY_TURN_S) * (Math.PI / 2) : 0
      look = { ...look, glow: 0.12 + 0.08 * Math.sin(t * 1.6 + nodeId), angleOffset: turn }
      break
    }
    case 'curious':
      // AI thinking: rapid micro-rotations, pulsing glow, slight jitter.
      look = { ...look, spin: 1.2, angleOffset: Math.sin(t * 25 + nodeId) * 0.06, glow: (0.35 + 0.15 * Math.sin(t * 6)) * energyGlow, jitterPx: 0.6 }
      break
    case 'anticipatory':
      // User typing: excited wobble.
      look = { ...look, spin: 0.3, angleOffset: Math.sin(t * 7 + nodeId * 0.5) * 0.18, scale: 1 + 0.05 * Math.sin(t * 7 + nodeId), glow: 0.3 * energyGlow }
      break
    case 'excited':
      look = { ...look, spin: 2.2, glow: 0.5 * energyGlow, jitterPx: 0.8 }
      break
    case 'frantic':
      // Shell running: frantic scrambling, shaking, intense glow.
      look = { ...look, spin: 4.5, glow: 0.9 * energyGlow, jitterPx: 3 * (0.3 + e), scrambled: true }
      break
    case 'satisfied': {
      const p = window01(nowMs, soul.emotionAt, FLASH_MS)
      look = { ...look, spin: 0.3, glow: 0.6, glowColor: GREEN, flash: p === null ? null : { color: GREEN, alpha: 0.45 * (1 - p) } }
      break
    }
    case 'angry':
    case 'pain': {
      // Error: violent shake, red flash, pieces explode outward then snap back.
      const p = window01(nowMs, soul.emotionAt, FLASH_MS)
      look = {
        ...look, spin: soul.emotion === 'pain' ? 0.5 : 3, glow: 1, glowColor: RED,
        jitterPx: soul.emotion === 'pain' ? 4 : 3, explode: explodeAmount(soul.emotionAt, nowMs),
        flash: p === null ? null : { color: RED, alpha: 0.5 * (1 - p) },
      }
      break
    }
  }

  // One-off gestures on top of the emotion.
  if (soul.gesture === 'wave') {
    const p = window01(nowMs, soul.gestureAt + order * WAVE_STAGGER_MS, WAVE_MS)
    if (p !== null) look = { ...look, angleOffset: look.angleOffset + easeInOut(p) * Math.PI * 2, flash: { color: BLUE, alpha: 0.5 * (1 - p) } }
  } else if (soul.gesture === 'celebrate') {
    const p = window01(nowMs, soul.gestureAt + order * CELEBRATE_STAGGER_MS, CELEBRATE_MS)
    if (p !== null) look = { ...look, angleOffset: look.angleOffset + easeInOut(p) * Math.PI * 4, scale: look.scale * (1 + 0.2 * Math.sin(Math.PI * p)), glow: 1, glowColor: GOLD, flash: { color: GOLD, alpha: 0.4 * (1 - p) } }
  }
  return look
}

/** Deterministic jitter (no Math.random in the frame loop), de-synchronized per cube. */
export function cubeJitter(amountPx: number, nowMs: number, nodeId: number): { dx: number; dy: number } {
  if (amountPx <= 0) return { dx: 0, dy: 0 }
  const t = nowMs / 1000
  return { dx: Math.sin(t * 43 + nodeId * 1.9) * amountPx, dy: Math.cos(t * 39 + nodeId * 2.7) * amountPx }
}
