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

/** The exact schema both layers use (directive §Integration Points). */
export interface ForgeClawStateEvent {
  state: CoreState
  /** 0.0–1.0 */
  activity: number
  /** 1–10 */
  intensity: number
  source: CoreSource
  timestamp: number
}

export const STATE_EVENT_NAME = 'forgeclaw:state'
/** success relaxes back to idle after this long, so cubes don't celebrate forever. */
export const SUCCESS_HOLD_MS = 1500
const HISTORY_LIMIT = 20

const ACTIVITY: Record<CoreState, number> = { idle: 0.1, thinking: 0.4, running: 0.8, success: 0.3, error: 1.0 }

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

type Listener = (event: ForgeClawStateEvent) => void

export class ForgeClawReactiveCore {
  state: CoreState = 'idle'
  activityLevel = ACTIVITY.idle
  /** Most recent broadcasts (oldest first), so a late-mounting visual layer can catch up. */
  eventQueue: ForgeClawStateEvent[] = []
  private listeners = new Set<Listener>()
  private relaxTimer: ReturnType<typeof setTimeout> | null = null
  private target: EventTarget | null
  private now: () => number

  constructor(options: { target?: EventTarget | null; now?: () => number } = {}) {
    this.target = options.target === undefined ? (typeof window !== 'undefined' ? window : null) : options.target
    this.now = options.now ?? (() => Date.now())
  }

  /** Feed one real ForgeOps event. */
  ingest(event: AgentEvent): void {
    const next = mapForgeOpsEvent(event)
    if (next) this.setState(next.state, { severity: next.intensity, source: next.source })
  }

  setState(state: CoreState, data: { severity?: number; source?: CoreSource } = {}): ForgeClawStateEvent {
    this.clearRelax()
    this.state = state
    this.activityLevel = this.getActivityLevel(state)
    const message = this.broadcast({
      state,
      activity: this.activityLevel,
      intensity: clampIntensity(data.severity ?? 1),
      source: data.source ?? 'agent',
      timestamp: this.now(),
    })
    if (state === 'success') this.relaxTimer = setTimeout(() => { this.relaxTimer = null; this.setState('idle', { source: 'system' }) }, SUCCESS_HOLD_MS)
    return message
  }

  /** One-off activity burst without leaving the current state (directive: shell exec / complete). */
  pulse(kind: 'execution' | 'complete', activity: number): ForgeClawStateEvent {
    return this.broadcast({
      state: kind === 'complete' ? 'success' : 'running',
      activity: clamp01(activity),
      intensity: kind === 'complete' ? 6 : 5,
      source: 'shell',
      timestamp: this.now(),
    })
  }

  /** Named trigger (directive: git activity). */
  trigger(name: 'git_activity'): ForgeClawStateEvent {
    void name
    return this.broadcast({ state: 'running', activity: ACTIVITY.running, intensity: 4, source: 'git', timestamp: this.now() })
  }

  getActivityLevel(state: CoreState): number {
    return ACTIVITY[state] ?? 0.2
  }

  /** Last broadcast, or an idle snapshot before anything happened. */
  getSnapshot(): ForgeClawStateEvent {
    return this.eventQueue[this.eventQueue.length - 1]
      ?? { state: this.state, activity: this.activityLevel, intensity: 1, source: 'system', timestamp: this.now() }
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
