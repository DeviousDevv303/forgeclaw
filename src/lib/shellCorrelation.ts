// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission.

export interface ShellWorkflowRun {
  id: number
  name?: string
  display_title?: string
  event?: string
  status: string
  conclusion: string | null
  created_at: string
  head_branch?: string
  html_url: string
  run_number: number
}

/**
 * Match only the run created by this dispatch. The workflow's run-name is the
 * durable correlation field because workflow_dispatch itself returns HTTP 204.
 */
export function isCorrelatedShellRun(
  run: ShellWorkflowRun,
  invocationId: string,
  dispatchedAt: number,
  now = Date.now(),
): boolean {
  if (!Number.isInteger(run.id) || run.id <= 0) return false
  if (run.event !== undefined && run.event !== 'workflow_dispatch') return false
  if (run.head_branch !== undefined && run.head_branch !== 'main') return false
  if (run.display_title !== `Shell exec ${invocationId}`) return false

  const createdAt = Date.parse(run.created_at)
  if (Number.isNaN(createdAt)) return false
  // Allow GitHub's dispatch/indexing delay and modest clock skew, but never
  // accept an old run or a run that claims to be from the future.
  return createdAt >= dispatchedAt - 60_000 && createdAt <= now + 60_000
}

export interface ParsedShellOutput {
  commandOutput: string
  exitCode: number
}

export function parseShellExecutionLog(
  rawLogs: string,
  conclusion: string | null,
): ParsedShellOutput {
  const marker = '=== FORGECLAW EXECUTION ==='
  const markerIndex = rawLogs.indexOf(marker)
  const executionLog = (markerIndex >= 0 ? rawLogs.slice(markerIndex) : rawLogs)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .split('\n')
    .map(line => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z\s+/, ''))
    .join('\n')
    .trim()

  const exitMatch = executionLog.match(/(?:^|\n)exit_code=(\d+)/)
  const exitCode = exitMatch ? Number(exitMatch[1]) : (conclusion === 'success' ? 0 : 1)
  const outputStart = executionLog.indexOf('\nstart=')
  const outputAfterStart = outputStart >= 0 ? executionLog.slice(outputStart + 1) : executionLog
  const exitIndex = outputAfterStart.search(/\nexit_code=\d+/)
  const commandOutput = (exitIndex >= 0 ? outputAfterStart.slice(0, exitIndex) : outputAfterStart)
    .replace(/^start=[^\n]*\n?/, '')
    .replace(/\n?end=[^\n]*$/, '')
    .trim()

  return { commandOutput, exitCode }
}
