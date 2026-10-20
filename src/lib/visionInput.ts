// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Picture analysis on GitHub Actions (DeepSeek provider) ──────────────────
// The DeepSeek provider has no vision of its own. An attached picture is committed to the
// vision-inputs branch, image-analyze.yml runs Qwen2-VL-2B on it, and the answer is read back from the
// vision-results branch (artifact zips are not readable from the browser). The workflow's mirror job
// removes the picture from vision-inputs once it has been analyzed.

import type { GithubRequest } from './githubPublish'
import { parseImageDataUrl } from './imageInput'
import { dispatchAndWait, newInvocationId } from './workflowRun'

export const IMAGE_ANALYZE_WORKFLOW = 'image-analyze.yml'
export const VISION_INPUT_BRANCH = 'vision-inputs'
export const VISION_RESULT_BRANCH = 'vision-results'
/** Torch install + model load + generation on the free CPU runner; a cold run measured about 2 minutes. */
export const VISION_MAX_WAIT_MS = 20 * 60 * 1000
export const VISION_MODEL_LABEL = 'Qwen2-VL-2B (GitHub Actions, CPU)'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

async function githubJson<T>(request: GithubRequest, url: string, token: string, step: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, { ...init, headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`${step} failed: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}`)
  }
  return await res.json() as T
}

/** Commit the picture to vision-inputs/<invocationId>.<ext>; returns that path. Creates the branch (orphan) on first use. */
export async function uploadVisionInput(request: GithubRequest, input: { owner: string; repo: string; token: string; invocationId: string; dataUrl: string }): Promise<string> {
  const image = parseImageDataUrl(input.dataUrl)
  if (!image) throw new Error('the attached file is not a JPEG, PNG, WebP or GIF picture')
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const path = `${VISION_INPUT_BRANCH}/${input.invocationId}.${EXTENSIONS[image.mediaType]}`
  const blob = await githubJson<{ sha: string }>(request, `${base}/git/blobs`, input.token, 'uploading the picture', { method: 'POST', body: JSON.stringify({ content: image.data, encoding: 'base64' }) })
  for (let attempt = 0; attempt < 3; attempt++) {
    const refRes = await request(`${base}/git/ref/heads/${VISION_INPUT_BRANCH}`, { headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    if (!refRes.ok && refRes.status !== 404) throw new Error(`reading the ${VISION_INPUT_BRANCH} branch failed: GitHub ${refRes.status}`)
    const parent = refRes.ok ? (await refRes.json() as { object: { sha: string } }).object.sha : undefined
    const baseTree = parent ? (await githubJson<{ tree: { sha: string } }>(request, `${base}/git/commits/${parent}`, input.token, 'reading the branch tip')).tree.sha : undefined
    const tree = await githubJson<{ sha: string }>(request, `${base}/git/trees`, input.token, 'building the commit', { method: 'POST', body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] }) })
    const commit = await githubJson<{ sha: string }>(request, `${base}/git/commits`, input.token, 'committing the picture', { method: 'POST', body: JSON.stringify({ message: `vision: picture for ${input.invocationId}`, tree: tree.sha, parents: parent ? [parent] : [] }) })
    const update = parent
      ? await request(`${base}/git/refs/heads/${VISION_INPUT_BRANCH}`, { method: 'PATCH', headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: false }) })
      : await request(`${base}/git/refs`, { method: 'POST', headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${VISION_INPUT_BRANCH}`, sha: commit.sha }) })
    if (update.ok) return path
    // 422: another upload moved the branch (or created it) first; rebuild on the new tip.
    if (update.status !== 422) throw new Error(`updating the ${VISION_INPUT_BRANCH} branch failed: GitHub ${update.status} (the token needs Contents: write)`)
  }
  throw new Error(`the ${VISION_INPUT_BRANCH} branch kept moving; try again`)
}

export interface ImageAnalysisInput {
  owner: string
  repo: string
  token: string
  prompt: string
  /** A picture attached in the app (data URL), or a public https URL. */
  image: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function runImageAnalysis(request: GithubRequest, input: ImageAnalysisInput): Promise<{ answer: string; model: string; runUrl: string; invocationId: string }> {
  const prompt = input.prompt.trim().slice(0, 2000) || 'Describe this image in detail.'
  const invocationId = newInvocationId('vision')
  const attached = parseImageDataUrl(input.image) !== null
  if (!attached && !/^https:\/\/\S+$/i.test(input.image)) throw new Error('analyze_image needs an attached picture or a public https image URL')
  const imageRef = attached ? await uploadVisionInput(request, { owner: input.owner, repo: input.repo, token: input.token, invocationId, dataUrl: input.image }) : ''
  const run = await dispatchAndWait(request, {
    owner: input.owner, repo: input.repo, token: input.token, workflow: IMAGE_ANALYZE_WORKFLOW,
    inputs: { image_url: attached ? '' : input.image, image_ref: imageRef, prompt, invocation_id: invocationId },
    invocationId, maxWaitMs: VISION_MAX_WAIT_MS, signal: input.signal, sleep: input.sleep, now: input.now,
  })
  const read = async (file: string) => request(`https://api.github.com/repos/${input.owner}/${input.repo}/contents/${VISION_RESULT_BRANCH}/${file}?ref=${VISION_RESULT_BRANCH}`, {
    headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store',
  })
  const res = await read(`${invocationId}.txt`)
  if (!res.ok) throw new Error(`image analysis run #${run.run_number} concluded "${run.conclusion}" and its answer could not be read (GitHub ${res.status}). Logs: ${run.html_url}`)
  const answer = (await res.text()).trim()
  if (run.conclusion !== 'success' || !answer || /^ANALYSIS FAILED/.test(answer)) throw new Error(`image analysis run #${run.run_number} failed (${run.conclusion}). Logs: ${run.html_url}`)
  const meta = await read(`${invocationId}.meta.txt`).then(r => r.ok ? r.text() : '').catch(() => '')
  const model = /^model=(.+)$/m.exec(meta)?.[1] || 'Qwen/Qwen2-VL-2B-Instruct'
  return { answer, model, runUrl: run.html_url, invocationId }
}

/** Tool result for analyze_image. The answer comes from the vision model, not from the chat model. */
export function formatImageAnalysis(result: { answer: string; model: string; runUrl: string }): string {
  return `✓ Image analysis by ${result.model} · run ${result.runUrl}\n${result.answer}`
}
