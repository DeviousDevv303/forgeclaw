import { useReducer, useCallback } from 'react'
import { AGENT_CONFIDENCE_THRESHOLD, MAX_AGENT_ITERATIONS } from '../lib/agentCore'
import {
  INITIAL_FORGE_STATE,
  phaseToStage,
} from '../types/forgeOps'
import type { AgentEvent, ForgeOpsState } from '../types/forgeOps'

// Distribute Omit over each variant of the union so discriminated narrowing works
type AgentEventInput = {
  [K in AgentEvent['type']]: Omit<Extract<AgentEvent, { type: K }>, 'timestamp'>
}[AgentEvent['type']]

const MAX_EVENTS = 60

function calcRisk(state: ForgeOpsState): ForgeOpsState['riskLevel'] {
  if (state.retryCount >= 3 || state.confidence < 0.55) return 'HIGH'
  if (state.retryCount >= 1 || state.confidence < AGENT_CONFIDENCE_THRESHOLD) return 'MEDIUM'
  return 'LOW'
}

function reducer(state: ForgeOpsState, event: AgentEvent): ForgeOpsState {
  const events = [...state.events, event].slice(-MAX_EVENTS)

  switch (event.type) {
    case 'RESET':
      return { ...INITIAL_FORGE_STATE, events }

    case 'OBJECTIVE_RECEIVED':
      return { ...INITIAL_FORGE_STATE, objective: event.objective, stage: 'RAW_ORE', events, integrityFrozen: false, guardianOverrideNeeded: false, guardianWarning: null, threadCount: 0 }

    case 'PHASE_CHANGE': {
      const stage = phaseToStage(event.phase)
      const next: ForgeOpsState = { ...state, phase: event.phase, stage, events }
      return { ...next, riskLevel: calcRisk(next) }
    }

    case 'TOOL_START': {
      const toolBus = { ...state.toolBus, [event.tool]: 'active' as const }
      const iterCurrent = Math.max(state.iterCurrent, event.iter)
      return { ...state, toolBus, iterCurrent, stage: 'HAMMERING', events }
    }

    case 'TOOL_SUCCESS': {
      const toolBus = { ...state.toolBus, [event.tool]: 'idle' as const }
      // Confidence creeps up on success, capped at 0.97
      const confidence = Math.min(0.97, state.confidence + 0.02)
      const next: ForgeOpsState = { ...state, toolBus, confidence, events }
      return { ...next, riskLevel: calcRisk(next) }
    }

    case 'TOOL_FAILURE': {
      const toolBus = { ...state.toolBus, [event.tool]: 'error' as const }
      const confidence = Math.max(0.30, state.confidence - 0.08)
      const base: ForgeOpsState = { ...state, toolBus, confidence, events }
      const withRisk: ForgeOpsState = { ...base, riskLevel: calcRisk(base) }
      if (confidence < 0.60) {
        return { ...withRisk, integrityFrozen: true, guardianWarning: 'Coherence below threshold — thread allocation frozen' }
      }
      return withRisk
    }

    case 'RETRY_DECISION': {
      const retryCount = event.shouldRetry ? state.retryCount + 1 : state.retryCount
      const stage = event.shouldRetry ? 'REFORGING' : state.stage
      const base: ForgeOpsState = { ...state, retryCount, stage, events }
      const withRisk: ForgeOpsState = { ...base, riskLevel: calcRisk(base) }
      if (retryCount >= 3) {
        return { ...withRisk, guardianOverrideNeeded: true, guardianWarning: 'Reoptimization gate exceeded — Guardian override required' }
      }
      return withRisk
    }

    case 'PATHS_COLLAPSED': {
      const collapsedPaths: import('../types/forgeOps').AlternatePath[] = [
        { label: event.chosen, probability: 100, status: 'active' },
        ...event.discarded.map(d => ({ label: d.label, probability: d.probability, status: 'discarded' as const }))
          .sort((a, b) => b.probability - a.probability),
      ]
      return { ...state, collapsedPaths, events }
    }

    case 'CONFIDENCE_UPDATE': {
      const next: ForgeOpsState = { ...state, confidence: event.value, events }
      return { ...next, riskLevel: calcRisk(next) }
    }

    case 'CHECKPOINT':
      return { ...state, iterCurrent: event.iter, iterTotal: event.total, events }

    case 'MISSION_COMPLETE':
      return { ...state, stage: 'COMPLETE', phase: 'COMPLETE', events }

    case 'MISSION_BLOCKED':
      return { ...state, stage: 'BLOCKED', phase: 'BLOCKED', events }

    case 'GUARDIAN_WARNING':
      return { ...state, guardianWarning: event.reason, events }

    case 'THREAD_SPAWN':
      return { ...state, threadCount: state.threadCount + 1, events }

    case 'THREAD_MERGE':
      return { ...state, threadCount: Math.max(0, state.threadCount - 1), events }

    default:
      return { ...state, events }
  }
}

export function useForgeOps() {
  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL_FORGE_STATE,
    iterTotal: MAX_AGENT_ITERATIONS,
  })

  const emit = useCallback((event: AgentEventInput) => {
    dispatch({ ...event, timestamp: Date.now() } as AgentEvent)
  }, [])

  return { state, emit }
}
