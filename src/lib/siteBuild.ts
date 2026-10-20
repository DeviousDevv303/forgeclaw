// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Build-then-publish for sites that need a build step ─────────────────────
// .github/workflows/site-build.yml builds a site's source branch with no write credential, and a
// separate trusted job copies the output to builds/<invocation_id>/ on the site-builds branch of this
// repository (artifact zips are not reliably downloadable from the browser). This module dispatches
// that workflow, waits for its correlated run, reads the mirrored output and publishes it with
// publishSite, binary-safe.

import { CANONICAL_IDENTITY } from './canonicalIdentity'
import type { ShellWorkflowRun } from './shellCorrelation'
import { dispatchAndWait, newInvocationId } from './workflowRun'
import { BUILD_PUBLISH_LIMITS, publishSite, type GithubRequest, type PublishFile, type PublishSiteResult } from './githubPublish'

export const SITE_BUILD_WORKFLOW = 'site-build.yml'
export const SITE_BUILD_MIRROR_BRANCH = 'site-builds'
export const SITE_BUILD_MAX_WAIT_MS = 20 * 60 * 1000
const API = 'https://api.github.com'

export interface BuildSiteInput {
  /** Repository holding the workflow (ForgeClaw). */
  workflowOwner: string
  workflowRepo: string
  /** Site repository: source is read from it, the build is published to it. */
  owner: string
  repo: string
  token: string
  sourceBranch?: string
  buildCommand?: string
  outputDir?: string
  publishBranch?: string
  message?: string
  invocationId?: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface BuildSiteResult { run: ShellWorkflowRun; files: number; publish: PublishSiteResult }

/** The same input rules site-build.yml enforces, checked before anything is dispatched. */
export function validateBuildInput(input: BuildSiteInput): { sourceBranch: string; buildCommand: string; outputDir: string } {
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(`${input.owner}/${input.repo}`)) throw new Error(`invalid repository ${input.owner}/${input.repo}`)
  if (`${input.owner}/${input.repo}`.toLowerCase() === CANONICAL_IDENTITY.fullRepository.toLowerCase()) {
    throw new Error(`refusing to build into ${CANONICAL_IDENTITY.fullRepository}: its gh-pages branch is the deployed ForgeClaw app. Use the site's own repository.`)
  }
  const sourceBranch = (input.sourceBranch || 'source').trim()
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(sourceBranch) || sourceBranch.includes('..')) throw new Error(`invalid source branch ${input.sourceBranch}`)
  const outputDir = (input.outputDir || 'dist').trim().replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(outputDir) || outputDir.split('/').some(p => p === '..' || p === '') || outputDir.startsWith('/')) throw new Error(`output_dir must be a relative directory: ${input.outputDir}`)
  const buildCommand = (input.buildCommand || 'npm ci && npm run build').trim()
  if (!buildCommand || buildCommand.length > 500) throw new Error('build_command must be 1-500 characters')
  return { sourceBranch, buildCommand, outputDir }
}

async function okJson<T>(request: GithubRequest, url: string, step: string, init?: RequestInit): Promise<T> {
  const res = await request(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`${step} failed: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}`)
  }
  return await res.json() as T
}

export async function buildAndPublishSite(request: GithubRequest, input: BuildSiteInput): Promise<BuildSiteResult> {
  const { sourceBranch, buildCommand, outputDir } = validateBuildInput(input)
  const invocationId = input.invocationId || newInvocationId('site')
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }
  const wfBase = `${API}/repos/${input.workflowOwner}/${input.workflowRepo}`
  const run = await dispatchAndWait(request, {
    owner: input.workflowOwner, repo: input.workflowRepo, token: input.token, workflow: SITE_BUILD_WORKFLOW,
    inputs: { source_repo: `${input.owner}/${input.repo}`, source_ref: sourceBranch, build_command: buildCommand, output_dir: outputDir, invocation_id: invocationId },
    invocationId, maxWaitMs: SITE_BUILD_MAX_WAIT_MS, signal: input.signal, sleep: input.sleep, now: input.now,
  })
  if (run.conclusion !== 'success') throw new Error(`build run #${run.run_number} concluded "${run.conclusion}"; nothing was published. Logs: ${run.html_url}`)

  const prefix = `builds/${invocationId}/`
  const tree = await okJson<{ tree?: Array<{ path: string; type: string; sha: string }>; truncated?: boolean }>(request, `${wfBase}/git/trees/${SITE_BUILD_MIRROR_BRANCH}?recursive=1`, 'listing the build output', { headers, cache: 'no-store' })
  // A truncated listing may be missing files of this build; publishing it would ship a broken site (#169).
  if (tree.truncated) throw new Error(`build run #${run.run_number} succeeded, but GitHub returned a truncated listing of ${SITE_BUILD_MIRROR_BRANCH}, so the complete output cannot be confirmed; nothing was published. Run: ${run.html_url}`)
  const blobs = (tree.tree ?? []).filter(e => e.type === 'blob' && e.path.startsWith(prefix))
  if (!blobs.length) throw new Error(`build run #${run.run_number} succeeded but ${prefix} on ${SITE_BUILD_MIRROR_BRANCH} is empty${tree.truncated ? ' (tree listing truncated)' : ''}`)
  if (blobs.length > BUILD_PUBLISH_LIMITS.maxFiles) throw new Error(`the build produced ${blobs.length} files; the limit is ${BUILD_PUBLISH_LIMITS.maxFiles}`)
  const files: PublishFile[] = []
  for (const blob of blobs) {
    const data = await okJson<{ content: string; encoding: string }>(request, `${wfBase}/git/blobs/${blob.sha}`, `reading ${blob.path}`, { headers })
    files.push({ path: blob.path.slice(prefix.length), content: data.content.replace(/\n/g, ''), encoding: 'base64' })
  }

  const publish = await publishSite(request, {
    owner: input.owner, repo: input.repo, token: input.token, files,
    message: input.message || `Publish build of ${sourceBranch} (${invocationId})`,
    branch: input.publishBranch, limits: BUILD_PUBLISH_LIMITS,
  })
  return { run, files: files.length, publish }
}
