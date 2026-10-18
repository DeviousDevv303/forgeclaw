// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNeuralState, mapAgentPhase, IDLE_NEURAL_STATE } from './useNeuralState'
import { INITIAL_FORGE_STATE } from '../types/forgeOps'
import type { AgentEvent, ForgeOpsState } from '../types/forgeOps'

// Mock the learning pipeline — observe calls, don't touch storage
const recorded: unknown[] = []
vi.mock('../lib/learningEvents', () => ({
  recordLearningEvent: vi.fn((event: unknown) => {
    recorded.push(event)
    return Promise.resolve(true)
  }),
}))

function stateWithEvents(events: AgentEvent[]): ForgeOpsState {
  return { ...INITIAL_FORGE_STATE, events }
}

function evt(partial: Record<string, unknown>): AgentEvent {
  return { timestamp: Date.now(), ...partial } as AgentEvent
}

describe('mapAgentPhase', () => {
  it('maps known phases', () => {
    expect(mapAgentPhase('PLAN')).toBe('planning')
    expect(mapAgentPhase('EXECUTION')).toBe('executing')
    expect(mapAgentPhase('VERIFICATION')).toBe('verifying')
    expect(mapAgentPhase('BLOCKED')).toBe('blocked')
    expect(mapAgentPhase('COMPLETE')).toBe('idle')
  })

  it('defaults unknown phases to idle', () => {
    expect(mapAgentPhase('WHATEVER')).toBe('idle')
  })
})

describe('useNeuralState', () => {
  beforeEach(() => {
    recorded.length = 0
    vi.clearAllMocks()
  })

  it('starts idle', () => {
    const { result } = renderHook(() =>
      useNeuralState(stateWithEvents([]), 'corpus', { contentLength: 0 }),
    )
    expect(result.current.phase).toBe('idle')
    expect(result.current.provider).toBe('corpus')
    expect(result.current.activeToolCount).toBe(0)
    expect(result.current.errorLevel).toBe(0)
  })

  it('transitions planning -> executing -> verifying on PHASE_CHANGE', () => {
    const { result, rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({ events: [evt({ type: 'PHASE_CHANGE', phase: 'PLAN' })] })
    })
    expect(result.current.phase).toBe('planning')

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'PLAN' }),
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
        ],
      })
    })
    expect(result.current.phase).toBe('executing')

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'PLAN' }),
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'PHASE_CHANGE', phase: 'VERIFICATION' }),
        ],
      })
    })
    expect(result.current.phase).toBe('verifying')
  })

  it('enters blocked on MISSION_BLOCKED and clears on next phase', () => {
    const { result, rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'MISSION_BLOCKED', reason: 'stuck' }),
        ],
      })
    })
    expect(result.current.phase).toBe('blocked')

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'MISSION_BLOCKED', reason: 'stuck' }),
          evt({ type: 'PHASE_CHANGE', phase: 'PLAN' }),
        ],
      })
    })
    expect(result.current.phase).toBe('planning')
  })

  it('tracks activeToolCount from toolBus and decrements on success', () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: ForgeOpsState }) => useNeuralState(state, 'corpus', { contentLength: 0 }),
      {
        initialProps: {
          state: { ...INITIAL_FORGE_STATE, events: [] as AgentEvent[], toolBus: {} },
        },
      },
    )
    expect(result.current.activeToolCount).toBe(0)

    act(() => {
      rerender({
        state: {
          ...INITIAL_FORGE_STATE,
          events: [evt({ type: 'TOOL_START', tool: 'shell_exec', iter: 0 })],
          toolBus: { shell_exec: 'active' as const },
        },
      })
    })
    expect(result.current.activeToolCount).toBe(1)

    act(() => {
      rerender({
        state: {
          ...INITIAL_FORGE_STATE,
          events: [
            evt({ type: 'TOOL_START', tool: 'shell_exec', iter: 0 }),
            evt({ type: 'TOOL_SUCCESS', tool: 'shell_exec' }),
          ],
          toolBus: { shell_exec: 'idle' as const },
        },
      })
    })
    expect(result.current.activeToolCount).toBe(0)
  })

  it('raises errorLevel on consecutive failures and records learning events', () => {
    // No clock manipulation: failures use their own rate-limit budget and
    // must not be dropped even when they land in the same second.
    const { result, rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    const failure = (tool: string) =>
      evt({ type: 'TOOL_FAILURE', tool, failClass: 'timeout' })

    act(() => {
      rerender({ events: [failure('shell_exec')] })
    })
    expect(result.current.errorLevel).toBe(1)

    // Second consecutive failure → errorLevel 2
    act(() => {
      rerender({ events: [failure('shell_exec'), failure('github_write_file')] })
    })
    expect(result.current.errorLevel).toBe(2)

    // Same-tick failures share the 1/sec budget: only the first is recorded.
    // (Spec-compliant rate limiting; real failures are seconds apart.)
    const failures = recorded.filter(
      (e: unknown) => (e as { outcome: string }).outcome === 'failed',
    )
    expect(failures.length).toBe(1)
    const first = failures[0] as { input: string; result: string }
    expect(first.input).toContain('[TOOL_FAILURE]')

    // Success steps errorLevel back down
    act(() => {
      rerender({
        events: [
          failure('shell_exec'),
          failure('github_write_file'),
          evt({ type: 'TOOL_SUCCESS', tool: 'shell_exec' }),
        ],
      })
    })
    expect(result.current.errorLevel).toBe(1)
  })

  it('records a failure even when it lands in the same second as a phase change', () => {
    // Regression test for the shared-budget bug: phase transitions used to
    // starve failure records because both used the bare 'tool' budget key.
    const { rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'TOOL_FAILURE', tool: 'shell_exec', failClass: 'timeout' }),
        ],
      })
    })

    const failures = recorded.filter(
      (e: unknown) => (e as { outcome: string }).outcome === 'failed',
    )
    expect(failures.length).toBe(1)
    expect((failures[0] as { input: string }).input).toContain('[TOOL_FAILURE]')

    // No [SYSTEM_PHASE] records (removed as redundant; phaseSequence covers it)
    const phases = recorded.filter((e: unknown) =>
      (e as { input: string }).input.startsWith('[SYSTEM_PHASE]'),
    )
    expect(phases.length).toBe(0)
  })

  it('does NOT record per-transition [SYSTEM_PHASE] events (phaseSequence covers it)', () => {
    const { rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'moonshot', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'PLAN' }),
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
        ],
      })
    })

    const phaseEvents = recorded.filter((e: unknown) =>
      (e as { input: string }).input.startsWith('[SYSTEM_PHASE]'),
    )
    expect(phaseEvents.length).toBe(0)
  })

  it('records a latency profile on MISSION_COMPLETE', () => {
    const { rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [
          evt({ type: 'OBJECTIVE_RECEIVED', objective: 'test' }),
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'MISSION_COMPLETE' }),
        ],
      })
    })

    const latency = recorded.filter((e: unknown) =>
      (e as { input: string }).input.startsWith('[LATENCY_PROFILE]'),
    )
    expect(latency.length).toBe(1)
    expect((latency[0] as { result: string }).result).toContain('latencyMs=')
  })

  it('clears blocked on OBJECTIVE_RECEIVED (e.g. after user hits STOP)', () => {
    const { result, rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [evt({ type: 'MISSION_BLOCKED', reason: 'Generation cancelled by user.' })],
      })
    })
    expect(result.current.phase).toBe('blocked')

    // New request starts: blocked clears immediately, not just on PHASE_CHANGE
    act(() => {
      rerender({
        events: [
          evt({ type: 'MISSION_BLOCKED', reason: 'Generation cancelled by user.' }),
          evt({ type: 'OBJECTIVE_RECEIVED', objective: 'new task' }),
        ],
      })
    })
    expect(result.current.phase).toBe('planning')
  })

  it('resets to idle on RESET', () => {
    const { result, rerender } = renderHook(
      ({ events }) => useNeuralState(stateWithEvents(events), 'corpus', { contentLength: 0 }),
      { initialProps: { events: [] as AgentEvent[] } },
    )

    act(() => {
      rerender({
        events: [
          evt({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }),
          evt({ type: 'RESET' }),
        ],
      })
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.errorLevel).toBe(0)
  })

  it('IDLE_NEURAL_STATE matches the interface', () => {
    expect(IDLE_NEURAL_STATE.phase).toBe('idle')
    expect(IDLE_NEURAL_STATE.activeToolCount).toBe(0)
    expect(IDLE_NEURAL_STATE.tokenVelocity).toBe(0)
    expect(IDLE_NEURAL_STATE.errorLevel).toBe(0)
  })
})
