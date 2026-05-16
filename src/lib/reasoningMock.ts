// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import type { AgentActivityEvent } from '../types/reasoning'

/**
 * Simulates a full 5-phase reasoning stream with nested sub-steps and tool calls.
 * DEV-ONLY: Only use in development or behind explicit debug flag.
 */
export function* simulateReasoningStream(agentId: string = 'forgemind'): Generator<AgentActivityEvent, void, unknown> {
  const now = Date.now()

  // Phase 1: Assumptions
  yield {
    type: 'agent_status',
    agentId,
    status: 'working',
    timestamp: now,
  }

  yield {
    type: 'reasoning_phase',
    agentId,
    phase: 'assumptions',
    body: 'Assuming mobile black screen is caused by:\n1. Canvas rendering above content\n2. Supabase module-level init\n3. Missing API key guard',
    timestamp: now + 100,
  }

  yield {
    type: 'tool_call',
    agentId,
    tool: 'grep',
    args: { pattern: 'createClient', path: 'src/lib/supabase.ts' },
    timestamp: now + 200,
    durationMs: 150,
  }

  // Phase 2: Heuristics
  yield {
    type: 'reasoning_phase',
    agentId,
    phase: 'heuristics',
    body: 'Heuristic: module-level side effects are the #1 cause of pre-mount crashes.\nHeuristic: @import in CSS blocks parsing on mobile.',
    timestamp: now + 500,
  }

  yield {
    type: 'file_read',
    agentId,
    path: 'src/App.tsx',
    timestamp: now + 600,
  }

  // Phase 3: First Principles
  yield {
    type: 'reasoning_phase',
    agentId,
    phase: 'first_principles',
    body: 'First principle: React cannot mount if an error throws before createRoot().\nFirst principle: CSS @import is render-blocking.',
    timestamp: now + 1000,
  }

  yield {
    type: 'tool_call',
    agentId,
    tool: 'edit',
    args: { file: 'src/lib/supabase.ts', action: 'lazy-init' },
    timestamp: now + 1200,
    durationMs: 300,
  }

  // Phase 4: Extension
  yield {
    type: 'reasoning_phase',
    agentId,
    phase: 'extension',
    body: 'Extending fix to all localStorage access points.\nExtending canvas positioning to use absolute inside fixed wrapper.',
    timestamp: now + 1500,
  }

  yield {
    type: 'file_write',
    agentId,
    path: 'src/lib/storage.ts',
    timestamp: now + 1600,
  }

  // Phase 5: Convergence
  yield {
    type: 'reasoning_phase',
    agentId,
    phase: 'convergence',
    body: 'All fixes applied. Build passes. Mobile renders correctly.',
    timestamp: now + 2000,
  }

  yield {
    type: 'agent_status',
    agentId,
    status: 'idle',
    timestamp: now + 2100,
  }
}

/**
 * Collect all events from the generator into an array.
 */
export function collectMockEvents(agentId?: string): AgentActivityEvent[] {
  const events: AgentActivityEvent[] = []
  for (const event of simulateReasoningStream(agentId)) {
    events.push(event)
  }
  return events
}
