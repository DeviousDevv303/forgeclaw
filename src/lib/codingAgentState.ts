// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Persistent Coding Agent State ───────────────────────────────────────────
// Survives page reload / browser restart via localStorage.
// Used by the coding specialist so tasks resume instead of starting from zero.

import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from './storage'
import { FORGECLAW_AGENT_ID, FORGECLAW_AGENT_LABEL } from './githubAttribution'

const STATE_KEY = 'fc_coding_agent_state'
const STATE_VERSION = 2
const MAX_ACTIVITY_ENTRIES = 40
const MAX_TOOL_RESULTS = 12

function stateKey(agentId: string): string {
  return agentId === FORGECLAW_AGENT_ID ? STATE_KEY : `${STATE_KEY}:${agentId}`
}

export type CodingTaskStatus = 'idle' | 'in_progress' | 'blocked' | 'complete'

export interface ToolResultRecord {
  name: string
  summary: string
  at: string
}

export interface ActivityRecord {
  at: string
  label: string
  detail?: string
}

export interface TestRunRecord {
  command: string
  conclusion: string
  url: string
  at: string
}

export interface CodingAgentState {
  version: number
  agentId: string
  agentLabel: string
  updatedAt: string
  sessionId: string
  activeRunId: string
  owner: string
  repo: string
  branch: string
  headSha: string
  headShaShort: string
  task: string
  taskInstructions: string
  taskStatus: CodingTaskStatus
  completedSteps: string[]
  pendingSteps: string[]
  filesModified: string[]
  latestToolResults: ToolResultRecord[]
  verificationResults: string[]
  lastTestRuns: TestRunRecord[]
  activity: ActivityRecord[]
  errors: string[]
  blockers: string[]
  continuationNotes: string
  lastCommitSha: string
  lastCommitMessage: string
}

const DEFAULT_STATE: CodingAgentState = {
  version: STATE_VERSION,
  agentId: FORGECLAW_AGENT_ID,
  agentLabel: FORGECLAW_AGENT_LABEL,
  updatedAt: new Date(0).toISOString(),
  sessionId: '',
  activeRunId: '',
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
  lastTestRuns: [],
  activity: [],
  errors: [],
  blockers: [],
  continuationNotes: '',
  lastCommitSha: '',
  lastCommitMessage: '',
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function loadCodingAgentState(agentId = FORGECLAW_AGENT_ID): CodingAgentState {
  const raw = safeGetItem(stateKey(agentId))
  const parsed = safeJsonParse<Partial<CodingAgentState>>(raw, {})
  return {
    ...DEFAULT_STATE,
    ...parsed,
    agentId: parsed.agentId || agentId,
    agentLabel: parsed.agentLabel || (agentId === FORGECLAW_AGENT_ID ? FORGECLAW_AGENT_LABEL : agentId),
    version: STATE_VERSION,
    completedSteps: asArray<string>(parsed.completedSteps),
    pendingSteps: asArray<string>(parsed.pendingSteps),
    filesModified: asArray<string>(parsed.filesModified),
    latestToolResults: asArray<ToolResultRecord>(parsed.latestToolResults),
    verificationResults: asArray<string>(parsed.verificationResults),
    lastTestRuns: asArray<TestRunRecord>(parsed.lastTestRuns),
    activity: asArray<ActivityRecord>(parsed.activity),
    errors: asArray<string>(parsed.errors),
    blockers: asArray<string>(parsed.blockers),
  }
}

export function saveCodingAgentState(partial: Partial<CodingAgentState>, agentId = partial.agentId || FORGECLAW_AGENT_ID): CodingAgentState {
  const next: CodingAgentState = {
    ...loadCodingAgentState(agentId),
    ...partial,
    agentId,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
  }
  if (next.latestToolResults.length > MAX_TOOL_RESULTS) {
    next.latestToolResults = next.latestToolResults.slice(-MAX_TOOL_RESULTS)
  }
  if (next.activity.length > MAX_ACTIVITY_ENTRIES) {
    next.activity = next.activity.slice(-MAX_ACTIVITY_ENTRIES)
  }
  safeSetItem(stateKey(agentId), JSON.stringify(next))
  return next
}

export function clearCodingAgentState(agentId = FORGECLAW_AGENT_ID): void {
  safeRemoveItem(stateKey(agentId))
}

/**
 * Load the persisted task when one is resumable.
 * Returns null for a fresh/idle/complete agent so a finished task is not replayed.
 */
export function restoreCodingAgentState(agentId = FORGECLAW_AGENT_ID): CodingAgentState | null {
  const state = loadCodingAgentState(agentId)
  const resumable =
    (state.taskStatus === 'in_progress' || state.taskStatus === 'blocked') && Boolean(state.task.trim())
  return resumable ? state : null
}

/** Append a terse progress line. Keeps the UI trail factual instead of narrated. */
export function appendActivity(
  state: CodingAgentState,
  label: string,
  detail?: string,
): ActivityRecord[] {
  return [...state.activity, { at: new Date().toISOString(), label, detail }].slice(-MAX_ACTIVITY_ENTRIES)
}

/** Format state for injection into the model context after reload. */
export function formatCodingAgentStateForContext(state: CodingAgentState): string {
  return compressCodingAgentState(state)
}

export const CODING_AGENT_STATE_KEY = STATE_KEY
export function codingAgentStateKey(agentId = FORGECLAW_AGENT_ID): string {
  return stateKey(agentId)
}


/**
 * Compress coding agent state for context-constrained models.
 * Returns a minimal summary instead of full state.
 */
export function compressCodingAgentState(state: CodingAgentState): string {
  const completed = state.completedSteps.slice(-3)
  const pending = state.pendingSteps.slice(0, 3)
  
  return [
    `Task: ${state.task.slice(0, 100)}`,
    `Status: ${state.taskStatus}`,
    `Branch: ${state.branch}`,
    `HEAD: ${state.headShaShort}`,
    '',
    'Recent:',
    ...completed.map(s => `  ✓ ${s.slice(0, 60)}`),
    '',
    'Next:',
    ...pending.map(s => `  → ${s.slice(0, 60)}`),
    state.blockers.length ? `\nBlockers: ${state.blockers.join('; ').slice(0, 100)}` : '',
  ].filter(Boolean).join('\n')
}
