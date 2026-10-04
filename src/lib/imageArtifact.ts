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
export const IMAGE_MAX_WAIT_MS = 40 * 60 * 1000
const IMAGE_DISCOVERY_TIMEOUT_MS = 30_000

const discoveryDelays = [100, 250, 500, 1000, 2000] as const
const statusDelays = [1000, 2000, 3000, 5000, 8000] as const

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
  const runsRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${IMAGE_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100`,
    { headers: ghHeaders(ctx), cache: 'no-store', signal: ctx.signal },
  )
  if (!runsRes.ok) throw new Error(`GitHub runs list ${runsRes.status}`)
  const runsData = await runsRes.json() as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
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

  while (!run && Date.now() < discoveryDeadline) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    run = await findCorrelatedImageRun(ctx, owner, repo, invocationId, dispatchedAt)
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

  if (!run) {
    throw new Error(`Image generation dispatched but correlated run "${invocationId}" was not found.`)
  }

  const startTime = Date.now()
  let finalRun = run
  let statusAttempt = 0

  while (Date.now() - startTime < IMAGE_MAX_WAIT_MS) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')

    const statusRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
      { headers: ghHeaders(ctx), signal: ctx.signal },
    )

    if (!statusRes.ok) throw new Error(`GitHub run status ${statusRes.status}`)

    finalRun = await statusRes.json() as ImageWorkflowRun

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

export async function downloadImagePng(
  ctx: ToolContext,
  owner: string,
  repo: string,
  runId: number,
  invocationId: string,
): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
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

  const pngBuffer = await imageStage("artifact-png-bytes", () => pngBlob.arrayBuffer())
  const bytes = new Uint8Array(pngBuffer)

  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  const dataUrl = await imageStage("artifact-base64", async () =>
    `data:image/png;base64,${btoa(binary)}`
  )

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
