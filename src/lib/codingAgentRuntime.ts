// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Coding Agent Runtime ────────────────────────────────────────────────────
// Bridges the agent loop to the real repository. Every value here comes from an
// actual tool execution — nothing is synthesised, and a failure is reported as a
// failure instead of being smoothed over.

import { executeTool, loadToolContext, type ToolDef } from './forgeTools'
import { normalizeKnownShellExecutable } from './shellCommand'
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
export function isCodingTaskRequest(prompt: string, options?: { hasAttachment?: boolean }): boolean {
  if (options?.hasAttachment) return false
  const t = prompt.toLowerCase()
  // Website targets and deploy actions: "build me a portfolio site and deploy it to GitHub Pages"
  // previously matched neither list, so it ran as plain chat with no repository tools.
  const hasTarget = /\b(repo|repository|codebase|forgeclaw|source|file|files|branch|commit|head|github|website|site|webpage|landing page|github pages|gh-pages|html|css)\b/.test(t)
  const hasAction = /\b(check|inspect|read|fix|implement|add|change|modify|update|refactor|test|build|lint|commit|push|verify|debug|repair|write|create|feedback|make|deploy|publish|ship|scaffold|launch)\b/.test(t)
  return hasTarget && hasAction
}

/**
 * Detect an operator-directed Shell operation before generic coding routing.
 * This is intent classification only; execution still goes through executeTool
 * and the existing Guardian gate.
 */
export function isExplicitShellRequest(prompt: string): boolean {
  // An explicit prefix (/shell, "$ ", "!cmd") is the operator saying "this is a shell command",
  // whatever the first word is.
  if (forcedShellCommand(prompt) !== null) return true
  const text = stripShellPrefix(prompt).trim().toLowerCase()
  if (!text) {
    return false
  }
  if (/\bshell_exec\b|\bshell command\b|\b(?:run|execute)\s+(?:the\s+)?(?:shell|command|bash)\b/.test(text)) {
    return true
  }
  const command = text.replace(/^(?:please\s+)?(?:(?:run|execute)\s+(?:the\s+)?)?/, '')
  return looksLikeShellCommand(command) || extractExplicitShellCommand(prompt) !== null
}

/**
 * Prefixes that force shell routing: `/shell <cmd>`, `$ <cmd>` (dollar and a space, so "$5 for coffee"
 * is untouched) and `!<cmd>` (bang directly followed by a command-like character). Returns the command
 * text, or null when the prompt has no such prefix.
 */
export function forcedShellCommand(prompt: string): string | null {
  const text = prompt.trim()
  const strong = /^\/shell\s+([\s\S]+)$/i.exec(text) ?? /^\$\s+([\s\S]+)$/.exec(text)
  if (strong?.[1]?.trim()) return strong[1].trim()
  // "!" is also ordinary punctuation ("!important note"), so it only forces shell for a command-like word.
  const bang = /^!(?=[A-Za-z./~])([\s\S]+)$/.exec(text)?.[1]?.trim()
  if (bang && (looksLikeShellCommand(bang) || COMMON_CLI.has(bang.split(/\s+/)[0].toLowerCase()))) return bang
  return null
}

const COMMON_CLI = new Set(['echo', 'wc', 'tree', 'diff', 'which', 'whoami', 'date', 'uname', 'env', 'df', 'du', 'stat', 'file', 'rg', 'jq', 'curl', 'tsc', 'eslint', 'vitest', 'bash', 'sh', 'touch', 'rm', 'tar', 'ps', 'printf', 'tee', 'xargs', 'ls', 'cat', 'pwd', 'git', 'npm', 'node', 'python', 'python3'])

// Words that are also ordinary English. Without shell-looking arguments ("find a good restaurant",
// "test my patience", "git gud") they are conversation, not commands.
const UNAMBIGUOUS_EXECUTABLES = new Set(['pwd', 'ls', 'npm', 'pnpm', 'yarn', 'npx'])
const AMBIGUOUS_EXECUTABLES = new Set(['git', 'node', 'python', 'python3', 'cd', 'cat', 'head', 'tail', 'find', 'grep', 'sed', 'awk', 'sort', 'uniq', 'mkdir', 'cp', 'mv', 'test'])
const GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch', 'checkout', 'switch', 'clone', 'fetch', 'pull', 'push', 'add', 'commit', 'merge', 'rebase', 'remote', 'stash', 'tag', 'reset', 'restore', 'rev-parse', 'ls-files', 'ls-remote', 'blame', 'grep', 'config', 'init', 'cherry-pick', 'revert', 'describe', 'worktree', 'submodule', 'apply'])

/** True when text starts with a known CLI executable AND, for ambiguous words, reads like a command. */
export function looksLikeShellCommand(command: string): boolean {
  const match = /^([A-Za-z][A-Za-z0-9]*)(?:\s+([\s\S]*))?$/.exec(command.trim())
  if (!match) return false
  const executable = match[1].toLowerCase()
  const rest = (match[2] ?? '').trim()
  if (UNAMBIGUOUS_EXECUTABLES.has(executable)) return true
  if (!AMBIGUOUS_EXECUTABLES.has(executable) || !rest) return false
  if (executable === 'git') return rest.startsWith('-') || GIT_SUBCOMMANDS.has(rest.split(/\s+/)[0].toLowerCase())
  if (rest.startsWith('-') || /[|&;<>`]|\$\(/.test(rest) || /(^|\s)["']/.test(rest)) return true
  return rest.split(/\s+/).some(token => /^[.~/]/.test(token) || token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token))
}

/**
 * Extract a concrete command from an explicit operator request. This is used
 * only for a small allow-list of familiar CLI entry points; ambiguous prose is
 * left to the normal agent loop, while a bare `pwd` never depends on the model
 * deciding to emit a function call.
 */
/**
 * Strip common shell-command prefixes (/shell, !, $) so prefixed input
 * routes through the direct shell path instead of falling to the model.
 */
function stripShellPrefix(prompt: string): string {
  return prompt.trim().replace(/^(?:\/shell\s+|!\s*|\$\s*)/i, '').trim()
}

export function extractExplicitShellCommand(prompt: string): string | null {
  const forced = forcedShellCommand(prompt)
  if (forced !== null) {
    const unwrapped = forced.replace(/^```(?:bash|sh)?\s*/i, '').replace(/\s*```$/, '').trim()
    return unwrapped ? normalizeKnownShellExecutable(unwrapped) : null
  }
  const text = stripShellPrefix(prompt)
  if (!text) {
    return null
  }

  const inlineCode = text.match(/`([^`\n]+)`/)
  let command = inlineCode?.[1]?.trim() ?? text
  command = command.replace(/^```(?:bash|sh)?\s*/i, '').replace(/\s*```$/, '').trim()
  command = command.replace(/^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?(?:shell\s+command|shell|command|bash)\s*[:：]?\s*/i, '')
  command = command.replace(/^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?/i, '').trim()
  command = command.replace(/^`+|`+$/g, '').trim()

  return looksLikeShellCommand(command) ? normalizeKnownShellExecutable(command) : null
}

/**
 * Tools the operator can run by typing their name and arguments. They bypass the
 * model entirely and still pass through the Guardian gate inside executeTool, so
 * co-sign rules (gmail_send, send_whatsapp, calendar_create, github_run_workflow,
 * writes to main) are unchanged. Excluded on purpose: run_js, sculpt_self,
 * spawn_agent, http_fetch, deepseek_reason, generate_image, analyze_image and
 * review_code (free-form or multi-line inputs), and shell_exec (own command path).
 */
const DIRECT_TOOLS: Record<string, { required: string[]; usage: string }> = {
  github_write_file: { required: ['path', 'content'], usage: 'github_write_file path="file.txt" content="hello" [branch="name"] [message="why"]' },
  github_read_file: { required: ['path'], usage: 'github_read_file path="file.txt"' },
  github_list_files: { required: [], usage: 'github_list_files [path="dir"]' },
  github_repo_state: { required: [], usage: 'github_repo_state [branch="name"]' },
  github_verify_commit: { required: ['sha'], usage: 'github_verify_commit sha="abc1234" [branch="name"]' },
  github_search_code: { required: ['query'], usage: 'github_search_code query="text"' },
  github_get_run_status: { required: ['run_id'], usage: 'github_get_run_status run_id="123"' },
  github_get_run_logs: { required: ['run_id'], usage: 'github_get_run_logs run_id="123"' },
  github_create_issue: { required: ['title', 'body'], usage: 'github_create_issue title="..." body="..."' },
  github_run_workflow: { required: ['workflow'], usage: 'github_run_workflow workflow="file.yml" [ref="main"]' },
  web_search: { required: ['query'], usage: 'web_search query="text" [count="5"]' },
  memory_write: { required: ['key', 'value'], usage: 'memory_write key="name" value="text"' },
  memory_read: { required: ['key'], usage: 'memory_read key="name"' },
  memory_list: { required: [], usage: 'memory_list' },
  gmail_read: { required: [], usage: 'gmail_read [query="from:x"] [max_results="5"]' },
  gmail_send: { required: ['to', 'subject', 'body'], usage: 'gmail_send to="a@b.com" subject="..." body="..."' },
  calendar_read: { required: [], usage: 'calendar_read [max_results="5"]' },
  calendar_create: { required: ['summary', 'start', 'end'], usage: 'calendar_create summary="..." start="2026-10-15T10:00:00" end="2026-10-15T11:00:00"' },
  send_whatsapp: { required: ['text'], usage: 'send_whatsapp text="..." [to="+1..."]' },
}

const DIRECT_TOOL_NAMES = new Set(Object.keys(DIRECT_TOOLS))

/** Arguments that may legitimately be an empty string; every other required argument must be non-blank. */
const EMPTY_ALLOWED_ARGS = new Set(['content', 'value', 'body'])

function stripToolWrapping(prompt: string): string {
  // Mobile keyboards substitute typographic quotes; normalize them so
  // path="x" never becomes a literal “x” file name.
  // Quote-like characters produced by phone keyboards and IMEs (typographic, guillemets,
  // full-width, CJK corner marks, dingbats). Without this a lookalike closing quote left
  // values truncated as `"check` while the key beside it parsed correctly.
  let text = prompt.trim()
    .replace(/[\u00AB\u00BB\u201C-\u201F\u2033\u2036\u275D\u275E\u301D-\u301F\uFF02]/g, '"')
    .replace(/[\u2018-\u201B\u2032\u2035\u275B\u275C\u02BC\uFF07]/g, "'")
  const fence = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)```$/)
  if (fence) text = fence[1].trim()
  const inline = text.match(/^`([^`\n]+)`$/)
  if (inline) text = inline[1].trim()
  // A stray prompt character before the tool name (". memory_write …", "$ web_search …",
  // "> github_repo_state") used to fail tool detection and fall through to the model,
  // which answered with "cannot determine the task". Strip it; detection still requires
  // a real tool name afterwards.
  text = text.replace(/^(?:[.$>]+\s+)+/, '')
  return text
}

export function isExplicitToolRequest(prompt: string): boolean {
  const text = stripToolWrapping(prompt)
  if (!text) return false
  const match = text.match(/^([a-z_][a-z0-9_]*)(?:\s+|$)/i)
  if (!match) return false
  const isDirect = DIRECT_TOOL_NAMES.has(match[1].toLowerCase())
  return isDirect
}

export interface ExplicitToolCall {
  name: string
  input: Record<string, string>
  /** Set when required arguments are missing; the call must not be executed. */
  error?: string
  /** Non-fatal adjustments the parser made (e.g. an auto-closed quote); shown with the result. */
  notes?: string[]
}

export function extractExplicitToolCall(prompt: string): ExplicitToolCall | null {
  const text = stripToolWrapping(prompt)
  const match = text.match(/^([a-z_][a-z0-9_]*)(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!DIRECT_TOOL_NAMES.has(name)) return null
  const input: Record<string, string> = {}
  const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g
  const malformed: string[] = []
  const notes: string[] = []
  const argText = match[2] ?? ''
  let m; while ((m = argPattern.exec(argText)) !== null) {
    // A value that opens a quote it never closes (e.g. sha="abc with the closing
    // quote lost on a phone keyboard) would otherwise be sent with the quote
    // character inside it and surface as a misleading "not found" from GitHub.
    if (m[4] !== undefined && /^["']/.test(m[4])) {
      // Phone logs show the closing quote of the LAST argument going missing
      // (`query="wind turbine blade erosion`). When nothing follows that could be another
      // key=value pair and the text is plain ASCII, the intent is unambiguous: close the
      // quote at the end of the line and say so. Anything else still fails loudly, so a
      // lookalike quote character or a quote lost mid-command is never guessed at.
      const restStart = m.index + m[0].length - m[4].length + 1
      const rest = argText.slice(restStart).trim()
      const followedByAnotherArg = /\w+\s*=/.test(rest)
      const nonAscii = /[\u0080-\uFFFF]/.test(rest)
      // A trailing , or ; is separator punctuation from how the line was typed, not part of the value.
      const value = rest.replace(/[,;]+$/, '').trimEnd()
      if (value && !followedByAnotherArg && !nonAscii) {
        input[m[1]] = value
        notes.push(`closing quote was missing on ${m[1]}; read it as ${m[1]}="${value}"`)
        break
      }
      malformed.push(m[1])
    }
    input[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  // Operator-typed writes carry an explicit commit intent instead of a generic fallback.
  if (name === 'github_write_file' && !input.message?.trim() && input.path) input.message = `operator direct write: ${input.path}`
  const spec = DIRECT_TOOLS[name]
  if (malformed.length) {
    // Name any non-ASCII characters in the arguments: a closing quote the parser does not
    // recognize is the usual cause, and its codepoint says exactly what to add.
    const odd = [...new Set([...(match[2] ?? '')].filter(ch => ch.charCodeAt(0) > 0x7E))]
      .map(ch => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    const hint = odd.length ? ` Unrecognized non-ASCII characters in the command: ${odd.join(', ')}.` : ''
    return { name, input, error: `[TOOL ERROR] ${name} has an unterminated quote in argument${malformed.length > 1 ? 's' : ''}: ${malformed.join(', ')}.${hint} Nothing was sent. Usage: ${spec.usage}` }
  }
  const missing = spec.required.filter(key => !(key in input) || (!EMPTY_ALLOWED_ARGS.has(key) && !input[key].trim()))
  return missing.length
    ? { name, input, error: `[TOOL ERROR] ${name} is missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Usage: ${spec.usage}` }
    : notes.length ? { name, input, notes } : { name, input }
}

/** True when the user is asking for a repository's authoritative main HEAD. */
export function isRepositoryHeadQuestion(prompt: string): boolean {
  const text = prompt.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text) return false
  return (
    /(?:current|latest|actual|what is|identify|report).{0,48}(?:main|head).{0,48}(?:commit|sha)/.test(text) ||
    /(?:commit|sha).{0,48}(?:on|of|for|in).{0,48}(?:main|head)/.test(text)
  )
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
    'github_pr_info',
    'github_list_prs',
    // A website job may never read a file; its publish commit and Pages build are the evidence.
    'github_publish_site',
    'github_build_site',
    'github_pages_status',
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
