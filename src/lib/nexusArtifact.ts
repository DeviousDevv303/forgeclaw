// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// End-to-end bridge for the repository-owned Nexus Intelligence workflow — the same
// contract as the Qwen bridge (qwenArtifact.ts), with one deliberate difference: the
// result text is the model's raw transcript segment and is NEVER normalized. The
// segment's special-token grammar is how the router recognizes tool calls; collapsing
// whitespace or stripping markers here would corrupt call arguments and answers alike.
//
// Browser-safe result retrieval (mirrors the Qwen/image pipelines):
//   1. raw.githubusercontent.com/<owner>/<repo>/nexus-results/nexus-results/<id>.txt
//      — a branch the workflow publishes to.
//   2. Fallback: list the run's artifacts, download the artifact ZIP through the shared
//      hardened boundary, and extract result.txt with jszip.
//
// Every stage is labelled so a failure identifies WHERE the path broke
// (dispatch → discovery → poll → list → download → unzip → extract).

import JSZip from 'jszip'
import type { ToolContext } from './forgeTools'
import { isCorrelatedShellRun, explainShellRunMismatch, type ShellWorkflowRun } from './shellCorrelation'
import {
  describeGithubHttpFailure,
  githubStage,
  toolFetch,
} from './githubFetch'

export const NEXUS_WORKFLOW_ID = 'nexus-intelligence.yml'
export const NEXUS_ARTIFACT_PREFIX = 'nexus-'
export const NEXUS_MIRROR_BRANCH = 'nexus-results'
export const NEXUS_MIRROR_DIR = 'nexus-results'
// The workflow job is killed at 20 minutes (nexus-intelligence.yml timeout-minutes).
export const NEXUS_MAX_WAIT_MS = 21 * 60 * 1000
export const NEXUS_GITHUB_READ_TIMEOUT_MS = 30_000

const DISCOVERY_TIMEOUT_MS = 120_000
const MIRROR_TIMEOUT_MS = 20_000
export const NEXUS_DISCOVERY_PAGE_SIZE = 20
const PERSISTENT_DISCOVERY_STATUS = /GitHub HTTP (?:401|403|404)\b/
const discoveryDelays = [100, 250, 500, 1000, 2000] as const
const statusDelays = [5000, 5000, 8000, 10000, 15000] as const

type NexusWorkflowRun = ShellWorkflowRun
interface ArtifactInfo {
  name: string
  archive_download_url: string
  expired: boolean
}

export interface NexusResultDelivery {
  result: string
  source: 'mirror' | 'artifact'
  model?: string
  /** sha256 of the checkpoint that produced the result, from result_meta.txt. */
  checkpointSha256?: string
  elapsedSeconds?: string
  /** The workflow had to trim the prompt to fit the 640-token window (`prompt_trimmed=true`). */
  promptTrimmed?: boolean
  /** The runner wrote a failure result (checkpoint mismatch, empty task, …). */
  runFailed?: boolean
}

type ResultMetadata = Pick<NexusResultDelivery, 'model' | 'checkpointSha256' | 'elapsedSeconds' | 'promptTrimmed' | 'runFailed'>

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
    ...(fields.get('checkpoint_sha256') ? { checkpointSha256: fields.get('checkpoint_sha256') } : {}),
    ...(fields.get('elapsed_seconds') ? { elapsedSeconds: fields.get('elapsed_seconds') } : {}),
    ...(fields.get('prompt_trimmed') === 'true' ? { promptTrimmed: true } : {}),
    ...(fields.get('run_failed') === 'true' ? { runFailed: true } : {}),
  }
}

function ghHeaders(ctx: ToolContext): Record<string, string> {
  return { Authorization: `token ${ctx.ghToken}`, Accept: 'application/vnd.github.v3+json' }
}

/** Browser-readable mirror URL for a completed Nexus result. */
export function nexusMirrorUrl(owner: string, repo: string, invocationId: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${NEXUS_MIRROR_BRANCH}/${NEXUS_MIRROR_DIR}/${encodeURIComponent(invocationId)}.txt`
}

async function findRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<NexusWorkflowRun | undefined> {
  const response = await githubStage('nexus-run-discovery GET /actions/workflows/nexus-intelligence.yml/runs', () => toolFetch(
    { ...ctx, timeoutMs: NEXUS_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${NEXUS_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=${NEXUS_DISCOVERY_PAGE_SIZE}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!response.ok) throw new Error(describeGithubHttpFailure('nexus-run-discovery GET /actions/workflows/nexus-intelligence.yml/runs', response.status, response.statusText))
  const data = await githubStage('nexus-run-discovery response JSON', () => response.json()) as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
  const runs = data.workflow_runs ?? []
  const matched = runs.find(run => isCorrelatedShellRun(run, invocationId, dispatchedAt))
  if (matched) return matched as NexusWorkflowRun | undefined

  if (runs.length > 0) {
    const reasons = runs.slice(0, 5).map(run => {
      const label = `${run.name ?? ''} ${run.display_title ?? ''}`.trim().slice(0, 60)
      const reason = explainShellRunMismatch(run, invocationId, dispatchedAt)
      return `${label}: ${reason ?? 'MATCHED (but not selected?)'}`
    })
    console.warn(`[nexus-discovery] No match for ${invocationId} among ${runs.length} runs. Recent:`, reasons)
  }
  return undefined
}

export async function waitForNexusRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<NexusWorkflowRun> {
  const discoveryDeadline = Date.now() + DISCOVERY_TIMEOUT_MS
  let run: NexusWorkflowRun | undefined
  let attempt = 0
  let lastReadError: string | undefined
  while (!run) {
    if (ctx.signal?.aborted) throw new DOMException('Nexus run aborted', 'AbortError')
    try {
      run = await findRun(ctx, owner, repo, invocationId, dispatchedAt)
      lastReadError = undefined
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_DISCOVERY_STATUS.test(message)) throw error
      lastReadError = message
      console.warn(`[nexus-discovery] read failed for ${invocationId}, retrying: ${message}`)
    }
    if (run) break
    const remaining = discoveryDeadline - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(discoveryDelays[Math.min(attempt++, discoveryDelays.length - 1)], remaining)))
  }
  if (!run && lastReadError) throw new Error(`nexus-run-discovery: Nexus dispatched, but GitHub could not be read to find run "${invocationId}" within ${DISCOVERY_TIMEOUT_MS / 1000}s. Last read error: ${lastReadError}`)
  if (!run) throw new Error(`nexus-run-discovery: Nexus dispatched but correlated run "${invocationId}" was not found within ${DISCOVERY_TIMEOUT_MS / 1000}s.`)

  const started = Date.now()
  let statusAttempt = 0
  let finalRun = run
  const mirrorUrl = nexusMirrorUrl(owner, repo, invocationId)
  while (Date.now() - started < NEXUS_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('Nexus run aborted', 'AbortError')
    // Prefer mirror-based completion check: if the result file exists, the run is done.
    try {
      const mirrorCheck = await toolFetch(
        { ...ctx, timeoutMs: NEXUS_GITHUB_READ_TIMEOUT_MS },
        mirrorUrl,
        { method: 'HEAD', cache: 'no-store' },
      )
      if (mirrorCheck.ok) {
        finalRun = { ...run, status: 'completed', conclusion: 'success' } as NexusWorkflowRun
        break
      }
    } catch {
      // Mirror check failed, fall back to GitHub API poll
    }
    try {
      const response = await githubStage('nexus-run-poll GET /actions/runs/{run_id}', () => toolFetch(
        { ...ctx, timeoutMs: NEXUS_GITHUB_READ_TIMEOUT_MS },
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
        { headers: ghHeaders(ctx), cache: 'no-store' },
      ))
      if (!response.ok) throw new Error(describeGithubHttpFailure('nexus-run-poll GET /actions/runs/{run_id}', response.status, response.statusText))
      finalRun = await githubStage('nexus-run-poll response JSON', () => response.json()) as NexusWorkflowRun
      if (finalRun.status === 'completed') break
    } catch (pollError) {
      if (pollError instanceof DOMException && pollError.name === 'AbortError') throw pollError
    }
    const remaining = NEXUS_MAX_WAIT_MS - (Date.now() - started)
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(statusDelays[Math.min(statusAttempt++, statusDelays.length - 1)], remaining)))
  }
  if (finalRun.status !== 'completed') throw new Error(`nexus-run-poll: Nexus timed out after ${Math.round(NEXUS_MAX_WAIT_MS / 60000)}m. Run #${finalRun.run_number} last status: ${finalRun.status}.`)
  if (finalRun.conclusion !== 'success') throw new Error(`nexus-run-poll: Nexus run #${finalRun.run_number} concluded as "${finalRun.conclusion}". Run: ${finalRun.html_url}`)
  return finalRun
}

/**
 * Preferred path: read the plain-text mirror the workflow publishes to a branch.
 * The segment is returned byte-for-byte (outer whitespace trimmed only) — its grammar
 * is load-bearing. Returns undefined when the mirror is absent so the caller falls
 * back to the artifact.
 */
export async function readNexusMirror(ctx: ToolContext, owner: string, repo: string, invocationId: string): Promise<NexusResultDelivery | undefined> {
  try {
    const mirrorContext = { ...ctx, timeoutMs: MIRROR_TIMEOUT_MS }
    const response = await toolFetch(mirrorContext, nexusMirrorUrl(owner, repo, invocationId), {
      cache: 'no-store',
    })
    if (!response.ok) return undefined
    const text = (await response.text()).trim()
    if (!text) return undefined
    let metadata: ResultMetadata = {}
    try {
      const metaResponse = await toolFetch(mirrorContext, nexusMirrorUrl(owner, repo, `${invocationId}.meta`), { cache: 'no-store' })
      if (metaResponse.ok) metadata = parseResultMetadata(await metaResponse.text())
    } catch {
      // Metadata is auxiliary; a mirror may carry only the result text.
    }
    return { result: text, source: 'mirror', ...metadata }
  } catch {
    if (ctx.signal?.aborted) throw new DOMException('Nexus result retrieval aborted', 'AbortError')
    return undefined
  }
}

/** Fallback path: list the run's artifacts and extract result.txt from the ZIP. */
export async function downloadNexusArtifact(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<NexusResultDelivery> {
  const artifactsRes = await githubStage('nexus-artifact-list GET /actions/runs/{run_id}/artifacts', () => toolFetch(
    { ...ctx, timeoutMs: NEXUS_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))

  if (!artifactsRes.ok) {
    throw new Error(describeGithubHttpFailure('nexus-artifact-list GET /actions/runs/{run_id}/artifacts', artifactsRes.status, artifactsRes.statusText))
  }

  const data = await githubStage('nexus-artifact-list response JSON', () => artifactsRes.json()) as { artifacts?: ArtifactInfo[] }
  const artifact = data.artifacts?.find(item => item.name === `${NEXUS_ARTIFACT_PREFIX}${invocationId}` && !item.expired)
  if (!artifact) throw new Error(`nexus-artifact-list: artifact "${NEXUS_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`)

  const zipResponse = await githubStage('nexus-artifact-download', () => toolFetch(
    { ...ctx, timeoutMs: NEXUS_GITHUB_READ_TIMEOUT_MS },
    artifact.archive_download_url,
    { headers: ghHeaders(ctx), signal: ctx.signal, redirect: 'follow' },
  ))
  if (!zipResponse.ok) {
    throw new Error(describeGithubHttpFailure('nexus-artifact-download', zipResponse.status, zipResponse.statusText))
  }

  const zipBytes = await githubStage('nexus-artifact-download', () => zipResponse.arrayBuffer())
  const zip = await githubStage('nexus-artifact-unzip', () => JSZip.loadAsync(zipBytes))
  const result = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result.txt')
  if (!result) throw new Error(`nexus-artifact-unzip: artifact "${artifact.name}" did not contain result.txt.`)
  const text = (await githubStage('nexus-result-extract', () => result.async('text'))).trim()
  if (!text) throw new Error(`nexus-result-extract: run #${runId} completed without a non-empty result.`)
  const metadataFile = Object.values(zip.files).find(entry => !entry.dir && entry.name.split('/').pop() === 'result_meta.txt')
  const metadataText = metadataFile ? await githubStage('nexus-result-metadata-extract', () => metadataFile.async('text')) : ''
  return { result: text, source: 'artifact', ...parseResultMetadata(metadataText) }
}

/** Resolve the real Nexus segment for a correlated run, with stage-labelled failures. */
export async function downloadNexusResult(ctx: ToolContext, owner: string, repo: string, runId: number, invocationId: string): Promise<NexusResultDelivery> {
  const mirrored = await readNexusMirror(ctx, owner, repo, invocationId)
  if (mirrored) return mirrored
  return downloadNexusArtifact(ctx, owner, repo, runId, invocationId)
}

export async function waitForNexusResult(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<{ run: NexusWorkflowRun } & NexusResultDelivery> {
  const run = await waitForNexusRun(ctx, owner, repo, invocationId, dispatchedAt)
  return { run, ...await downloadNexusResult(ctx, owner, repo, run.id, invocationId) }
}
