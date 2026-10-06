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

const DISCOVERY_TIMEOUT_MS = 120_000
const MIRROR_TIMEOUT_MS = 20_000
export const DEEPSEEK_GITHUB_READ_TIMEOUT_MS = 30_000
const discoveryDelays = [100, 250, 500, 1000, 2000] as const
const statusDelays = [30000, 45000, 60000, 60000, 60000] as const

type DeepSeekWorkflowRun = ShellWorkflowRun
interface ArtifactInfo {
  name: string
  archive_download_url: string
  expired: boolean
}

export interface DeepSeekResultDelivery {
  result: string
  source: 'mirror' | 'artifact'
  model?: string
  role?: string
  elapsedSeconds?: string
}

function parseResultMetadata(text: string): Pick<DeepSeekResultDelivery, 'model' | 'role' | 'elapsedSeconds'> {
  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key && value) fields.set(key, value)
  }
  return {
    ...(fields.get('model') ? { model: fields.get('model') } : {}),
    ...(fields.get('role') ? { role: fields.get('role') } : {}),
    ...(fields.get('elapsed_seconds') ? { elapsedSeconds: fields.get('elapsed_seconds') } : {}),
  }
}

/**
 * Remove a tokenizer leak observed in DeepSeek-LLM-7B-Chat results. Its
 * ByteLevel whitespace markers appeared literally in the workflow artifact;
 * normalize only when their density makes a leaked token stream unambiguous.
 */
export function normalizeDeepSeekOutput(text: string): string {
  const markerCount = (text.match(/[ĠĊ]/g) ?? []).length
  const isLeakedByteLevelText = markerCount >= Math.max(3, Math.floor(text.length / 100))
  let normalized = isLeakedByteLevelText
    ? text.replaceAll('Ġ', ' ').replaceAll('Ċ', '\n')
    : text

  normalized = normalized
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\[(?:USER_NAME|USERNAME)\]/gi, '')
    .replace(/^\s*Dear\s*,?[ \t]*(?:\r?\n)+/im, '')
    .replace(/^Best regards,[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*ForgeClaw[ \t]*$/im, '')

  const trimmed = normalized.trim()
  // DeepSeek-7B on CPU with greedy decoding can emit repetitive loops
  // ("the answer is the answer is...") that pass the marker cleanup.
  // Throw a specific quality error (not a generic empty-result) so the
  // Activity log distinguishes "model produced garbage" from transport
  // failures, and the Qwen fallback activates with accurate diagnostics.
  if (isRepetitiveWordLoop(trimmed)) {
    throw new Error('DeepSeek output failed quality validation: repetitive word loop detected')
  }

  return trimmed
}

/**
 * Detect word-level repetitive loops: a 7B model stuck in greedy decoding
 * repeats n-grams. Bounded and deterministic; preserves legitimate prose,
 * code, and multilingual text (which don't exhibit 30%+ n-gram duplication).
 */
function isRepetitiveWordLoop(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 20) return false
  for (const n of [3, 4, 5]) {
    if (words.length < n + 1) continue
    const grams: string[] = []
    for (let i = 0; i <= words.length - n; i++) {
      grams.push(words.slice(i, i + n).join(' '))
    }
    const unique = new Set(grams)
    const dupRatio = 1 - unique.size / grams.length
    if (dupRatio > 0.3) return true
  }
  return false
}

function ghHeaders(ctx: ToolContext): Record<string, string> {
  return { Authorization: `token ${ctx.ghToken}`, Accept: 'application/vnd.github.v3+json' }
}

/** Browser-readable mirror URL for a completed DeepSeek result. */
export function deepseekMirrorUrl(owner: string, repo: string, invocationId: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${DEEPSEEK_MIRROR_BRANCH}/${DEEPSEEK_MIRROR_DIR}/${encodeURIComponent(invocationId)}.txt`
}

async function findRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<DeepSeekWorkflowRun | undefined> {
  const response = await githubStage('deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs', () => toolFetch(
    { ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${DEEPSEEK_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100`,
    // GitHub caches REST GET responses briefly. Polling the identical URL
    // without cache bypass can replay the pre-dispatch list until discovery
    // times out, even though the workflow has already run.
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!response.ok) throw new Error(describeGithubHttpFailure('deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs', response.status, response.statusText))
  const data = await githubStage('deepseek-run-discovery response JSON', () => response.json()) as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
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
  const mirrorUrl = deepseekMirrorUrl(owner, repo, invocationId)
  while (Date.now() - started < DEEPSEEK_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('DeepSeek run aborted', 'AbortError')
    // Prefer mirror-based completion check: if the result file exists, the run is done.
    // This avoids GitHub API timeouts on constrained networks.
    try {
      const mirrorCheck = await toolFetch(
        { ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS },
        mirrorUrl,
        { method: 'HEAD', cache: 'no-store' },
      )
      if (mirrorCheck.ok) {
        // Mirror exists = workflow completed and published. Mark as completed.
        finalRun = { ...run, status: 'completed', conclusion: 'success' } as DeepSeekWorkflowRun
        break
      }
    } catch {
      // Mirror check failed, fall back to GitHub API poll
    }
    // GitHub API poll: tolerate transient network failures, retry on next interval.
    // A single failed request must not abort the entire 35-minute wait.
    try {
      const response = await githubStage('deepseek-run-poll GET /actions/runs/{run_id}', () => toolFetch(
        { ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS },
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
        { headers: ghHeaders(ctx), cache: 'no-store' },
      ))
      if (!response.ok) throw new Error(describeGithubHttpFailure('deepseek-run-poll GET /actions/runs/{run_id}', response.status, response.statusText))
      finalRun = await githubStage('deepseek-run-poll response JSON', () => response.json()) as DeepSeekWorkflowRun
      if (finalRun.status === 'completed') break
    } catch (pollError) {
      // Transient poll failure (network/CORS/timeout): log and retry on next interval.
      // Only abort if the context was explicitly cancelled.
      if (pollError instanceof DOMException && pollError.name === 'AbortError') throw pollError
      // Otherwise, fall through to the delay and retry.
    }
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
export async function readDeepSeekMirror(ctx: ToolContext, owner: string, repo: string, invocationId: string): Promise<DeepSeekResultDelivery | undefined> {
  try {
    const mirrorContext = { ...ctx, timeoutMs: MIRROR_TIMEOUT_MS }
    const response = await toolFetch(mirrorContext, deepseekMirrorUrl(owner, repo, invocationId), {
      cache: 'no-store',
    })
    if (!response.ok) return undefined
    const text = normalizeDeepSeekOutput(await response.text())
    if (!text) return undefined
    let metadata: Pick<DeepSeekResultDelivery, 'model' | 'role' | 'elapsedSeconds'> = {}
    try {
      const metaResponse = await toolFetch(mirrorContext, deepseekMirrorUrl(owner, repo, `${invocationId}.meta`), { cache: 'no-store' })
      if (metaResponse.ok) metadata = parseResultMetadata(await metaResponse.text())
    } catch {
      // Metadata is auxiliary; old mirrors may contain only the result text.
    }
    return { result: text, source: 'mirror', ...metadata }
  } catch {
    if (ctx.signal?.aborted) throw new DOMException('DeepSeek result retrieval aborted', 'AbortError')
    // No mirror yet (or blocked) — the artifact bridge below is the fallback.
    return undefined
  }
}

/** Fallback path: list the run's artifacts and extract result.txt from the ZIP. */
export async function downloadDeepSeekArtifact(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<DeepSeekResultDelivery> {
  const artifactsRes = await githubStage('deepseek-artifact-list GET /actions/runs/{run_id}/artifacts', () => toolFetch(
    { ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))

  if (!artifactsRes.ok) {
    throw new Error(describeGithubHttpFailure('deepseek-artifact-list GET /actions/runs/{run_id}/artifacts', artifactsRes.status, artifactsRes.statusText))
  }

  const data = await githubStage('deepseek-artifact-list response JSON', () => artifactsRes.json()) as { artifacts?: ArtifactInfo[] }
  const artifact = data.artifacts?.find(item => item.name === `${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}` && !item.expired)
  if (!artifact) throw new Error(`deepseek-artifact-list: artifact "${DEEPSEEK_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`)

  const zipResponse = await githubStage('deepseek-artifact-download', () => toolFetch(
    { ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS },
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
  const text = normalizeDeepSeekOutput(await githubStage('deepseek-result-extract', () => result.async('text')))
  if (!text) throw new Error(`deepseek-result-extract: run #${runId} completed without a non-empty result.`)
  const metadataFile = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result_meta.txt')
  const metadataText = metadataFile ? await githubStage('deepseek-result-metadata-extract', () => metadataFile.async('text')) : ''
  return { result: text, source: 'artifact', ...parseResultMetadata(metadataText) }
}

/** Resolve the real DeepSeek result for a correlated run, with stage-labelled failures. */
export async function downloadDeepSeekResult(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<DeepSeekResultDelivery> {
  const mirrored = await readDeepSeekMirror(ctx, owner, repo, invocationId)
  if (mirrored) return mirrored
  return downloadDeepSeekArtifact(ctx, owner, repo, runId, invocationId)
}

export async function waitForDeepSeekResult(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<{ run: DeepSeekWorkflowRun } & DeepSeekResultDelivery> {
  const run = await waitForDeepSeekRun(ctx, owner, repo, invocationId, dispatchedAt)
  return { run, ...await downloadDeepSeekResult(ctx, owner, repo, run.id, invocationId) }
}
