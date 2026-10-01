/*
 * ForgeClaw — Shell execution reliability fix for the UI shell.
 *
 * Decisions: correlate every workflow dispatch with an invocation_id instead of
 * assuming the newest run is ours; pass command data through environment
 * variables rather than YAML interpolation; normalize the exact UI command
 * `PWD` to the shell builtin `pwd`; and fetch the execute-job logs so command
 * stdout is returned to Chat instead of a log-download placeholder.
 * Absolute /workspace paths are accepted as aliases for the checked-out repo
 * root for compatibility with prior UI prompts; other absolute paths are
 * rejected.
 *
 * Unfinished/untested: live phone UI execution cannot be run from this sandbox;
 * GitHub workflow execution is validated through static tests and the existing
 * GitHub Actions run evidence.
 */

import type { ToolContext } from './forgeTools'

interface ShellRun {
  id: number
  name?: string
  display_title?: string
  status: string
  conclusion: string | null
  created_at: string
  html_url: string
  run_number: number
}

interface ShellJob { id: number; name: string; conclusion: string | null }

function headers(token: string): Record<string, string> {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
}

function normalizeWorkingDirectory(value: unknown): string | null {
  const raw = String(value || '.').trim().replace(/^\.\//, '')
  if (!raw || raw === '.') return '.'
  if (raw === '/workspace') return '.'
  if (raw.startsWith('/workspace/')) return raw.slice('/workspace/'.length) || '.'
  if (raw.startsWith('/') || raw.split('/').includes('..')) return null
  return raw
}

function normalizeCommand(value: unknown): string {
  const command = String(value ?? '').trim()
  return command === 'PWD' ? 'pwd' : command
}

function parseOutput(raw: string, conclusion: string | null): string {
  const lines = raw.split('\n').map(line => line.replace(/^\d{4}-\d\d-\d\dT[^ ]+\s{2}/, ''))
  const start = lines.findIndex(line => line.includes('=== FORGECLAW EXECUTION ==='))
  const end = lines.findIndex((line, index) => index > start && /^exit_code=/.test(line))
  const body = lines.slice(start >= 0 ? start + 1 : 0, end >= 0 ? end : undefined)
    .filter(line => !/^invocation_id=|^start=|^end=/.test(line))
    .join('\n').trim()
  return body || (conclusion === 'success' ? '(command produced no output)' : '(no command output captured)')
}

function isMatchingRun(run: ShellRun, invocationId: string, dispatchedAt: number): boolean {
  const label = `${run.name ?? ''} ${run.display_title ?? ''}`
  return label.includes(invocationId) && new Date(run.created_at).getTime() >= dispatchedAt - 10_000
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function dispatchShellExecution(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const command = normalizeCommand(input.command)
  if (!command) throw new Error('shell_exec requires a command.')
  if (!ctx.ghToken) throw new Error('No GitHub token configured. Add gh_token in memory or settings.')
  const owner = String(input.owner || ctx.ghOwner)
  const repo = String(input.repo || ctx.ghRepo)
  const workingDirectory = normalizeWorkingDirectory(input.working_directory)
  if (!workingDirectory) throw new Error('shell_exec working_directory must be repository-relative; use "." for repository root.')
  const maxWait = Math.min(Number(input.timeout_seconds || 180) || 180, 600)
  const shouldWait = input.wait !== false
  const invocationId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const api = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/shell-exec.yml`
  const requestHeaders = { ...headers(ctx.ghToken), 'Content-Type': 'application/json' }
  const dispatchedAt = Date.now()

  const dispatch = await fetch(`${api}/dispatches`, {
    method: 'POST', headers: requestHeaders,
    body: JSON.stringify({ ref: 'main', inputs: { command, working_directory: workingDirectory, invocation_id: invocationId } }),
  })
  if (!dispatch.ok) throw new Error(`GitHub dispatch ${dispatch.status}: ${dispatch.statusText}`)

  let run: ShellRun | undefined
  const deadline = Date.now() + 30_000
  while (!run && Date.now() < deadline) {
    const response = await fetch(`${api}/runs?event=workflow_dispatch&per_page=100&cachebust=${Date.now()}`, { headers: requestHeaders, cache: 'no-store' })
    if (!response.ok) throw new Error(`GitHub runs list ${response.status}`)
    const data = await response.json() as { workflow_runs?: ShellRun[] }
    run = (data.workflow_runs ?? []).find(candidate => isMatchingRun(candidate, invocationId, dispatchedAt))
    if (!run) await wait(500)
  }
  if (!run) throw new Error(`Shell execution dispatched but run ${invocationId} was not found.`)
  if (!shouldWait) return `Shell execution dispatched. Run #${run.run_number} (id: ${run.id})\nInvocation: ${invocationId}\nURL: ${run.html_url}`

  const completionDeadline = Date.now() + maxWait * 1000
  while (Date.now() < completionDeadline) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`, { headers: requestHeaders })
    if (!response.ok) throw new Error(`GitHub run status ${response.status}`)
    run = await response.json() as ShellRun
    if (run.status === 'completed') break
    await wait(Math.min(2000, Math.max(100, completionDeadline - Date.now())))
  }
  if (run.status !== 'completed') return `Shell execution timed out after ${maxWait}s. Run #${run.run_number} (id: ${run.id})\nURL: ${run.html_url}`

  const jobsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=20`, { headers: requestHeaders })
  if (!jobsResponse.ok) throw new Error(`GitHub jobs list ${jobsResponse.status}`)
  const jobs = (await jobsResponse.json() as { jobs?: ShellJob[] }).jobs ?? []
  const job = jobs.find(candidate => candidate.name === 'execute') ?? jobs[0]
  if (!job) throw new Error(`Shell execution completed but no execute job was found. Run: ${run.html_url}`)

  const logsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, { headers: requestHeaders })
  if (!logsResponse.ok) throw new Error(`Shell execution logs unavailable (${logsResponse.status}). Run: ${run.html_url}`)
  const output = parseOutput(await logsResponse.text(), run.conclusion)
  return `Shell execution complete.\nCommand: ${command}\nWorking dir: ${workingDirectory}\nConclusion: ${run.conclusion ?? 'unknown'}\nRun: ${run.html_url}\n\n${output}`
}

export const shellExecutionTestables = { normalizeCommand, normalizeWorkingDirectory, parseOutput, isMatchingRun }
