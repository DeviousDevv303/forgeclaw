// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// End-to-end bridge for the repository-owned DeepSeek workflow. GitHub workflow
// dispatch returns 204, so the invocation id is used to find the exact run,
// wait for completion, and read the result.txt artifact produced by the runner.
import JSZip from 'jszip'
import type { ToolContext } from './forgeTools'
import { isCorrelatedShellRun, type ShellWorkflowRun } from './shellCorrelation'

export const DEEPSEEK_WORKFLOW_ID = 'deepseek-16b.yml'
export const DEEPSEEK_ARTIFACT_PREFIX = 'deepseek-'
export const DEEPSEEK_MAX_WAIT_MS = 35 * 60 * 1000
const DISCOVERY_TIMEOUT_MS = 30_000
const discoveryDelays = [100, 250, 500, 1000, 2000] as const
const statusDelays = [1000, 2000, 3000, 5000, 8000] as const

type DeepSeekWorkflowRun = ShellWorkflowRun
interface ArtifactInfo {
  name: string
  archive_download_url: string
  expired: boolean
}

function ghHeaders(ctx: ToolContext): Record<string, string> {
  return { Authorization: `token ${ctx.ghToken}`, Accept: 'application/vnd.github.v3+json' }
}

async function findRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<DeepSeekWorkflowRun | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${DEEPSEEK_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store', signal: ctx.signal },
  )
  if (!response.ok) throw new Error(`GitHub DeepSeek runs list ${response.status}`)
  const data = await response.json() as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
  return data.workflow_runs?.find(run => isCorrelatedShellRun(run, invocationId, dispatchedAt)) as DeepSeekWorkflowRun | undefined
}

export async function waitForDeepSeekRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<DeepSeekWorkflowRun> {
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS
  let run: DeepSeekWorkflowRun | undefined
  let attempt = 0
  while (!run && Date.now() < discoveryDeadline) {
    if (ctx.signal?.aborted) throw new DOMException('DeepSeek run aborted', 'AbortError')
    run = await findRun(ctx, owner, repo, invocationId, dispatchedAt)
    if (run) break
    const remaining = discoveryDeadline - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(discoveryDelays[Math.min(attempt++, discoveryDelays.length - 1)], remaining)))
  }
  if (!run) throw new Error(`DeepSeek dispatched but correlated run "${invocationId}" was not found.`)

  const started = Date.now()
  let statusAttempt = 0
  let finalRun = run
  while (Date.now() - started < DEEPSEEK_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('DeepSeek run aborted', 'AbortError')
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`, { headers: ghHeaders(ctx), cache: 'no-store', signal: ctx.signal })
    if (!response.ok) throw new Error(`GitHub DeepSeek run status ${response.status}`)
    finalRun = await response.json() as DeepSeekWorkflowRun
    if (finalRun.status === 'completed') break
    const remaining = DEEPSEEK_MAX_WAIT_MS - (Date.now() - started)
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(statusDelays[Math.min(statusAttempt++, statusDelays.length - 1)], remaining)))
  }
  if (finalRun.status !== 'completed') throw new Error(`DeepSeek timed out after ${Math.round(DEEPSEEK_MAX_WAIT_MS / 60000)}m. Run #${finalRun.run_number} last status: ${finalRun.status}.`)
  if (finalRun.conclusion !== 'success') throw new Error(`DeepSeek run #${finalRun.run_number} concluded as "${finalRun.conclusion}". Run: ${finalRun.html_url}`)
  return finalRun
}

export async function downloadDeepSeekResult(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`, { headers: ghHeaders(ctx), signal: ctx.signal })
  if (!response.ok) throw new Error(`GitHub DeepSeek artifact list ${response.status}`)
  const data = await response.json() as { artifacts?: ArtifactInfo[] }
  const artifact = data.artifacts?.find(item => item.name === `${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}` && !item.expired)
  if (!artifact) throw new Error(`DeepSeek artifact "${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`)
  const zipResponse = await fetch(artifact.archive_download_url, { headers: ghHeaders(ctx), signal: ctx.signal, redirect: 'follow' })
  if (!zipResponse.ok) throw new Error(`DeepSeek artifact download failed: ${zipResponse.status}.`)
  const zip = await JSZip.loadAsync(await zipResponse.arrayBuffer())
  const result = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result.txt')
  if (!result) throw new Error(`DeepSeek artifact "${artifact.name}" did not contain result.txt.`)
  const text = (await result.async('text')).trim()
  if (!text) throw new Error(`DeepSeek run #${runId} completed without a non-empty result.`)
  return text
}

export async function waitForDeepSeekResult(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<{ run: DeepSeekWorkflowRun; result: string }> {
  const run = await waitForDeepSeekRun(ctx, owner, repo, invocationId, dispatchedAt)
  return { run, result: await downloadDeepSeekResult(ctx, owner, repo, run.id, invocationId) }
}
