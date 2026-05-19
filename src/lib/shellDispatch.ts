// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export interface ShellResult {
  success: boolean
  output: string
  runId?: number
  conclusion?: string
}

interface WorkflowRun {
  id: number
  status: string
  conclusion: string | null
  created_at: string
}

interface WorkflowJob {
  id: number
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function findRunId(
  dispatchedAt: number,
  token: string,
  owner: string,
  repo: string,
): Promise<number | null> {
  // Poll up to 30s for the run to appear (GitHub has ~2–5s dispatch lag)
  for (let i = 0; i < 10; i++) {
    await sleep(3000)
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/forge-shell.yml/runs?per_page=5`,
      { headers: ghHeaders(token) },
    )
    if (!res.ok) continue
    const data = await res.json() as { workflow_runs: WorkflowRun[] }
    const run = data.workflow_runs.find(
      r => new Date(r.created_at).getTime() >= dispatchedAt - 10_000,
    )
    if (run) return run.id
  }
  return null
}

async function pollCompletion(
  runId: number,
  token: string,
  owner: string,
  repo: string,
): Promise<WorkflowRun> {
  // Poll every 10s, max 30 iterations (5 minutes)
  for (let i = 0; i < 30; i++) {
    await sleep(10_000)
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
      { headers: ghHeaders(token) },
    )
    if (!res.ok) continue
    const run = await res.json() as WorkflowRun
    if (run.status === 'completed') return run
  }
  throw new Error('Workflow exceeded 5-minute polling limit')
}

async function fetchJobLogs(
  runId: number,
  token: string,
  owner: string,
  repo: string,
): Promise<string> {
  const jobsRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
    { headers: ghHeaders(token) },
  )
  if (!jobsRes.ok) return '[logs unavailable]'
  const jobsData = await jobsRes.json() as { jobs: WorkflowJob[] }
  if (jobsData.jobs.length === 0) return '[no jobs found]'

  const jobId = jobsData.jobs[0].id
  // GitHub returns a 302 to a pre-signed URL — the URL carries its own auth so
  // the Authorization header being stripped on cross-origin redirect is fine.
  const logRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
    { headers: ghHeaders(token) },
  )
  if (!logRes.ok) return `[log fetch failed: ${logRes.status}]`

  const raw = await logRes.text()
  return parseOutput(raw)
}

function parseOutput(raw: string): string {
  // Strip GitHub timestamp prefixes: "2026-05-18T10:00:00.0000000Z  "
  const lines = raw.split('\n').map(l =>
    l.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s{2}/, ''),
  )
  // Extract content after our separator line
  const markerIdx = lines.findIndex(l => l.includes('==========================='))
  const output = markerIdx >= 0
    ? lines.slice(markerIdx + 1).join('\n').trim()
    : lines.join('\n').trim()
  return output.slice(0, 6000)
}

export async function dispatchShellCommand(
  command: string,
  sessionId: string,
  token: string,
  owner: string,
  repo: string,
): Promise<ShellResult> {
  if (!token) {
    return { success: false, output: '[SHELL_EXEC ERROR] No GitHub token configured — add gh_token in Settings.' }
  }

  const dispatchedAt = Date.now()

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/forge-shell.yml/dispatches`,
    {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { command, session_id: sessionId } }),
    },
  )

  if (!dispatchRes.ok) {
    const err = await dispatchRes.json().catch(() => ({})) as { message?: string }
    return { success: false, output: `[DISPATCH FAILED ${dispatchRes.status}] ${err.message ?? 'unknown error'}` }
  }

  const runId = await findRunId(dispatchedAt, token, owner, repo)
  if (!runId) {
    return { success: false, output: '[RUN NOT FOUND] Dispatch sent but run did not appear within 30s. Check GitHub Actions for the forge-shell workflow.' }
  }

  let completedRun: WorkflowRun
  try {
    completedRun = await pollCompletion(runId, token, owner, repo)
  } catch (e) {
    return {
      success: false,
      output: `[TIMEOUT] ${e instanceof Error ? e.message : String(e)}`,
      runId,
    }
  }

  const output = await fetchJobLogs(completedRun.id, token, owner, repo)

  return {
    success: completedRun.conclusion === 'success',
    output,
    runId: completedRun.id,
    conclusion: completedRun.conclusion ?? 'unknown',
  }
}
