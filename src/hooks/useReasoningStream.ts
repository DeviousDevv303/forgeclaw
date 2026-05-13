import { useState, useCallback, useRef } from 'react'
import type { ReasoningStep, ReasoningChain, ReasoningPhase, PhaseTransition } from '../types/reasoning'

export function useReasoningStream() {
  const [chains, setChains] = useState<ReasoningChain[]>([])
  const [activePhase, setActivePhase] = useState<ReasoningPhase | null>(null)
  const [phaseHistory, setPhaseHistory] = useState<PhaseTransition[]>([])
  const chainCounter = useRef(0)
  const stepCounter = useRef(0)

  const startChain = useCallback((rootLabel: string): string => {
    chainCounter.current += 1
    const id = `chain-${Date.now()}-${chainCounter.current}`
    const newChain: ReasoningChain = {
      id,
      rootLabel,
      steps: [],
      startedAt: new Date().toISOString(),
    }
    setChains(prev => [...prev, newChain])
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
    setChains(prev =>
      prev.map(chain =>
        chain.id === chainId
          ? { ...chain, steps: [...chain.steps, fullStep] }
          : chain
      )
    )
    return stepId
  }, [])

  const updateStep = useCallback((chainId: string, stepId: string, updates: Partial<ReasoningStep>) => {
    setChains(prev =>
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
    setChains(prev =>
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
    setChains([])
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
