// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Coding Agent Runtime ────────────────────────────────────────────────────
// Bridges the agent loop to the real repository. Every value here comes from an
// actual tool execution — nothing is synthesised, and a failure is reported as a
// failure instead of being smoothed over.

import { executeTool, loadToolContext } from './forgeTools'
import {
  loadCodingAgentState,
  saveCodingAgentState,
  appendActivity,
  type CodingAgentState,
} from './codingAgentState'

export interface RepoStateSnapshot {
  owner: string
  repo: string
  branch: string
  defaultBranch: string
  headSha: string
  headShaShort: string
  headSubject: string
  lastPush: string
  raw: string
}

/**
 * A request is treated as a coding task only when it names a code/repo target AND
 * an action. This keeps ordinary conversation from opening repository work.
 */
export function isCodingTaskRequest(prompt: string): boolean {
  const t = prompt.toLowerCase()
  const hasTarget = /\b(repo|repository|codebase|forgeclaw|source|file|files|branch|commit|head|github)\b/.test(t)
  const hasAction = /\b(inspect|read|fix|implement|add|change|modify|update|refactor|test|build|lint|commit|push|verify|debug|repair|write|create)\b/.test(t)
  return hasTarget && hasAction
}

function field(raw: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'im').exec(raw)
  return match ? match[1].trim() : ''
}

/** Parse the human-readable output of the github_repo_state tool. */
export function parseRepoState(raw: string): RepoStateSnapshot {
  const repoField = field(raw, 'repo').replace(/\s+\((?:public|private)\)\s*$/i, '')
  return {
    owner: repoField.split('/')[0] || '',
    repo: repoField.split('/')[1] || '',
    branch: field(raw, 'inspectedBranch'),
    defaultBranch: field(raw, 'defaultBranch'),
    headSha: field(raw, 'HEAD'),
    headShaShort: field(raw, 'HEAD short'),
    headSubject: field(raw, 'HEAD commit'),
    lastPush: field(raw, 'lastPush'),
    raw,
  }
}

/** Read live repository state through the real tool dispatcher. */
export async function readRepoState(options?: {
  owner?: string
  repo?: string
  branch?: string
}): Promise<RepoStateSnapshot> {
  const output = await executeTool(
    { id: `repo_state_${Date.now()}`, name: 'github_repo_state', input: { ...options } },
    loadToolContext(),
  )
  if (output.startsWith('[TOOL ERROR]')) {
    throw new Error(output.replace('[TOOL ERROR]', '').trim())
  }
  return parseRepoState(output)
}

/** Record the start of an assigned coding task against the persisted agent state. */
export async function beginCodingTask(
  task: string,
  instructions: string,
  snapshot: RepoStateSnapshot,
): Promise<CodingAgentState> {
  const previous = loadCodingAgentState()
  return saveCodingAgentState({
    task,
    taskInstructions: instructions,
    taskStatus: 'in_progress',
    owner: snapshot.owner || previous.owner,
    repo: snapshot.repo || previous.repo,
    branch: snapshot.branch || previous.branch,
    headSha: snapshot.headSha,
    headShaShort: snapshot.headShaShort,
    continuationNotes: 'Task opened; inspecting repository before changes.',
    activity: appendActivity(previous, 'coding task assigned', `${snapshot.owner}/${snapshot.repo}@${snapshot.branch} HEAD ${snapshot.headShaShort}`),
  })
}

/**
 * Persist the factual result of one tool call so a reload loses no progress.
 * Only terse state is kept; no reasoning text is stored or rendered.
 */
export function recordToolProgress(name: string, output: string): CodingAgentState {
  const previous = loadCodingAgentState()
  const isError = output.startsWith('[TOOL ERROR]')
  const summary = output.split('\n')[0].slice(0, 220)
  return saveCodingAgentState({
    latestToolResults: [...previous.latestToolResults, { name, summary, at: new Date().toISOString() }],
    errors: isError ? [...previous.errors, `${name}: ${summary}`] : previous.errors,
    activity: appendActivity(previous, name, summary),
  })
}

/** Persist the agent's final verdict for the turn. */
export function recordTaskOutcome(status: CodingAgentState['taskStatus'], note?: string): CodingAgentState {
  const previous = loadCodingAgentState()
  return saveCodingAgentState({
    taskStatus: status,
    continuationNotes: note ?? previous.continuationNotes,
    activity: appendActivity(previous, `task ${status}`, note),
  })
}

/** Persist a verification result (build/lint/test/commit verification). */
export function recordVerification(evidence: string): CodingAgentState {
  const previous = loadCodingAgentState()
  return saveCodingAgentState({
    verificationResults: [...previous.verificationResults, evidence],
    activity: appendActivity(previous, 'verification', evidence),
  })
}

/** Snapshot block injected into the model context and shown to the operator. */
export function formatRepoStateForContext(snapshot: RepoStateSnapshot): string {
  return [
    '[NEXUS_GITHUB_READ_CONTEXT]',
    'Live repository state (read via authenticated GitHub tool, not inferred):',
    `repo: ${snapshot.owner}/${snapshot.repo}`,
    `branch: ${snapshot.branch}`,
    `defaultBranch: ${snapshot.defaultBranch}`,
    `HEAD: ${snapshot.headSha}`,
    `HEAD short: ${snapshot.headShaShort}`,
    `HEAD commit: ${snapshot.headSubject}`,
    `lastPush: ${snapshot.lastPush}`,
    'Treat this as the source of truth for the current commit. Do not invent file contents beyond what tools return.',
    '[/NEXUS_GITHUB_READ_CONTEXT]',
  ].join('\n')
}

export function formatRepoStateFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return [
    '[NEXUS_GITHUB_READ_CONTEXT]',
    `GITHUB READ FAILED: ${message}`,
    'Report this failure. Do not claim repository state that was not read.',
    '[/NEXUS_GITHUB_READ_CONTEXT]',
  ].join('\n')
}
