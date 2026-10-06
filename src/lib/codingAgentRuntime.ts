// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Coding Agent Runtime ────────────────────────────────────────────────────
// Bridges the agent loop to the real repository. Every value here comes from an
// actual tool execution — nothing is synthesised, and a failure is reported as a
// failure instead of being smoothed over.

import { executeTool, loadToolContext, type ToolDef } from './forgeTools'
import { CANONICAL_IDENTITY, formatCanonicalIdentity, resolveCanonicalRepository } from './canonicalIdentity'
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

export interface RuntimeRequestMetrics {
  systemTokens: number
  userTokens: number
  toolDefinitionTokens: number
  toolResultTokens: number
  totalRequestTokens: number
  modelCalls: number
  toolCalls: number
}

/** Stable, intentionally small estimate used for before/after request telemetry. */
export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

/** Runtime-owned request envelope; never serializes the complete repository/state. */
export function buildRuntimeRequestContext(options?: {
  owner?: string
  repo?: string
  taskStatus?: CodingAgentState['taskStatus']
  requiresRepositoryTool?: boolean
}): string {
  const repository = resolveCanonicalRepository({ owner: options?.owner, repo: options?.repo })
  const lines = [
    formatCanonicalIdentity(),
    `[RUNTIME_STATE repository="${repository.fullRepository}" taskStatus="${options?.taskStatus || 'idle'}"]`,
    'Repository evidence comes from GitHub tools; never infer or preload contents.',
  ]
  if (options?.requiresRepositoryTool) {
    lines.push('For this request, call github_repo_state or another appropriate GitHub read tool before giving repository feedback.')
  }
  lines.push('[/RUNTIME_STATE]')
  return lines.join('\n')
}

export function createEmptyRequestMetrics(): RuntimeRequestMetrics {
  return { systemTokens: 0, userTokens: 0, toolDefinitionTokens: 0, toolResultTokens: 0, totalRequestTokens: 0, modelCalls: 0, toolCalls: 0 }
}

export function measureRequestMetrics(input: {
  systemPrompt: string
  userMessages: string
  toolDefinitions?: unknown
  toolResults?: string
  modelCalls?: number
  toolCalls?: number
}): RuntimeRequestMetrics {
  const systemTokens = estimateTokens(input.systemPrompt)
  const userTokens = estimateTokens(input.userMessages)
  const toolDefinitionTokens = estimateTokens(input.toolDefinitions ? JSON.stringify(input.toolDefinitions) : '')
  const toolResultTokens = estimateTokens(input.toolResults || '')
  return {
    systemTokens,
    userTokens,
    toolDefinitionTokens,
    toolResultTokens,
    totalRequestTokens: systemTokens + userTokens + toolDefinitionTokens + toolResultTokens,
    modelCalls: input.modelCalls || 0,
    toolCalls: input.toolCalls || 0,
  }
}

export { CANONICAL_IDENTITY }

/**
 * A request is treated as a coding task only when it names a code/repo target AND
 * an action. This keeps ordinary conversation from opening repository work.
 */
export function isCodingTaskRequest(prompt: string): boolean {
  const t = prompt.toLowerCase()
  const hasTarget = /\b(repo|repository|codebase|forgeclaw|source|file|files|branch|commit|head|github)\b/.test(t)
  const hasAction = /\b(check|inspect|read|fix|implement|add|change|modify|update|refactor|test|build|lint|commit|push|verify|debug|repair|write|create|feedback)\b/.test(t)
  return hasTarget && hasAction
}

/**
 * Detect an operator-directed Shell operation before generic coding routing.
 * This is intent classification only; execution still goes through executeTool
 * and the existing Guardian gate.
 */
export function isExplicitShellRequest(prompt: string): boolean {
  const text = prompt.trim().toLowerCase()
  if (!text) return false
  if (/\bshell_exec\b|\bshell command\b|\b(?:run|execute)\s+(?:the\s+)?(?:shell|command|bash)\b/.test(text)) return true
  return /^(?:please\s+)?(?:(?:run|execute)\s+(?:the\s+)?|)(?:git|npm|pnpm|yarn|npx|node|python(?:3)?|pwd|ls|cd|cat|head|tail|find|grep|sed|awk|sort|uniq|mkdir|cp|mv|test)\b/.test(text)
}

/**
 * Extract a concrete command from an explicit operator request. This is used
 * only for a small allow-list of familiar CLI entry points; ambiguous prose is
 * left to the normal agent loop, while a bare `pwd` never depends on the model
 * deciding to emit a function call.
 */
export function extractExplicitShellCommand(prompt: string): string | null {
  const text = prompt.trim()
  if (!text) return null

  const inlineCode = text.match(/`([^`\n]+)`/)
  let command = inlineCode?.[1]?.trim() ?? text
  command = command.replace(/^```(?:bash|sh)?\s*/i, '').replace(/\s*```$/, '').trim()
  command = command.replace(/^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?(?:shell\s+command|shell|command|bash)\s*[:：]?\s*/i, '')
  command = command.replace(/^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?/i, '').trim()
  command = command.replace(/^`+|`+$/g, '').trim()

  const executable = /^(git|npm|pnpm|yarn|npx|node|python(?:3)?|pwd|ls|cd|cat|head|tail|find|grep|sed|awk|sort|uniq|mkdir|cp|mv|test)\b/i
  const match = executable.exec(command)
  if (!match) return null
  // Models commonly emit human-style capitalization (for example `Git clone`).
  // Bash command names are case-sensitive; normalize only the executable and
  // preserve arguments, flags, paths, and shell operators exactly as supplied.
  return `${match[1].toLowerCase()}${command.slice(match[1].length)}`
}

/** Select only the existing Shell tool for explicit Shell requests. */
export function selectRequestTools(prompt: string, allTools: ToolDef[], defaultTools: ToolDef[]): ToolDef[] {
  return isExplicitShellRequest(prompt)
    ? allTools.filter(tool => tool.name === 'shell_exec')
    : defaultTools
}

/**
 * A model response is not repository evidence. Only a successful result from an
 * existing GitHub read/verification tool can satisfy a repository task. Errors,
 * Guardian blocks, and text that merely resembles a call are deliberately false.
 */
export function hasSuccessfulRepositoryEvidence(
  results: Array<{ name: string; isError?: boolean }>,
): boolean {
  const evidenceTools = new Set([
    'github_repo_state',
    'github_read_file',
    'github_list_files',
    'github_search_code',
    'github_verify_commit',
  ])
  return results.some(result => evidenceTools.has(result.name) && !result.isError)
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
