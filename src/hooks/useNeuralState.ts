// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * useNeuralState — derives the neural background's visual state from the
 * existing ForgeOps event stream. This hook only observes; it never executes
 * anything and never invents a parallel event system.
 *
 * Token velocity is computed from message content growth between renders
 * (less precise than plumbing onToken, but keeps the App.tsx send path
 * untouched — see directive hand-off note).
 *
 * Nexus learning (addendum): phase transitions, failure signatures, and
 * latency profiles are recorded via the existing recordLearningEvent pipeline,
 * so integrity hashing, redaction, 4KB bounds, and unapproved-candidate
 * admission apply automatically. Learning is best-effort and rate-limited.
 */

import { useState, useEffect, useRef } from 'react'
import type { ForgeOpsState } from '../types/forgeOps'
import { recordLearningEvent } from '../lib/learningEvents'

export type NeuralPhase = 'idle' | 'planning' | 'executing' | 'verifying' | 'blocked' | 'streaming'

export interface NeuralState {
  phase: NeuralPhase
  provider: string
  activeToolCount: number
  tokenVelocity: number
  errorLevel: 0 | 1 | 2
  /** Date.now() of the last MISSION_COMPLETE (0 = none); drives the cubes' brief "solve" moment. */
  completedAt: number
}

export const IDLE_NEURAL_STATE: NeuralState = {
  phase: 'idle',
  provider: 'corpus',
  activeToolCount: 0,
  tokenVelocity: 0,
  errorLevel: 0,
  completedAt: 0,
}

/** Map a ForgeOps agent phase to a neural display phase. */
export function mapAgentPhase(phase: string): NeuralPhase {
  switch (phase) {
    case 'PLAN':
    case 'OBJECTIVE':
    case 'NEXT_ACTION':
      return 'planning'
    case 'EXECUTION':
      return 'executing'
    case 'VERIFICATION':
      return 'verifying'
    case 'BLOCKED':
      return 'blocked'
    case 'COMPLETE':
      return 'idle'
    default:
      return 'idle'
  }
}

// EMA smoothing factor for token velocity
const VELOCITY_ALPHA = 0.3
// Display 'streaming' while tokens arrived within this window
const STREAMING_WINDOW_MS = 1500
// Learning rate-limit: max 1 event per channel per second
const LEARNING_MIN_INTERVAL_MS = 1000

interface LearningBudget {
  [channel: string]: number
}

function budgetAllows(budget: LearningBudget, channel: string, now: number): boolean {
  const last = budget[channel] || 0
  if (now - last < LEARNING_MIN_INTERVAL_MS) return false
  budget[channel] = now
  return true
}

export interface UseNeuralStateOptions {
  /** Total text length of visible messages; used for velocity estimation. */
  contentLength: number
}

export function useNeuralState(
  forgeOpsState: ForgeOpsState,
  provider: string,
  options: UseNeuralStateOptions,
): NeuralState {
  const [neuralState, setNeuralState] = useState<NeuralState>({ ...IDLE_NEURAL_STATE, provider })

  // Refs for values that shouldn't trigger re-renders
  const lastEventRef = useRef<object | null>(null)
  const lastContentLengthRef = useRef(options.contentLength)
  const lastContentTimeRef = useRef(Date.now())
  const lastTokenTimeRef = useRef(0)
  const velocityRef = useRef(0)
  const agentPhaseRef = useRef<NeuralPhase>('idle')
  const phaseSequenceRef = useRef<string[]>([])
  const completedAtRef = useRef(0)
  const requestStartRef = useRef<number>(0)
  const consecutiveFailuresRef = useRef(0)
  const learningBudgetRef = useRef<LearningBudget>({})

  // Keep provider in sync without resetting the rest of the state
  useEffect(() => {
    setNeuralState(prev => (prev.provider === provider ? prev : { ...prev, provider }))
  }, [provider])

  // Token velocity from content growth (EMA-smoothed)
  useEffect(() => {
    const now = Date.now()
    const delta = options.contentLength - lastContentLengthRef.current
    if (delta > 0) {
      const dtSec = Math.max(0.05, (now - lastContentTimeRef.current) / 1000)
      const instant = delta / dtSec
      velocityRef.current = VELOCITY_ALPHA * instant + (1 - VELOCITY_ALPHA) * velocityRef.current
      lastTokenTimeRef.current = now
    } else {
      // Decay toward zero when no new content
      velocityRef.current *= 0.9
      if (velocityRef.current < 0.5) velocityRef.current = 0
    }
    lastContentLengthRef.current = options.contentLength
    lastContentTimeRef.current = now
  })

  // Process new ForgeOps events. Track by identity, not count — the
  // ForgeOps window slides (capped at 60), so count-based tracking goes
  // blind once the window is full.
  useEffect(() => {
    const events = forgeOpsState.events
    let newEvents: typeof events
    if (events.length === 0) {
      newEvents = []
    } else if (lastEventRef.current === null) {
      newEvents = events.slice()
    } else {
      const idx = events.lastIndexOf(lastEventRef.current as never)
      newEvents = idx >= 0 ? events.slice(idx + 1) : events.slice()
    }
    if (newEvents.length === 0) return
    lastEventRef.current = events[events.length - 1]

    let agentPhase = agentPhaseRef.current
    let activeToolCount = 0
    let errorLevel = neuralState.errorLevel
    let phaseChanged = false

    // Recompute active tools from current toolBus (source of truth)
    const toolBus = forgeOpsState.toolBus || {}
    activeToolCount = Object.values(toolBus).filter(s => s === 'active').length

    for (const event of newEvents) {
      const now = Date.now()

      switch (event.type) {
        case 'PHASE_CHANGE': {
          const mapped = mapAgentPhase(event.phase)
          if (mapped !== agentPhase) {
            agentPhase = mapped
            phaseChanged = true
            phaseSequenceRef.current.push(mapped)

          }
          // Blocked clears on next non-blocked phase change
          if (mapped !== 'blocked' && errorLevel > 0 && event.phase !== 'BLOCKED') {
            // errorLevel decays on forward progress, not instantly cleared
          }
          break
        }

        case 'MISSION_BLOCKED': {
          if (agentPhase !== 'blocked') {
            agentPhase = 'blocked'
            phaseChanged = true
            phaseSequenceRef.current.push('blocked')
          }
          break
        }

        case 'MISSION_COMPLETE': {
          // Addendum §3: latency profile on completed request
          const durationMs = requestStartRef.current > 0 ? now - requestStartRef.current : 0
          if (durationMs >= 0 && budgetAllows(learningBudgetRef.current, 'chat', now)) {
            void recordLearningEvent({
              channel: 'chat',
              input: `[LATENCY_PROFILE] provider=${provider}`,
              result: `latencyMs=${durationMs}; tokensPerSec=${velocityRef.current.toFixed(1)}; phaseSequence=${phaseSequenceRef.current.join('>') || 'none'}`,
              outcome: 'completed',
              runtime: 'forgeclaw-ui',
              model: provider,
              actor: 'agent',
            })
          }
          requestStartRef.current = 0
          phaseSequenceRef.current = []
          consecutiveFailuresRef.current = 0
          completedAtRef.current = now
          if (agentPhase !== 'idle') {
            agentPhase = 'idle'
            phaseChanged = true
          }
          errorLevel = 0
          break
        }

        case 'OBJECTIVE_RECEIVED': {
          requestStartRef.current = now
          phaseSequenceRef.current = []
          // New work clears idle AND blocked (e.g. after user hits STOP,
          // which emits MISSION_BLOCKED). A following PHASE_CHANGE refines it.
          if (agentPhase === 'idle' || agentPhase === 'blocked') {
            agentPhase = 'planning'
            phaseChanged = true
          }
          break
        }

        case 'RESET': {
          agentPhase = 'idle'
          phaseChanged = true
          activeToolCount = 0
          errorLevel = 0
          consecutiveFailuresRef.current = 0
          phaseSequenceRef.current = []
          requestStartRef.current = 0
          break
        }

        case 'TOOL_START': {
          // activeToolCount recomputed from toolBus above; nothing extra needed
          break
        }

        case 'TOOL_SUCCESS': {
          consecutiveFailuresRef.current = 0
          // errorLevel steps down on success
          if (errorLevel > 0) errorLevel = (errorLevel - 1) as 0 | 1 | 2
          break
        }

        case 'TOOL_FAILURE': {
          consecutiveFailuresRef.current += 1
          const consecutive = consecutiveFailuresRef.current
          errorLevel = Math.max(errorLevel, 1) as 0 | 1 | 2
          if (consecutive >= 2) errorLevel = 2

          // Addendum §2: record failure signatures with phase context.
          // Failures use their own budget key ('tool:failure') so they are
          // never dropped in favor of phase-transition records.
          if (budgetAllows(learningBudgetRef.current, 'tool:failure', now)) {
            void recordLearningEvent({
              channel: 'tool',
              input: `[TOOL_FAILURE] ${event.tool}`,
              result: `failClass=${event.failClass}; consecutive=${consecutive}; phase=${agentPhase}; errorLevel=${errorLevel}`,
              outcome: 'failed',
              runtime: 'forgeclaw-ui',
              model: provider,
              toolName: event.tool,
              actor: 'agent',
            })
          }
          break
        }

        default:
          break
      }
    }

    if (phaseChanged) {
      agentPhaseRef.current = agentPhase
    }

    // Display phase: streaming overrides while tokens are flowing
    const tokensRecent = Date.now() - lastTokenTimeRef.current < STREAMING_WINDOW_MS
    const displayPhase: NeuralPhase = tokensRecent && velocityRef.current > 0 ? 'streaming' : agentPhase

    setNeuralState(prev => {
      const next: NeuralState = {
        phase: displayPhase,
        provider,
        activeToolCount,
        tokenVelocity: Math.round(velocityRef.current * 10) / 10,
        errorLevel,
        completedAt: completedAtRef.current,
      }
      // Avoid re-render if nothing meaningful changed
      if (
        prev.phase === next.phase &&
        prev.provider === next.provider &&
        prev.activeToolCount === next.activeToolCount &&
        Math.abs(prev.tokenVelocity - next.tokenVelocity) < 0.5 &&
        prev.errorLevel === next.errorLevel &&
        prev.completedAt === next.completedAt
      ) {
        return prev
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forgeOpsState.events, provider])

  // The display phase is otherwise only recomputed when an event arrives. If the mission finishes while
  // tokens are still fresh, 'streaming' would stay on screen forever, so re-evaluate when the window ends.
  const streaming = neuralState.phase === 'streaming'
  useEffect(() => {
    if (!streaming) return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      const remaining = Math.max(0, STREAMING_WINDOW_MS - (Date.now() - lastTokenTimeRef.current)) + 50
      timer = setTimeout(() => {
        // Tokens may still be flowing (content growth is tracked on render): keep watching until they stop.
        if (Date.now() - lastTokenTimeRef.current < STREAMING_WINDOW_MS) { arm(); return }
        velocityRef.current = 0
        setNeuralState(prev => (prev.phase === 'streaming'
          ? { ...prev, phase: agentPhaseRef.current, tokenVelocity: 0 }
          : prev))
      }, remaining)
    }
    arm()
    return () => clearTimeout(timer)
  }, [streaming])

  return neuralState
}

export default useNeuralState
