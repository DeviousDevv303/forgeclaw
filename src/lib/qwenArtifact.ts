// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// End-to-end bridge for the repository-owned Qwen workflow. GitHub workflow
// dispatch returns 204, so the invocation id is used to find the exact run,
// wait for completion, and read the result the runner produced.
//
// Browser-safe result retrieval (mirrors the proven image pipeline):
//   1. raw.githubusercontent.com/<owner>/<repo>/qwen-results/qwen-results/<id>.txt
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
import { isCorrelatedShellRun, explainShellRunMismatch, type ShellWorkflowRun } from './shellCorrelation'
import {
  describeGithubHttpFailure,
  githubStage,
  toolFetch,
} from './githubFetch'

export const QWEN_WORKFLOW_ID = 'qwen3-8b.yml'
export const QWEN_ARTIFACT_PREFIX = 'qwen-'
export const QWEN_MIRROR_BRANCH = 'qwen-results'
export const QWEN_MIRROR_DIR = 'qwen-results'
// The workflow job is killed at 30 minutes (qwen3-8b.yml timeout-minutes). Waiting a little longer
// covers result publishing, but not the 5 extra minutes a run that can never finish used to cost.
export const QWEN_MAX_WAIT_MS = 31 * 60 * 1000

/** Exact text qwen3-8b.yml writes when the model returned nothing. It is a failure, not an answer. */
export const QWEN_EMPTY_RESPONSE_PLACEHOLDER = '(Qwen produced an empty response)'
export function isEmptyQwenResponse(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length === 0 || trimmed === QWEN_EMPTY_RESPONSE_PLACEHOLDER
}

const DISCOVERY_TIMEOUT_MS = 120_000
const MIRROR_TIMEOUT_MS = 20_000
export const QWEN_GITHUB_READ_TIMEOUT_MS = 30_000
const discoveryDelays = [100, 250, 500, 1000, 2000] as const
// The dispatched run is the newest one (or one of the few newest when dispatches overlap). 100 rows
// is ~1.6 MB per poll, re-read every 2s with no-store; on a phone link that alone hits the read timeout.
export const QWEN_DISCOVERY_PAGE_SIZE = 20
// Statuses that will not change by asking again: bad credential, missing permission, wrong repo/workflow.
const PERSISTENT_DISCOVERY_STATUS = /GitHub HTTP (?:401|403|404)\b/
const statusDelays = [30000, 45000, 60000, 60000, 60000] as const

type QwenWorkflowRun = ShellWorkflowRun
interface ArtifactInfo {
  name: string
  archive_download_url: string
  expired: boolean
}

export interface QwenResultDelivery {
  result: string
  source: 'mirror' | 'artifact'
  model?: string
  role?: string
  elapsedSeconds?: string
  /** The workflow had to cut the prompt to fit the model window (result_meta.txt `prompt_trimmed=true`). */
  promptTrimmed?: boolean
  /** What the workflow did with the NEXUS guidance block: 'none' (no block), 'kept' or 'cut' (`nexus_guidance=`). */
  nexusGuidance?: string
}

type ResultMetadata = Pick<QwenResultDelivery, 'model' | 'role' | 'elapsedSeconds' | 'promptTrimmed' | 'nexusGuidance'>

function parseResultMetadata(text: string): ResultMetadata {
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
    ...(fields.get('prompt_trimmed') === 'true' ? { promptTrimmed: true } : {}),
    ...(fields.get('nexus_guidance') ? { nexusGuidance: fields.get('nexus_guidance') } : {}),
  }
}

/**
 * Remove a tokenizer leak observed in DeepSeek-LLM-7B-Chat results. Its
 * ByteLevel whitespace markers appeared literally in the workflow artifact;
 * normalize only when their density makes a leaked token stream unambiguous.
 */
export function normalizeQwenOutput(text: string): string {
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
    throw new Error('Qwen output failed quality validation: repetitive word loop detected')
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

/** Browser-readable mirror URL for a completed Qwen result. */
export function qwenMirrorUrl(owner: string, repo: string, invocationId: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${QWEN_MIRROR_BRANCH}/${QWEN_MIRROR_DIR}/${encodeURIComponent(invocationId)}.txt`
}

async function findRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<QwenWorkflowRun | undefined> {
  const response = await githubStage('qwen-run-discovery GET /actions/workflows/qwen3-8b.yml/runs', () => toolFetch(
    { ...ctx, timeoutMs: QWEN_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${QWEN_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=${QWEN_DISCOVERY_PAGE_SIZE}`,
    // GitHub caches REST GET responses briefly. Polling the identical URL
    // without cache bypass can replay the pre-dispatch list until discovery
    // times out, even though the workflow has already run.
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!response.ok) throw new Error(describeGithubHttpFailure('qwen-run-discovery GET /actions/workflows/qwen3-8b.yml/runs', response.status, response.statusText))
  const data = await githubStage('qwen-run-discovery response JSON', () => response.json()) as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
  const runs = data.workflow_runs ?? []
  const matched = runs.find(run => isCorrelatedShellRun(run, invocationId, dispatchedAt))
  if (matched) return matched as QwenWorkflowRun | undefined

  if (runs.length > 0) {
    // Log why runs were rejected — critical for diagnosing discovery failures
    const reasons = runs.slice(0, 5).map(run => {
      const label = `${run.name ?? ''} ${run.display_title ?? ''}`.trim().slice(0, 60)
      const reason = explainShellRunMismatch(run, invocationId, dispatchedAt)
      return `${label}: ${reason ?? 'MATCHED (but not selected?)'}`
    })
    console.warn(`[qwen-discovery] No match for ${invocationId} among ${runs.length} runs. Recent:`, reasons)
  }
  return undefined
}

export async function waitForQwenRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<QwenWorkflowRun> {
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS
  let run: QwenWorkflowRun | undefined
  let attempt = 0
  let lastReadError: string | undefined
  // Deadline checked after each read, never before: the last sleep ends at the deadline (see imageArtifact.ts).
  while (!run) {
    if (ctx.signal?.aborted) throw new DOMException('Qwen run aborted', 'AbortError')
    // The dispatch already succeeded, so one slow or failed list read must not abandon a run that is
    // executing on GitHub. Keep polling until the deadline; only persistent HTTP statuses stop early.
    try {
      run = await findRun(ctx, owner, repo, invocationId, dispatchedAt)
      lastReadError = undefined
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_DISCOVERY_STATUS.test(message)) throw error
      lastReadError = message
      console.warn(`[qwen-discovery] read failed for ${invocationId}, retrying: ${message}`)
    }
    if (run) break
    const remaining = discoveryDeadline - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(discoveryDelays[Math.min(attempt++, discoveryDelays.length - 1)], remaining)))
  }
  if (!run && lastReadError) throw new Error(`qwen-run-discovery: Qwen dispatched, but GitHub could not be read to find run "${invocationId}" within ${DISCOVERY_TIMEOUT_MS / 1000}s. Last read error: ${lastReadError}`)
  if (!run) throw new Error(`qwen-run-discovery: Qwen dispatched but correlated run "${invocationId}" was not found within ${DISCOVERY_TIMEOUT_MS / 1000}s.`)

  const started = Date.now()
  let statusAttempt = 0
  let finalRun = run
  const mirrorUrl = qwenMirrorUrl(owner, repo, invocationId)
  while (Date.now() - started < QWEN_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('Qwen run aborted', 'AbortError')
    // Prefer mirror-based completion check: if the result file exists, the run is done.
    // This avoids GitHub API timeouts on constrained networks.
    try {
      const mirrorCheck = await toolFetch(
        { ...ctx, timeoutMs: QWEN_GITHUB_READ_TIMEOUT_MS },
        mirrorUrl,
        { method: 'HEAD', cache: 'no-store' },
      )
      if (mirrorCheck.ok) {
        // Mirror exists = workflow completed and published. Mark as completed.
        finalRun = { ...run, status: 'completed', conclusion: 'success' } as QwenWorkflowRun
        break
      }
    } catch {
      // Mirror check failed, fall back to GitHub API poll
    }
    // GitHub API poll: tolerate transient network failures, retry on next interval.
    // A single failed request must not abort the entire 35-minute wait.
    try {
      const response = await githubStage('qwen-run-poll GET /actions/runs/{run_id}', () => toolFetch(
        { ...ctx, timeoutMs: QWEN_GITHUB_READ_TIMEOUT_MS },
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
        { headers: ghHeaders(ctx), cache: 'no-store' },
      ))
      if (!response.ok) throw new Error(describeGithubHttpFailure('qwen-run-poll GET /actions/runs/{run_id}', response.status, response.statusText))
      finalRun = await githubStage('qwen-run-poll response JSON', () => response.json()) as QwenWorkflowRun
      if (finalRun.status === 'completed') break
    } catch (pollError) {
      // Transient poll failure (network/CORS/timeout): log and retry on next interval.
      // Only abort if the context was explicitly cancelled.
      if (pollError instanceof DOMException && pollError.name === 'AbortError') throw pollError
      // Otherwise, fall through to the delay and retry.
    }
    const remaining = QWEN_MAX_WAIT_MS - (Date.now() - started)
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(statusDelays[Math.min(statusAttempt++, statusDelays.length - 1)], remaining)))
  }
  if (finalRun.status !== 'completed') throw new Error(`qwen-run-poll: Qwen timed out after ${Math.round(QWEN_MAX_WAIT_MS / 60000)}m. Run #${finalRun.run_number} last status: ${finalRun.status}.`)
  if (finalRun.conclusion !== 'success') throw new Error(`qwen-run-poll: Qwen run #${finalRun.run_number} concluded as "${finalRun.conclusion}". Run: ${finalRun.html_url}`)
  return finalRun
}

/**
 * Preferred path: read the plain-text mirror the workflow publishes to a branch.
 * Returns undefined when the mirror is absent (older runs, or a run that failed
 * before publishing) so the caller can fall back to the artifact.
 */
export async function readQwenMirror(ctx: ToolContext, owner: string, repo: string, invocationId: string): Promise<QwenResultDelivery | undefined> {
  try {
    const mirrorContext = { ...ctx, timeoutMs: MIRROR_TIMEOUT_MS }
    const response = await toolFetch(mirrorContext, qwenMirrorUrl(owner, repo, invocationId), {
      cache: 'no-store',
    })
    if (!response.ok) return undefined
    const text = normalizeQwenOutput(await response.text())
    if (!text) return undefined
    let metadata: ResultMetadata = {}
    try {
      const metaResponse = await toolFetch(mirrorContext, qwenMirrorUrl(owner, repo, `${invocationId}.meta`), { cache: 'no-store' })
      if (metaResponse.ok) metadata = parseResultMetadata(await metaResponse.text())
    } catch {
      // Metadata is auxiliary; old mirrors may contain only the result text.
    }
    return { result: text, source: 'mirror', ...metadata }
  } catch {
    if (ctx.signal?.aborted) throw new DOMException('Qwen result retrieval aborted', 'AbortError')
    // No mirror yet (or blocked) — the artifact bridge below is the fallback.
    return undefined
  }
}

/** Fallback path: list the run's artifacts and extract result.txt from the ZIP. */
export async function downloadQwenArtifact(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<QwenResultDelivery> {
  const artifactsRes = await githubStage('qwen-artifact-list GET /actions/runs/{run_id}/artifacts', () => toolFetch(
    { ...ctx, timeoutMs: QWEN_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))

  if (!artifactsRes.ok) {
    throw new Error(describeGithubHttpFailure('qwen-artifact-list GET /actions/runs/{run_id}/artifacts', artifactsRes.status, artifactsRes.statusText))
  }

  const data = await githubStage('qwen-artifact-list response JSON', () => artifactsRes.json()) as { artifacts?: ArtifactInfo[] }
  const artifact = data.artifacts?.find(item => item.name === `${QWEN_ARTIFACT_PREFIX}${invocationId}` && !item.expired)
  if (!artifact) throw new Error(`qwen-artifact-list: artifact "${QWEN_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`)

  const zipResponse = await githubStage('qwen-artifact-download', () => toolFetch(
    { ...ctx, timeoutMs: QWEN_GITHUB_READ_TIMEOUT_MS },
    artifact.archive_download_url,
    { headers: ghHeaders(ctx), signal: ctx.signal, redirect: 'follow' },
  ))
  if (!zipResponse.ok) {
    throw new Error(describeGithubHttpFailure('qwen-artifact-download', zipResponse.status, zipResponse.statusText))
  }

  const zipBytes = await githubStage('qwen-artifact-download', () => zipResponse.arrayBuffer())
  const zip = await githubStage('qwen-artifact-unzip', () => JSZip.loadAsync(zipBytes))
  const result = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result.txt')
  if (!result) throw new Error(`qwen-artifact-unzip: artifact "${artifact.name}" did not contain result.txt.`)
  const text = normalizeQwenOutput(await githubStage('qwen-result-extract', () => result.async('text')))
  if (!text) throw new Error(`qwen-result-extract: run #${runId} completed without a non-empty result.`)
  const metadataFile = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result_meta.txt')
  const metadataText = metadataFile ? await githubStage('qwen-result-metadata-extract', () => metadataFile.async('text')) : ''
  return { result: text, source: 'artifact', ...parseResultMetadata(metadataText) }
}

/** Resolve the real Qwen result for a correlated run, with stage-labelled failures. */
export async function downloadQwenResult(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<QwenResultDelivery> {
  const mirrored = await readQwenMirror(ctx, owner, repo, invocationId)
  if (mirrored) return mirrored
  return downloadQwenArtifact(ctx, owner, repo, runId, invocationId)
}

export async function waitForQwenResult(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<{ run: QwenWorkflowRun } & QwenResultDelivery> {
  const run = await waitForQwenRun(ctx, owner, repo, invocationId, dispatchedAt)
  return { run, ...await downloadQwenResult(ctx, owner, repo, run.id, invocationId) }
}
