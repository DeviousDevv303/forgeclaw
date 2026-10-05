// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// End-to-end bridge for the repository-owned DeepSeek workflow. GitHub workflow
// dispatch returns 204, so the invocation id is used to find the exact run,
// wait for completion, and read the result the runner produced.
//
// Browser-safe result retrieval (mirrors the proven image pipeline):
//   1. raw.githubusercontent.com/<owner>/<repo>/deepseek-results/deepseek-results/<id>.txt
//      — a branch the workflow publishes to. Same-origin-free, plain CORS, no
//        cross-origin redirect chain.
//   2. Fallback: list the run's artifacts, download the artifact ZIP through the
//        shared hardened boundary, and extract result.txt with jszip. Kept for
//        runs produced before the mirror existed.
//
// Every stage is labelled so a failure identifies WHERE the path broke
// (dispatch → discovery → poll → list → download → unzip → extract) instead of
// collapsing into a meaningless browser "Failed to fetch".

import JSZip from 'jszip'
import type { ToolContext } from './forgeTools'
import { isCorrelatedShellRun, type ShellWorkflowRun } from './shellCorrelation'
import {
  describeGithubHttpFailure,
  githubStage,
  toolFetch,
} from './githubFetch'

export const DEEPSEEK_WORKFLOW_ID = 'deepseek-16b.yml'
export const DEEPSEEK_ARTIFACT_PREFIX = 'deepseek-'
export const DEEPSEEK_MIRROR_BRANCH = 'deepseek-results'
export const DEEPSEEK_MIRROR_DIR = 'deepseek-results'
export const DEEPSEEK_MAX_WAIT_MS = 35 * 60 * 1000

const DISCOVERY_TIMEOUT_MS = 30_000
const MIRROR_TIMEOUT_MS = 20_000
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

/** Browser-readable mirror URL for a completed DeepSeek result. */
export function deepseekMirrorUrl(owner: string, repo: string, invocationId: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${DEEPSEEK_MIRROR_BRANCH}/${DEEPSEEK_MIRROR_DIR}/${encodeURIComponent(invocationId)}.txt`
}

async function findRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<DeepSeekWorkflowRun | undefined> {
  const response = await toolFetch(
    ctx,
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${DEEPSEEK_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100`,
    // GitHub caches REST GET responses briefly. Polling the identical URL
    // without cache bypass can replay the pre-dispatch list until discovery
    // times out, even though the workflow has already run.
    { headers: ghHeaders(ctx), cache: 'no-store' },
  )
  if (!response.ok) throw new Error(describeGithubHttpFailure('deepseek-run-discovery', response.status, response.statusText))
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
  if (!run) throw new Error(`deepseek-run-discovery: DeepSeek dispatched but correlated run "${invocationId}" was not found within ${DISCOVERY_TIMEOUT_MS / 1000}s.`)

  const started = Date.now()
  let statusAttempt = 0
  let finalRun = run
  while (Date.now() - started < DEEPSEEK_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('DeepSeek run aborted', 'AbortError')
    const response = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`, { headers: ghHeaders(ctx), cache: 'no-store' })
    if (!response.ok) throw new Error(describeGithubHttpFailure('deepseek-run-poll', response.status, response.statusText))
    finalRun = await response.json() as DeepSeekWorkflowRun
    if (finalRun.status === 'completed') break
    const remaining = DEEPSEEK_MAX_WAIT_MS - (Date.now() - started)
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(statusDelays[Math.min(statusAttempt++, statusDelays.length - 1)], remaining)))
  }
  if (finalRun.status !== 'completed') throw new Error(`deepseek-run-poll: DeepSeek timed out after ${Math.round(DEEPSEEK_MAX_WAIT_MS / 60000)}m. Run #${finalRun.run_number} last status: ${finalRun.status}.`)
  if (finalRun.conclusion !== 'success') throw new Error(`deepseek-run-poll: DeepSeek run #${finalRun.run_number} concluded as "${finalRun.conclusion}". Run: ${finalRun.html_url}`)
  return finalRun
}

/**
 * Preferred path: read the plain-text mirror the workflow publishes to a branch.
 * Returns undefined when the mirror is absent (older runs, or a run that failed
 * before publishing) so the caller can fall back to the artifact.
 */
export async function readDeepSeekMirror(ctx: ToolContext, owner: string, repo: string, invocationId: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS)
  const onParentAbort = () => controller.abort()
  ctx.signal?.addEventListener('abort', onParentAbort, { once: true })
  try {
    const response = await fetch(deepseekMirrorUrl(owner, repo, invocationId), {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const text = (await response.text()).trim()
    return text || undefined
  } catch {
    // No mirror yet (or blocked) — the artifact bridge below is the fallback.
    return undefined
  } finally {
    clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', onParentAbort)
  }
}

/** Fallback path: list the run's artifacts and extract result.txt from the ZIP. */
export async function downloadDeepSeekArtifact(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<string> {
  const artifactsRes = await githubStage('deepseek-artifact-list', () => toolFetch(
    ctx,
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))

  if (!artifactsRes.ok) {
    throw new Error(describeGithubHttpFailure('deepseek-artifact-list', artifactsRes.status, artifactsRes.statusText))
  }

  const data = await artifactsRes.json() as { artifacts?: ArtifactInfo[] }
  const artifact = data.artifacts?.find(item => item.name === `${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}` && !item.expired)
  if (!artifact) throw new Error(`deepseek-artifact-list: artifact "${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`)

  const zipResponse = await githubStage('deepseek-artifact-download', () => toolFetch(
    ctx,
    artifact.archive_download_url,
    { headers: ghHeaders(ctx), signal: ctx.signal, redirect: 'follow' },
  ))
  if (!zipResponse.ok) {
    throw new Error(describeGithubHttpFailure('deepseek-artifact-download', zipResponse.status, zipResponse.statusText))
  }

  const zipBytes = await githubStage('deepseek-artifact-download', () => zipResponse.arrayBuffer())
  const zip = await githubStage('deepseek-artifact-unzip', () => JSZip.loadAsync(zipBytes))
  const result = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result.txt')
  if (!result) throw new Error(`deepseek-artifact-unzip: artifact "${artifact.name}" did not contain result.txt.`)
  const text = (await githubStage('deepseek-result-extract', () => result.async('text'))).trim()
  if (!text) throw new Error(`deepseek-result-extract: run #${runId} completed without a non-empty result.`)
  return text
}

/** Resolve the real DeepSeek result for a correlated run, with stage-labelled failures. */
export async function downloadDeepSeekResult(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<string> {
  const mirrored = await readDeepSeekMirror(ctx, owner, repo, invocationId)
  if (mirrored) return mirrored
  return downloadDeepSeekArtifact(ctx, owner, repo, runId, invocationId)
}

export async function waitForDeepSeekResult(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<{ run: DeepSeekWorkflowRun; result: string }> {
  const run = await waitForDeepSeekRun(ctx, owner, repo, invocationId, dispatchedAt)
  return { run, result: await downloadDeepSeekResult(ctx, owner, repo, run.id, invocationId) }
}