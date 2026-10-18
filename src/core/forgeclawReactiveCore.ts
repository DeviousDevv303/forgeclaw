// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// ForgeClaw reactive core ("central nervous system") — Claude's half of the
// joint Reactive Rubik's Cubes directive. It turns the real ForgeOps event
// stream into one small state machine and broadcasts every change as a
// `forgeclaw:state` CustomEvent on window, for Manus's visual layer.
// Contract: docs/INTEGRATION.md. Payloads carry state only — never prompt text,
// error messages, tool output or credentials.

import type { AgentEvent } from '../types/forgeOps'

export type CoreState = 'idle' | 'thinking' | 'running' | 'success' | 'error'
export type CoreSource = 'agent' | 'shell' | 'git' | 'system'
/** Emotional layer (merged from the "CubeSoul" proposal): what the cubes should feel. */
export type CoreEmotion = 'calm' | 'curious' | 'anticipatory' | 'excited' | 'frantic' | 'satisfied' | 'angry' | 'pain'
/** One-off coordinated animations. */
export type CoreGesture = 'wave' | 'celebrate'

/** The exact schema both layers use (directive §Integration Points). */
export interface ForgeClawStateEvent {
  state: CoreState
  /** 0.0–1.0 */
  activity: number
  /** 1–10 */
  intensity: number
  source: CoreSource
  timestamp: number
  /** Emotional layer: current feeling. */
  emotion: CoreEmotion
  /** 0–100; builds with activity, decays after 3 s of quiet. */
  energy: number
  /** Present only on the broadcast that should trigger a one-off animation. */
  gesture?: CoreGesture
}

export const STATE_EVENT_NAME = 'forgeclaw:state'
/** success relaxes back to idle after this long, so cubes don't celebrate forever. */
export const SUCCESS_HOLD_MS = 1500
const HISTORY_LIMIT = 20

const ACTIVITY: Record<CoreState, number> = { idle: 0.1, thinking: 0.4, running: 0.8, success: 0.3, error: 1.0 }
/** Quiet time before energy starts to decay, then one decay step per DECAY_STEP_MS. */
export const DECAY_DELAY_MS = 3000
export const DECAY_STEP_MS = 1000
const TYPING_THROTTLE_MS = 1000
const READ_TOOLS = new Set(['github_read_file', 'github_list_files', 'github_repo_state', 'github_search_code', 'github_verify_commit'])
const WRITE_TOOLS = new Set(['github_write_file', 'shell_patch'])

/** Tool name → which subsystem it belongs to. */
export function sourceForTool(tool: string): CoreSource {
  if (tool === 'shell_exec' || tool === 'shell_patch' || tool.startsWith('shell_')) return 'shell'
  if (tool.startsWith('github_') || tool.startsWith('git_')) return 'git'
  return 'agent'
}

/**
 * Pure mapping from one ForgeOps event to a core transition, or null for
 * bookkeeping events (checkpoints, confidence, threads) that don't change state.
 */
export function mapForgeOpsEvent(event: AgentEvent): { state: CoreState; intensity: number; source: CoreSource } | null {
  switch (event.type) {
    case 'OBJECTIVE_RECEIVED': return { state: 'thinking', intensity: 3, source: 'agent' }
    case 'PHASE_CHANGE':
      switch (event.phase) {
        case 'EXECUTION': return { state: 'running', intensity: 6, source: 'agent' }
        case 'COMPLETE': return { state: 'success', intensity: 5, source: 'agent' }
        case 'BLOCKED': return { state: 'error', intensity: 9, source: 'agent' }
        default: return { state: 'thinking', intensity: 4, source: 'agent' } // OBJECTIVE, PLAN, VERIFICATION, NEXT_ACTION
      }
    case 'TOOL_START': return { state: 'running', intensity: 7, source: sourceForTool(event.tool) }
    case 'TOOL_FAILURE': return { state: 'error', intensity: 7, source: sourceForTool(event.tool) }
    case 'MISSION_COMPLETE': return { state: 'success', intensity: 6, source: 'agent' }
    case 'MISSION_BLOCKED': return { state: 'error', intensity: 10, source: 'agent' }
    case 'GUARDIAN_WARNING': return { state: 'error', intensity: 8, source: 'system' }
    case 'RESET': return { state: 'idle', intensity: 1, source: 'system' }
    default: return null
  }
}

/**
 * Pure mapping from a ForgeOps event to a feeling. `gain` is added to energy.
 * Sources the CubeSoul sketch named via a non-existent app.on(...) emitter are
 * taken from the real stream: shell start/success/failure, GitHub reads
 * ("fetch" -> wave) and writes ("push" -> celebrate), blocks and Guardian.
 */
export function emotionForEvent(event: AgentEvent): { emotion: CoreEmotion; gain: number; gesture?: CoreGesture } | null {
  switch (event.type) {
    case 'OBJECTIVE_RECEIVED': return { emotion: 'curious', gain: 30 }
    case 'TOOL_START': {
      if (sourceForTool(event.tool) === 'shell') return { emotion: 'frantic', gain: 80 }
      if (READ_TOOLS.has(event.tool)) return { emotion: 'excited', gain: 40, gesture: 'wave' }
      return { emotion: 'excited', gain: 60 }
    }
    case 'TOOL_SUCCESS':
      if (WRITE_TOOLS.has(event.tool)) return { emotion: 'satisfied', gain: 20, gesture: 'celebrate' }
      return sourceForTool(event.tool) === 'shell' ? { emotion: 'satisfied', gain: 20 } : null
    case 'TOOL_FAILURE': return { emotion: 'angry', gain: 90 }
    case 'MISSION_COMPLETE': return { emotion: 'satisfied', gain: 20 }
    case 'MISSION_BLOCKED':
    case 'GUARDIAN_WARNING': return { emotion: 'pain', gain: 100 }
    case 'RESET': return { emotion: 'calm', gain: 0 }
    default: return null
  }
}

type Listener = (event: ForgeClawStateEvent) => void

export class ForgeClawReactiveCore {
  state: CoreState = 'idle'
  activityLevel = ACTIVITY.idle
  /** Most recent broadcasts (oldest first), so a late-mounting visual layer can catch up. */
  eventQueue: ForgeClawStateEvent[] = []
  emotion: CoreEmotion = 'calm'
  energy = 0
  private listeners = new Set<Listener>()
  private relaxTimer: ReturnType<typeof setTimeout> | null = null
  private decayTimer: ReturnType<typeof setTimeout> | null = null
  private lastTypingAt = -Infinity
  private target: EventTarget | null
  private now: () => number

  constructor(options: { target?: EventTarget | null; now?: () => number } = {}) {
    this.target = options.target === undefined ? (typeof window !== 'undefined' ? window : null) : options.target
    this.now = options.now ?? (() => Date.now())
  }

  /** Feed one real ForgeOps event. */
  ingest(event: AgentEvent): void {
    const next = mapForgeOpsEvent(event)
    const feeling = emotionForEvent(event)
    if (event.type === 'RESET') { this.energy = 0 }
    if (feeling) this.feel(feeling.emotion, feeling.gain)
    const gesture = feeling?.gesture
    if (next) this.setState(next.state, { severity: next.intensity, source: next.source, gesture })
    else if (feeling) this.emit({ intensity: 1, source: 'tool' in event ? sourceForTool(event.tool) : 'agent', gesture })
  }

  /** The operator is typing in the chat box: anticipation, throttled, only while idle. */
  userTyping(): void {
    const t = this.now()
    if (this.state !== 'idle' || t - this.lastTypingAt < TYPING_THROTTLE_MS) return
    this.lastTypingAt = t
    this.feel('anticipatory', 40)
    this.emit({ intensity: 2, source: 'system' })
  }

  private feel(emotion: CoreEmotion, gain: number) {
    this.emotion = emotion
    this.energy = Math.min(100, this.energy + Math.max(0, gain))
    this.scheduleDecay(DECAY_DELAY_MS)
  }

  private scheduleDecay(ms: number) {
    if (this.decayTimer) clearTimeout(this.decayTimer)
    this.decayTimer = setTimeout(() => {
      this.decayTimer = null
      this.energy *= 0.7
      if (this.energy < 5) { this.energy = 0; this.emotion = 'calm' }
      this.emit({ intensity: 1, source: 'system' })
      if (this.energy > 0) this.scheduleDecay(DECAY_STEP_MS)
    }, ms)
  }

  /** Re-broadcast the current state with the current feeling. */
  private emit(extra: { intensity: number; source: CoreSource; gesture?: CoreGesture }) {
    this.broadcast(this.message(this.state, this.activityLevel, extra.intensity, extra.source, extra.gesture))
  }

  private message(state: CoreState, activity: number, intensity: number, source: CoreSource, gesture?: CoreGesture): ForgeClawStateEvent {
    return {
      state, activity, intensity, source, timestamp: this.now(),
      emotion: this.emotion, energy: Math.round(this.energy),
      ...(gesture ? { gesture } : {}),
    }
  }

  setState(state: CoreState, data: { severity?: number; source?: CoreSource; gesture?: CoreGesture } = {}): ForgeClawStateEvent {
    this.clearRelax()
    this.state = state
    this.activityLevel = this.getActivityLevel(state)
    const message = this.broadcast(this.message(state, this.activityLevel, clampIntensity(data.severity ?? 1), data.source ?? 'agent', data.gesture))
    if (state === 'success') this.relaxTimer = setTimeout(() => { this.relaxTimer = null; this.setState('idle', { source: 'system' }) }, SUCCESS_HOLD_MS)
    return message
  }

  /** One-off activity burst without leaving the current state (directive: shell exec / complete). */
  pulse(kind: 'execution' | 'complete', activity: number): ForgeClawStateEvent {
    return this.broadcast(this.message(kind === 'complete' ? 'success' : 'running', clamp01(activity), kind === 'complete' ? 6 : 5, 'shell'))
  }

  /** Named trigger (directive: git activity). */
  trigger(name: 'git_activity'): ForgeClawStateEvent {
    void name
    return this.broadcast(this.message('running', ACTIVITY.running, 4, 'git', 'wave'))
  }

  getActivityLevel(state: CoreState): number {
    return ACTIVITY[state] ?? 0.2
  }

  /** Last broadcast, or an idle snapshot before anything happened. */
  getSnapshot(): ForgeClawStateEvent {
    return this.eventQueue[this.eventQueue.length - 1]
      ?? this.message(this.state, this.activityLevel, 1, 'system')
  }

  /** In-process subscription (tests, React). Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  broadcast(message: ForgeClawStateEvent): ForgeClawStateEvent {
    this.eventQueue = [...this.eventQueue, message].slice(-HISTORY_LIMIT)
    for (const listener of this.listeners) {
      try { listener(message) } catch (err) { console.warn('[forgeCore] listener failed:', err) }
    }
    if (this.target && typeof CustomEvent !== 'undefined') {
      this.target.dispatchEvent(new CustomEvent(STATE_EVENT_NAME, { detail: message }))
    }
    return message
  }

  dispose(): void {
    this.clearRelax()
    if (this.decayTimer) { clearTimeout(this.decayTimer); this.decayTimer = null }
    this.listeners.clear()
  }

  private clearRelax() {
    if (this.relaxTimer) { clearTimeout(this.relaxTimer); this.relaxTimer = null }
  }
}

function clamp01(n: number) { return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0)) }
function clampIntensity(n: number) { return Math.min(10, Math.max(1, Math.round(Number.isFinite(n) ? n : 1))) }

declare global {
  interface Window { forgeCore?: ForgeClawReactiveCore }
}

/** Install the singleton on window (idempotent). */
export function installForgeCore(): ForgeClawReactiveCore {
  if (typeof window === 'undefined') return new ForgeClawReactiveCore({ target: null })
  if (!window.forgeCore) window.forgeCore = new ForgeClawReactiveCore()
  return window.forgeCore
}
