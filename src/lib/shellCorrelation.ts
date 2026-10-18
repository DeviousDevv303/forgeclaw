// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission.

export const MAX_SHELL_OUTPUT_CHARS = 6_000
export const SHELL_STALE_RUN_WINDOW_MS = 60 * 60_000
export const SHELL_RUN_LIST_TIMEOUT_MS = 120_000
export const SHELL_LOG_RETRIEVAL_TIMEOUT_MS = 300_000
export const SHELL_LOG_POLL_INTERVAL_MS = 5_000

export type ShellRunResolution = 'pending_run' | 'pending_log' | 'resolved' | 'run_timeout' | 'log_timeout'

export interface ShellWorkflowRun {
  id: number
  name: string
  display_title: string
  event: string
  status: string
  conclusion: string | null
  created_at: string
  head_branch: string
  html_url: string
  run_number: number
  head_sha?: string
}

/**
 * Match only the run created by this dispatch. The workflow's run-name is the
 * durable correlation field because workflow_dispatch itself returns HTTP 204.
 * The input is intentionally partial: GitHub API payloads are untrusted data,
 * so missing required fields must fail closed at runtime.
 */
export function isCorrelatedShellRun(
  run: Partial<ShellWorkflowRun>,
  invocationId: string,
  dispatchedAt: number,
  now = Date.now(),
): boolean {
  return explainShellRunMismatch(run, invocationId, dispatchedAt, now) === null
}

/**
 * Why a listed run was not accepted as this dispatch's run, or null when it is accepted.
 * Single source of truth for isCorrelatedShellRun, so a diagnostic can never disagree with the
 * real decision. Reasons are short and safe to show; GitHub-supplied values are not echoed here.
 */
export function explainShellRunMismatch(
  run: Partial<ShellWorkflowRun>,
  invocationId: string,
  dispatchedAt: number,
  now = Date.now(),
): string | null {
  if (typeof run.id !== 'number' || !Number.isInteger(run.id) || run.id <= 0) return 'run has no valid id'
  if (run.event !== 'workflow_dispatch') return 'event is not workflow_dispatch'
  if (run.head_branch !== 'main') return 'head_branch is not main'
  // Match invocation ID in name or display_title — GitHub may truncate or vary display_title.
  const label = `${run.name ?? ''} ${run.display_title ?? ''}`
  if (!label.includes(invocationId)) return 'run name does not contain the invocation ID'
  if (typeof run.created_at !== 'string' || run.created_at.length === 0) return 'created_at is missing'

  const createdAt = Date.parse(run.created_at)
  if (Number.isNaN(createdAt)) return 'created_at is not a valid time'
  // The invocation ID (timestamp + random suffix) is already unique, so a tight time window adds no
  // safety but can falsely reject the right run when the device clock drifts. Keep only a very wide
  // sanity bound against reusing a stale run from a different session.
  if (createdAt < dispatchedAt - SHELL_STALE_RUN_WINDOW_MS) return `created_at is ${Math.round((dispatchedAt - createdAt) / 1000)}s before dispatch (limit ${SHELL_STALE_RUN_WINDOW_MS / 1000}s)`
  if (createdAt > now + SHELL_STALE_RUN_WINDOW_MS) return `created_at is ${Math.round((createdAt - now) / 1000)}s in this device's future (limit ${SHELL_STALE_RUN_WINDOW_MS / 1000}s)`
  return null
}

/**
 * Classify the two asynchronous gaps independently: a missing correlated run
 * is still pending discovery, while a completed run whose job log is not yet
 * downloadable is pending log retrieval rather than a retrieval failure.
 */
export function resolveShellRun(
  run: ShellWorkflowRun | undefined,
  logAvailable: boolean,
  runDeadline: number,
  logDeadline: number,
  now = Date.now(),
): ShellRunResolution {
  if (!run) return now >= runDeadline ? 'run_timeout' : 'pending_run'
  if (!logAvailable) return now >= logDeadline ? 'log_timeout' : 'pending_log'
  return 'resolved'
}

function normalizePosixPath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** Resolve a repository-relative working directory without escaping checkout root. */
export function resolveShellWorkingDirectory(
  workingDirectory: string,
  workspaceRoot: string,
): string | null {
  if (!workingDirectory || workingDirectory.startsWith('/')) return null
  const workspace = normalizePosixPath(workspaceRoot)
  const candidate = normalizePosixPath(`${workspace}/${workingDirectory}`)
  return candidate === workspace || candidate.startsWith(`${workspace}/`) ? candidate : null
}

/** Map common model/container workspace paths to a repository-relative directory. */
export function normalizeShellWorkingDirectoryInput(
  value: unknown,
  repositoryName: string,
): string | null {
  if (typeof value !== 'string') return null
  const requested = value.trim()
  if (!requested || requested.includes('\0')) return null

  let relative = requested
  const workspaceRepoPrefix = `/workspace/${repositoryName}/`
  if (requested === '/workspace' || requested === `/workspace/${repositoryName}`) relative = '.'
  else if (requested.startsWith(workspaceRepoPrefix)) relative = requested.slice(workspaceRepoPrefix.length)
  else if (requested.startsWith('/workspace/')) relative = requested.slice('/workspace/'.length)

  return resolveShellWorkingDirectory(relative, '/repo') === null ? null : relative
}

export interface ParsedShellOutput {
  commandOutput: string
  exitCode: number
}

export function parseShellExecutionLog(rawLogs: string, conclusion: string | null): ParsedShellOutput {
  const marker = '=== FORGECLAW EXECUTION ==='
  const markerIndex = rawLogs.indexOf(marker)
  // Strip exactly the timestamp separator GitHub used on the marker line, and nothing more, so the
  // command's own leading indentation (JSON, code, tables) survives.
  const separator = rawLogs.match(/\dZ([ \t]*)=== FORGECLAW EXECUTION ===/)?.[1].length ?? 1
  const stampPattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d:.+-]+Z[ \\t]{0,${Math.max(1, separator)}}`)
  const executionLog = (markerIndex >= 0 ? rawLogs.slice(markerIndex) : rawLogs)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .split('\n')
    .map(line => line.replace(stampPattern, ''))
    .join('\n')
    .trim()
  // The workflow prints exit_code=N as its LAST status line, after the command ran. A command can
  // print its own "exit_code=0" line, so use the last match, never the first.
  const exitMatches = [...executionLog.matchAll(/(?:^|\n)exit_code=(\d+)/g)]
  const lastExit = exitMatches.at(-1)
  const exitCode = lastExit ? Number(lastExit[1]) : (conclusion === 'success' ? 0 : 1)
  const outputStart = executionLog.indexOf('\nstart=')
  const outputAfterStart = outputStart >= 0 ? executionLog.slice(outputStart + 1) : executionLog
  const exitIndex = lastExit ? outputAfterStart.lastIndexOf(`\nexit_code=${lastExit[1]}`) : -1
  const commandOutput = (exitIndex >= 0 ? outputAfterStart.slice(0, exitIndex) : outputAfterStart)
    .replace(/^start=[^\n]*\n?/, '')
    .replace(/\n?end=[^\n]*$/, '')
    .trim()
  const overflow = commandOutput.length - MAX_SHELL_OUTPUT_CHARS
  return {
    commandOutput: overflow > 0
      ? `${commandOutput.slice(0, MAX_SHELL_OUTPUT_CHARS)}\n[truncated ${overflow} more characters]`
      : commandOutput,
    exitCode,
  }
}
