// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// End-to-end bridge for the repository-owned image generation workflow.
// generate_image dispatches .github/workflows/generate-image.yml, then this
// module correlates the exact workflow run via invocation_id, waits for
// completion, downloads the generated-image artifact ZIP, extracts the PNG
// with jszip, and converts it to a browser-displayable data URL.
//
// The data URL never enters model context: it travels through a module-level
// registry keyed by invocation_id, and the App.tsx direct-image fast path
// attaches it to Message.imageUrl for the existing <img> renderer.

import JSZip from 'jszip'
import type { ToolContext } from './forgeTools'
import { isCorrelatedShellRun, type ShellWorkflowRun } from './shellCorrelation'
import { describeGithubHttpFailure, githubStage, toolFetch } from './githubFetch'

export interface ImageWorkflowRun {
  id: number
  name: string
  display_title: string
  event: string
  status: string
  conclusion: string | null
  created_at: string
  head_branch: string
  html_url: string
  run_number: number
}

export interface ArtifactInfo {
  id: number
  name: string
  size_in_bytes: number
  archive_download_url: string
  expired: boolean
}

export const IMAGE_WORKFLOW_ID = 'generate-image.yml'
export const IMAGE_ARTIFACT_PREFIX = 'generated-image-'
export const IMAGE_MIRROR_BRANCH = 'generated-images'
// The workflow job is killed at 45 minutes; wait slightly longer so a run alive in minute 40-45 is not
// reported as timed out while it is still generating.
export const IMAGE_MAX_WAIT_MS = 46 * 60 * 1000
// Matches shell/DeepSeek run discovery (120s). 30s was 4x shorter than the other paths for no reason.
const IMAGE_DISCOVERY_TIMEOUT_MS = 120_000

const discoveryDelays = [100, 250, 500, 1000, 2000] as const
const statusDelays = [1000, 2000, 3000, 5000, 8000] as const
// The dispatched run is the newest one. 100 rows is ~1.6 MB per poll; 20 is enough
// and far kinder to phone links (same fix as deepseekArtifact.ts #131).
export const IMAGE_DISCOVERY_PAGE_SIZE = 20
// Statuses that will not change by asking again: bad credential, missing permission, wrong repo/workflow.
// Matches the describeGithubHttpFailure() text both stages throw.
const PERSISTENT_DISCOVERY_STATUS = /GitHub HTTP (?:401|403|404)\b/
// Bounds every GitHub read. Raw fetch has no timeout, so one dead connection used to hang the tool forever.
const IMAGE_GITHUB_READ_TIMEOUT_MS = 30_000
const DISCOVERY_STAGE = 'image-run-discovery GET /actions/workflows/generate-image.yml/runs'
const STATUS_STAGE = 'image-run-poll GET /actions/runs/{run_id}'

function ghHeaders(ctx: ToolContext): Record<string, string> {
  return {
    Authorization: `token ${ctx.ghToken}`,
    Accept: 'application/vnd.github.v3+json',
  }
}

async function findCorrelatedImageRun(
  ctx: ToolContext,
  owner: string,
  repo: string,
  invocationId: string,
  dispatchedAt: number,
): Promise<ImageWorkflowRun | undefined> {
  const runsRes = await githubStage(DISCOVERY_STAGE, () => toolFetch(
    { ...ctx, timeoutMs: IMAGE_GITHUB_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${IMAGE_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=${IMAGE_DISCOVERY_PAGE_SIZE}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!runsRes.ok) throw new Error(describeGithubHttpFailure(DISCOVERY_STAGE, runsRes.status, runsRes.statusText))
  const runsData = await githubStage(`${DISCOVERY_STAGE} response JSON`, () => runsRes.json()) as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
  const runs = runsData.workflow_runs || []
  const match = runs.find(run => isCorrelatedShellRun(run, invocationId, dispatchedAt))
  return match as ImageWorkflowRun | undefined
}

export async function waitForImageRun(
  ctx: ToolContext,
  owner: string,
  repo: string,
  invocationId: string,
  dispatchedAt: number,
): Promise<ImageWorkflowRun> {
  const discoveryDeadline = Date.now() + IMAGE_DISCOVERY_TIMEOUT_MS
  let run: ImageWorkflowRun | undefined
  let attempt = 0
  let lastReadError: string | undefined

  while (!run && Date.now() < discoveryDeadline) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    // The dispatch already succeeded, so one slow or failed list read must not abandon a run that is
    // executing on GitHub. Keep polling until the deadline; only persistent HTTP statuses stop early.
    try {
      run = await findCorrelatedImageRun(ctx, owner, repo, invocationId, dispatchedAt)
      lastReadError = undefined
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_DISCOVERY_STATUS.test(message)) throw error
      lastReadError = message
      console.warn(`[image-discovery] read failed for ${invocationId}, retrying: ${message}`)
    }
    if (run) break

    const remaining = discoveryDeadline - Date.now()
    if (remaining <= 0) break

    const delay = Math.min(
      discoveryDelays[Math.min(attempt, discoveryDelays.length - 1)],
      remaining,
    )
    attempt += 1
    await new Promise<void>(resolve => setTimeout(resolve, delay))
  }

  if (!run && lastReadError) {
    throw new Error(`Image generation dispatched, but GitHub could not be read to find run "${invocationId}" within ${IMAGE_DISCOVERY_TIMEOUT_MS / 1000}s. Last read error: ${lastReadError}`)
  }
  if (!run) {
    throw new Error(`Image generation dispatched but correlated run "${invocationId}" was not found within ${IMAGE_DISCOVERY_TIMEOUT_MS / 1000}s.`)
  }

  const startTime = Date.now()
  let finalRun = run
  let statusAttempt = 0

  while (Date.now() - startTime < IMAGE_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')

    // A single failed status read must not kill a 46-minute image job; a refused credential must.
    try {
      const statusRes = await githubStage(STATUS_STAGE, () => toolFetch(
        { ...ctx, timeoutMs: IMAGE_GITHUB_READ_TIMEOUT_MS },
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
        { headers: ghHeaders(ctx), cache: 'no-store' },
      ))
      if (!statusRes.ok) throw new Error(describeGithubHttpFailure(STATUS_STAGE, statusRes.status, statusRes.statusText))
      finalRun = await githubStage(`${STATUS_STAGE} response JSON`, () => statusRes.json()) as ImageWorkflowRun
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_DISCOVERY_STATUS.test(message)) throw error
      console.warn(`[image-status] read failed for run ${run.id}, retrying: ${message}`)
    }

    if (finalRun.status === 'completed') break

    const remaining = IMAGE_MAX_WAIT_MS - (Date.now() - startTime)
    if (remaining <= 0) break

    const delay = Math.min(
      statusDelays[Math.min(statusAttempt, statusDelays.length - 1)],
      remaining,
    )
    statusAttempt += 1
    await new Promise<void>(resolve => setTimeout(resolve, delay))
  }

  if (finalRun.status !== 'completed') {
    throw new Error(
      `Image generation timed out after ${Math.round(IMAGE_MAX_WAIT_MS / 60000)}m. Run #${finalRun.run_number} last status: ${finalRun.status}.`,
    )
  }

  if (finalRun.conclusion !== 'success') {
    throw new Error(
      `Image generation run #${finalRun.run_number} concluded as "${finalRun.conclusion}". Run: ${finalRun.html_url}`,
    )
  }

  return finalRun
}

async function imageStage<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[${label}] ${message}`)
  }
}

function imageMirrorUrl(owner: string, repo: string, invocationId: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${IMAGE_MIRROR_BRANCH}/generated-images/${encodeURIComponent(invocationId)}.png`
}

async function blobToDataUrl(pngBlob: Blob): Promise<string> {
  const pngBuffer = await imageStage('image-bytes', () => pngBlob.arrayBuffer())
  const bytes = new Uint8Array(pngBuffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return imageStage('image-base64', async () => `data:image/png;base64,${btoa(binary)}`)
}

async function pngDimensions(pngBlob: Blob): Promise<{ width: number; height: number }> {
  const header = new Uint8Array(await pngBlob.slice(16, 24).arrayBuffer())
  if (header.length !== 8) return { width: 0, height: 0 }
  const view = new DataView(header.buffer)
  return { width: view.getUint32(0), height: view.getUint32(4) }
}

export async function downloadImagePng(
  ctx: ToolContext,
  owner: string,
  repo: string,
  runId: number,
  invocationId: string,
): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  // GitHub's artifact endpoint returns a 303 redirect to Azure Blob Storage.
  // The redirected response is not CORS-readable from GitHub Pages. New runs
  // publish the same PNG to raw.githubusercontent.com, which is browser-safe.
  try {
    const mirrorRes = await fetch(imageMirrorUrl(owner, repo, invocationId), {
      cache: 'no-store',
      signal: ctx.signal,
    })
    if (mirrorRes.ok) {
      const pngBlob = await imageStage('image-mirror-bytes', () => mirrorRes.blob())
      const dimensions = await pngDimensions(pngBlob)
      return {
        dataUrl: await blobToDataUrl(pngBlob),
        width: dimensions.width,
        height: dimensions.height,
        bytes: pngBlob.size,
      }
    }
  } catch {
    // Older runs do not have a mirror; use the artifact bridge below.
  }

  const artifactsRes = await imageStage("artifact-list", () => fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    { headers: ghHeaders(ctx), signal: ctx.signal },
  ))

  if (!artifactsRes.ok) {
    throw new Error(`GitHub artifact list ${artifactsRes.status}`)
  }

  const artifactsData = await artifactsRes.json() as { artifacts?: ArtifactInfo[] }

  const artifact = (artifactsData.artifacts || []).find(
    a => a.name === `${IMAGE_ARTIFACT_PREFIX}${invocationId}` && !a.expired,
  )

  if (!artifact) {
    throw new Error(
      `Artifact "${IMAGE_ARTIFACT_PREFIX}${invocationId}" was not found on run ${runId}.`,
    )
  }

  const zipRes = await imageStage("artifact-download", () => fetch(artifact.archive_download_url, {
    headers: ghHeaders(ctx),
    signal: ctx.signal,
    redirect: 'follow',
  }))

  if (!zipRes.ok) {
    throw new Error(
      `Artifact download failed: ${zipRes.status}. If the browser blocked the cross-origin redirect to Azure blob storage, the ForgeClaw runtime proxy is required.`,
    )
  }

  const zipBytes = await imageStage("artifact-download-bytes", () => zipRes.arrayBuffer())
  const zip = await imageStage("artifact-unzip", () => JSZip.loadAsync(zipBytes))

  const pngEntry = Object.values(zip.files).find(
    entry =>
      !entry.dir &&
      /^generated_\d+x\d+\.png$/i.test(entry.name.split('/').pop() ?? ''),
  )

  if (!pngEntry) {
    throw new Error(
      `Artifact "${artifact.name}" did not contain a generated_*.png file.`,
    )
  }

  const pngBlob = await imageStage("artifact-png-extract", () => pngEntry.async('blob'))
  const sizeMatch = pngEntry.name.match(/generated_(\d+)x(\d+)\.png/i)
  const width = sizeMatch ? Number(sizeMatch[1]) : 0
  const height = sizeMatch ? Number(sizeMatch[2]) : 0

  const dataUrl = await blobToDataUrl(pngBlob)

  return {
    dataUrl,
    width,
    height,
    bytes: pngBlob.size,
  }
}

const generatedImages = new Map<string, string>()

export function registerGeneratedImage(
  invocationId: string,
  dataUrl: string,
): void {
  generatedImages.set(invocationId, dataUrl)
}

export function takeGeneratedImage(
  invocationId: string,
): string | undefined {
  const dataUrl = generatedImages.get(invocationId)

  if (dataUrl !== undefined) {
    generatedImages.delete(invocationId)
  }

  return dataUrl
}
