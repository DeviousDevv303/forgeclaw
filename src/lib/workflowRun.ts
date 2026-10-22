// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Dispatch a workflow and wait for its correlated run ─────────────────────
// workflow_dispatch returns no run ID. Each workflow puts the caller's invocation ID in its run-name,
// and the run is found by that (isCorrelatedShellRun), then polled until it completes.

import { isCorrelatedShellRun, type ShellWorkflowRun } from './shellCorrelation'
import type { GithubRequest } from './githubPublish'

export interface DispatchAndWaitInput {
  owner: string
  repo: string
  token: string
  workflow: string
  inputs: Record<string, string>
  invocationId: string
  maxWaitMs: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export function newInvocationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function okJson<T>(request: GithubRequest, url: string, step: string, init?: RequestInit): Promise<T> {
  const res = await request(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`${step} failed: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}`)
  }
  return await res.json() as T
}

export interface WaitForRunInput {
  owner: string
  repo: string
  token: string
  workflow: string
  /** Text the run-name contains for this dispatch (an invocation ID or a unique branch). */
  needle: string
  /** When the dispatch was sent; older runs are never matched. */
  since: number
  maxWaitMs: number
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Network drops, timeouts, rate limits and GitHub 5xx: worth another read. 401/403/404 are not. */
const TRANSIENT_READ_ERROR = /failed to fetch|network|load failed|timed out|GitHub (?:408|429|5\d\d)\b/i

/** Finds the run a dispatch created and polls it until it completes (any conclusion). */
export async function waitForCorrelatedRun(request: GithubRequest, input: WaitForRunInput): Promise<ShellWorkflowRun> {
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  let run: ShellWorkflowRun | undefined
  let lastReadError: string | undefined
  // The dispatch already happened, so one dropped or 5xx read must not abandon the run: keep going until the deadline.
  // The deadline is checked after each read, so there is always one last look (a run first listed at the deadline
  // used to be reported as never appearing). A refused credential or missing workflow still fails at once.
  for (;;) {
    if (input.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    try {
      if (!run) {
        const list = await okJson<{ workflow_runs?: ShellWorkflowRun[] }>(request, `${base}/actions/workflows/${input.workflow}/runs?event=workflow_dispatch&per_page=20`, `finding the ${input.workflow} run`, { headers, cache: 'no-store' })
        run = list.workflow_runs?.find(r => isCorrelatedShellRun(r, input.needle, input.since, now()))
      } else {
        run = await okJson<ShellWorkflowRun>(request, `${base}/actions/runs/${run.id}`, `polling the ${input.workflow} run`, { headers, cache: 'no-store' })
      }
      lastReadError = undefined
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (!TRANSIENT_READ_ERROR.test(message)) throw error
      lastReadError = message
    }
    if (run?.status === 'completed') return run
    if (now() - input.since >= input.maxWaitMs) break
    await sleep(run ? 10_000 : 3_000)
  }
  const minutes = Math.round(input.maxWaitMs / 60000)
  const lastError = lastReadError ? ` (last read error: ${lastReadError})` : ''
  if (!run) throw new Error(`${input.workflow} was dispatched as ${input.needle} but its run did not appear within ${minutes} minutes${lastError}`)
  throw new Error(`${input.workflow} run #${run.run_number} did not finish within ${minutes} minutes: ${run.html_url}${lastError}`)
}

/** The open pull request whose head is `branch`, if any. */
export async function findPullRequest(request: GithubRequest, owner: string, repo: string, token: string, branch: string): Promise<{ number: number; html_url: string } | undefined> {
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
  const list = await okJson<Array<{ number: number; html_url: string }>>(request, `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=1`, 'finding the pull request', { headers, cache: 'no-store' })
  return list[0]
}

/** Resolves with the completed run (any conclusion); throws if it cannot be dispatched, found or finished in time. */
export async function dispatchAndWait(request: GithubRequest, input: DispatchAndWaitInput): Promise<ShellWorkflowRun> {
  const now = input.now ?? Date.now
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const since = now()
  const dispatch = await request(`${base}/actions/workflows/${input.workflow}/dispatches`, {
    method: 'POST', headers, body: JSON.stringify({ ref: 'main', inputs: input.inputs }),
  })
  if (!dispatch.ok) {
    const body = await dispatch.json().catch(() => ({})) as { message?: string }
    throw new Error(`dispatching ${input.workflow} failed: GitHub ${dispatch.status}${body.message ? ` ${body.message}` : ''} (the token needs Actions: write on ${input.owner}/${input.repo})`)
  }
  return waitForCorrelatedRun(request, { ...input, needle: input.invocationId, since })
}
