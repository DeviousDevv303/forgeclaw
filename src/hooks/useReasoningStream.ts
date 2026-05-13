import { useState, useCallback, useRef, useMemo } from 'react'
import type { ReasoningStep, ReasoningChain, ReasoningPhase, PhaseTransition, AgentActivityEvent } from '../types/reasoning'

interface UseReasoningStreamOptions {
  activityEvents?: AgentActivityEvent[]
}

export function useReasoningStream(options: UseReasoningStreamOptions = {}) {
  const [localChains, setLocalChains] = useState<ReasoningChain[]>([])
  const [activePhase, setActivePhase] = useState<ReasoningPhase | null>(null)
  const [phaseHistory, setPhaseHistory] = useState<PhaseTransition[]>([])
  const chainCounter = useRef(0)
  const stepCounter = useRef(0)

  // Derive chains from activity events if provided, else use local state
  const chains = useMemo<ReasoningChain[]>(() => {
    if (!options.activityEvents || options.activityEvents.length === 0) {
      return localChains
    }

    // Map activity events to reasoning chains
    const eventChains: ReasoningChain[] = []
    let currentChain: ReasoningChain | null = null

    for (const event of options.activityEvents) {
      if (event.type === 'reasoning_phase') {
        if (!currentChain) {
          chainCounter.current += 1
          currentChain = {
            id: `chain-${event.timestamp}-${chainCounter.current}`,
            rootLabel: `${event.agentId} reasoning`,
            steps: [],
            startedAt: new Date(event.timestamp).toISOString(),
          }
          eventChains.push(currentChain)
        }

        stepCounter.current += 1
        const step: ReasoningStep = {
          id: `step-${event.timestamp}-${stepCounter.current}`,
          icon: phaseToIcon(event.phase),
          label: event.phase.replace(/_/g, ' '),
          status: 'done',
          timestamp: new Date(event.timestamp).toISOString(),
          body: event.body,
        }
        currentChain.steps.push(step)
      }

      if (event.type === 'agent_status') {
        if (event.status === 'error' && currentChain) {
          currentChain.completedAt = new Date(event.timestamp).toISOString()
          currentChain = null
        }
      }
    }

    return eventChains.length > 0 ? eventChains : localChains
  }, [options.activityEvents, localChains])

  // Local state API (kept for compatibility)
  const startChain = useCallback((rootLabel: string): string => {
    chainCounter.current += 1
    const id = `chain-${Date.now()}-${chainCounter.current}`
    const newChain: ReasoningChain = {
      id,
      rootLabel,
      steps: [],
      startedAt: new Date().toISOString(),
    }
    setLocalChains(prev => [...prev, newChain])
    return id
  }, [])

  const addStep = useCallback((chainId: string, step: Omit<ReasoningStep, 'id' | 'timestamp'>): string => {
    stepCounter.current += 1
    const stepId = `step-${Date.now()}-${stepCounter.current}`
    const fullStep: ReasoningStep = {
      ...step,
      id: stepId,
      timestamp: new Date().toISOString(),
    }
    setLocalChains(prev =>
      prev.map(chain =>
        chain.id === chainId
          ? { ...chain, steps: [...chain.steps, fullStep] }
          : chain
      )
    )
    return stepId
  }, [])

  const updateStep = useCallback((chainId: string, stepId: string, updates: Partial<ReasoningStep>) => {
    setLocalChains(prev =>
      prev.map(chain =>
        chain.id === chainId
          ? {
              ...chain,
              steps: chain.steps.map(step =>
                step.id === stepId ? { ...step, ...updates } : step
              ),
            }
          : chain
      )
    )
  }, [])

  const completeChain = useCallback((chainId: string) => {
    setLocalChains(prev =>
      prev.map(chain =>
        chain.id === chainId
          ? { ...chain, completedAt: new Date().toISOString() }
          : chain
      )
    )
  }, [])

  const transitionPhase = useCallback((to: ReasoningPhase, trigger: string) => {
    setActivePhase(prev => {
      const transition: PhaseTransition = {
        from: prev,
        to,
        timestamp: new Date().toISOString(),
        trigger,
      }
      setPhaseHistory(h => [...h, transition])
      return to
    })
  }, [])

  const getActiveChain = useCallback((): ReasoningChain | undefined => {
    return chains.find(c => !c.completedAt)
  }, [chains])

  const clearChains = useCallback(() => {
    setLocalChains([])
    setPhaseHistory([])
    setActivePhase(null)
  }, [])

  return {
    chains,
    activePhase,
    phaseHistory,
    startChain,
    addStep,
    updateStep,
    completeChain,
    transitionPhase,
    getActiveChain,
    clearChains,
  }
}

function phaseToIcon(phase: ReasoningPhase): ReasoningStep['icon'] {
  switch (phase) {
    case 'assumptions': return '💡'
    case 'heuristics': return '🔧'
    case 'first_principles': return '🧪'
    case 'extension': return '📝'
    case 'convergence': return '✅'
    default: return '🔍'
  }
}
