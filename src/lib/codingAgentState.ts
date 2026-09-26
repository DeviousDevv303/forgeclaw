// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Persistent Coding Agent State ───────────────────────────────────────────
// Survives page reload / browser restart via localStorage.
// Used by the coding specialist so tasks resume instead of starting from zero.

import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from './storage'

const STATE_KEY = 'fc_coding_agent_state'
const STATE_VERSION = 1

export interface CodingAgentState {
  version: number
  agentId: string
  agentLabel: string
  updatedAt: string
  owner: string
  repo: string
  branch: string
  headSha: string
  headShaShort: string
  task: string
  taskInstructions: string
  taskStatus: 'idle' | 'in_progress' | 'blocked' | 'complete'
  completedSteps: string[]
  pendingSteps: string[]
  filesModified: string[]
  latestToolResults: Array<{ name: string; summary: string; at: string }>
  verificationResults: string[]
  errors: string[]
  blockers: string[]
  continuationNotes: string
  lastCommitSha: string
  lastCommitMessage: string
}

const DEFAULT_STATE: CodingAgentState = {
  version: STATE_VERSION,
  agentId: 'coding-specialist',
  agentLabel: 'ForgeClaw Coding Specialist',
  updatedAt: new Date(0).toISOString(),
  owner: 'DeviousDevv303',
  repo: 'forgeclaw',
  branch: 'main',
  headSha: '',
  headShaShort: '',
  task: '',
  taskInstructions: '',
  taskStatus: 'idle',
  completedSteps: [],
  pendingSteps: [],
  filesModified: [],
  latestToolResults: [],
  verificationResults: [],
  errors: [],
  blockers: [],
  continuationNotes: '',
  lastCommitSha: '',
  lastCommitMessage: '',
}

export function loadCodingAgentState(): CodingAgentState {
  const raw = safeGetItem(STATE_KEY)
  const parsed = safeJsonParse<Partial<CodingAgentState>>(raw, {})
  return {
    ...DEFAULT_STATE,
    ...parsed,
    version: STATE_VERSION,
    completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
    pendingSteps: Array.isArray(parsed.pendingSteps) ? parsed.pendingSteps : [],
    filesModified: Array.isArray(parsed.filesModified) ? parsed.filesModified : [],
    latestToolResults: Array.isArray(parsed.latestToolResults) ? parsed.latestToolResults : [],
    verificationResults: Array.isArray(parsed.verificationResults) ? parsed.verificationResults : [],
    errors: Array.isArray(parsed.errors) ? parsed.errors : [],
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
  }
}

export function saveCodingAgentState(partial: Partial<CodingAgentState>): CodingAgentState {
  const next: CodingAgentState = {
    ...loadCodingAgentState(),
    ...partial,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
  }
  safeSetItem(STATE_KEY, JSON.stringify(next))
  return next
}

export function clearCodingAgentState(): void {
  safeRemoveItem(STATE_KEY)
}

/** Format state for injection into the model context after reload. */
export function formatCodingAgentStateForContext(state: CodingAgentState): string {
  if (state.taskStatus === 'idle' && !state.task) {
    return '[CODING_AGENT_STATE] No active coding task.[/CODING_AGENT_STATE]'
  }
  return `[CODING_AGENT_STATE]
agent: ${state.agentLabel}
repo: ${state.owner}/${state.repo}
branch: ${state.branch}
HEAD: ${state.headShaShort || state.headSha || '(unknown)'}
taskStatus: ${state.taskStatus}
task: ${state.task}
instructions: ${state.taskInstructions}
completedSteps: ${state.completedSteps.join(' | ') || '(none)'}
pendingSteps: ${state.pendingSteps.join(' | ') || '(none)'}
filesModified: ${state.filesModified.join(', ') || '(none)'}
lastCommit: ${state.lastCommitSha ? `${state.lastCommitSha.slice(0, 7)} — ${state.lastCommitMessage}` : '(none)'}
errors: ${state.errors.join(' | ') || '(none)'}
blockers: ${state.blockers.join(' | ') || '(none)'}
continuation: ${state.continuationNotes || '(none)'}
updatedAt: ${state.updatedAt}
[/CODING_AGENT_STATE]`
}

export const CODING_AGENT_STATE_KEY = STATE_KEY
