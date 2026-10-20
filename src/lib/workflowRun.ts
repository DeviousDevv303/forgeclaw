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

/** Resolves with the completed run (any conclusion); throws if it cannot be dispatched, found or finished in time. */
export async function dispatchAndWait(request: GithubRequest, input: DispatchAndWaitInput): Promise<ShellWorkflowRun> {
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const dispatchedAt = now()
  const dispatch = await request(`${base}/actions/workflows/${input.workflow}/dispatches`, {
    method: 'POST', headers, body: JSON.stringify({ ref: 'main', inputs: input.inputs }),
  })
  if (!dispatch.ok) {
    const body = await dispatch.json().catch(() => ({})) as { message?: string }
    throw new Error(`dispatching ${input.workflow} failed: GitHub ${dispatch.status}${body.message ? ` ${body.message}` : ''} (the token needs Actions: write on ${input.owner}/${input.repo})`)
  }
  let run: ShellWorkflowRun | undefined
  while (now() - dispatchedAt < input.maxWaitMs) {
    if (input.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    if (!run) {
      const list = await okJson<{ workflow_runs?: ShellWorkflowRun[] }>(request, `${base}/actions/workflows/${input.workflow}/runs?event=workflow_dispatch&per_page=20`, `finding the ${input.workflow} run`, { headers, cache: 'no-store' })
      run = list.workflow_runs?.find(r => isCorrelatedShellRun(r, input.invocationId, dispatchedAt, now()))
    } else {
      run = await okJson<ShellWorkflowRun>(request, `${base}/actions/runs/${run.id}`, `polling the ${input.workflow} run`, { headers, cache: 'no-store' })
      if (run.status === 'completed') return run
    }
    await sleep(run ? 10_000 : 3_000)
  }
  const minutes = Math.round(input.maxWaitMs / 60000)
  if (!run) throw new Error(`${input.workflow} was dispatched as ${input.invocationId} but its run did not appear within ${minutes} minutes`)
  throw new Error(`${input.workflow} run #${run.run_number} did not finish within ${minutes} minutes: ${run.html_url}`)
}
