// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Static-site publishing to GitHub Pages ──────────────────────────────────
// github_write_file makes one commit per file, so a ten-file site cost ten commits, ten Pages builds
// and ten chances to stop half-published. publishSite writes every file in ONE commit through the git
// data API, then makes sure Pages serves that branch. It never touches the default branch, workflow
// files, or ForgeClaw's own repository (whose gh-pages branch IS the deployed ForgeClaw app).

import { CANONICAL_IDENTITY } from './canonicalIdentity'

export type GithubRequest = (url: string, init?: RequestInit) => Promise<Response>

export interface PublishFile { path: string; content: string }

export interface PublishSiteInput {
  owner: string
  repo: string
  token: string
  files: PublishFile[]
  message: string
  /** Defaults to gh-pages. Never the repository's default branch. */
  branch?: string
}

export interface PublishSiteResult {
  commitSha: string
  /** Branch head before this commit; undefined when the branch was created. */
  beforeSha?: string
  branch: string
  createdBranch: boolean
  files: string[]
  pagesUrl: string
  /** What happened to the Pages configuration. */
  pages: 'enabled' | 'already-serving' | 'serving-other-source'
  pagesSource?: string
}

export const PUBLISH_MAX_FILES = 100
export const PUBLISH_MAX_TOTAL_BYTES = 2_000_000
export const DEFAULT_PUBLISH_BRANCH = 'gh-pages'
/**
 * Trailer on every publish commit. An existing branch is only advanced when its head carries it, so an
 * autonomous publish can never overwrite a site branch ForgeClaw did not create (another project's live site).
 */
export const SITE_COMMIT_TRAILER = 'ForgeClaw-Site: true'
const API = 'https://api.github.com'

/** Repository-relative, no traversal, nothing that changes the repository's control plane. */
export function validatePublishPath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) throw new Error('every file needs a non-empty path')
  const clean = path.trim().replace(/^\.\/+/, '')
  if (clean.startsWith('/') || clean.includes('\\')) throw new Error(`path must be repository-relative: ${path}`)
  const parts = clean.split('/')
  if (parts.some(p => p === '' || p === '.' || p === '..')) throw new Error(`path may not contain empty, "." or ".." segments: ${path}`)
  const lower = clean.toLowerCase()
  // A workflow pushed to any branch runs on that branch's push events with the repository token.
  if (lower.startsWith('.github/') || lower.startsWith('.git/') || lower === '.gitmodules') {
    throw new Error(`refusing to publish control-plane path ${path}`)
  }
  return clean
}

function isCanonicalRepo(owner: string, repo: string): boolean {
  return owner.toLowerCase() === CANONICAL_IDENTITY.owner.toLowerCase()
    && repo.toLowerCase() === CANONICAL_IDENTITY.repository.toLowerCase()
}

export function validatePublishInput(input: PublishSiteInput): { branch: string; files: PublishFile[] } {
  if (!input.token) throw new Error('No GitHub token configured. Add gh_token in settings.')
  if (!input.owner || !input.repo) throw new Error('owner and repo are required')
  if (isCanonicalRepo(input.owner, input.repo)) {
    throw new Error(`refusing to publish into ${CANONICAL_IDENTITY.fullRepository}: its gh-pages branch is the deployed ForgeClaw app. Publish the site to its own repository (github_create_repo).`)
  }
  const branch = (input.branch || DEFAULT_PUBLISH_BRANCH).trim().replace(/^(?:refs\/)?heads\//, '')
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes('..')) throw new Error(`invalid branch name: ${input.branch}`)
  if (['main', 'master'].includes(branch.toLowerCase())) throw new Error(`refusing to publish to ${branch}; use a site branch such as gh-pages`)
  if (!Array.isArray(input.files) || input.files.length === 0) throw new Error('files must be a non-empty array of {path, content}')
  if (input.files.length > PUBLISH_MAX_FILES) throw new Error(`at most ${PUBLISH_MAX_FILES} files per publish`)
  const seen = new Set<string>()
  let total = 0
  const files = input.files.map(file => {
    const path = validatePublishPath(file?.path)
    if (typeof file.content !== 'string') throw new Error(`content of ${path} must be a string`)
    if (seen.has(path)) throw new Error(`duplicate path ${path}`)
    seen.add(path)
    total += new TextEncoder().encode(file.content).length
    return { path, content: file.content }
  })
  if (total > PUBLISH_MAX_TOTAL_BYTES) throw new Error(`site is ${total} bytes; the limit per publish is ${PUBLISH_MAX_TOTAL_BYTES}`)
  return { branch, files }
}

async function githubError(res: Response, step: string): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { message?: string }
  const hint = res.status === 403 || res.status === 404
    ? ' (check that the token has repo/contents write access to this repository)'
    : ''
  return new Error(`${step} failed: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}${hint}`)
}

async function json<T>(request: GithubRequest, url: string, step: string, init?: RequestInit): Promise<T> {
  const res = await request(url, init)
  if (!res.ok) throw await githubError(res, step)
  return await res.json() as T
}

/** Publish all files as a single commit on a site branch and make sure Pages serves it. */
export async function publishSite(request: GithubRequest, input: PublishSiteInput): Promise<PublishSiteResult> {
  const { branch, files } = validatePublishInput(input)
  const { owner, repo } = input
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const base = `${API}/repos/${owner}/${repo}`

  const repoInfo = await json<{ default_branch?: string; private?: boolean }>(request, base, 'reading the repository', { headers })
  if (repoInfo.default_branch && repoInfo.default_branch.toLowerCase() === branch.toLowerCase()) {
    throw new Error(`refusing to publish to ${branch}: it is the default branch of ${owner}/${repo}`)
  }

  const refRes = await request(`${base}/git/ref/heads/${branch}`, { headers })
  let beforeSha: string | undefined
  let baseTree: string | undefined
  if (refRes.ok) {
    beforeSha = ((await refRes.json()) as { object?: { sha?: string } }).object?.sha
    if (beforeSha) {
      const head = await json<{ tree?: { sha?: string }; message?: string }>(request, `${base}/git/commits/${beforeSha}`, 'reading the branch head', { headers })
      if (!(head.message || '').includes(SITE_COMMIT_TRAILER)) {
        throw new Error(`refusing to publish to ${owner}/${repo}@${branch}: that branch already exists and its head ${beforeSha.slice(0, 7)} was not published by ForgeClaw, so it may be another live site. Publish to a new branch or a new repository, or ask the operator.`)
      }
      baseTree = head.tree?.sha
    }
  } else if (refRes.status !== 404) {
    throw await githubError(refRes, `reading branch ${branch}`)
  }

  if (!beforeSha) {
    if (!files.some(f => f.path.toLowerCase() === 'index.html')) throw new Error(`a new site branch needs an index.html at its root; none of the ${files.length} file(s) is index.html`)
    // Pages runs Jekyll by default, which silently drops _-prefixed folders (_next/, _assets/).
    if (!files.some(f => f.path === '.nojekyll')) files.push({ path: '.nojekyll', content: '' })
  }

  const tree = await json<{ sha: string }>(request, `${base}/git/trees`, 'creating the file tree', {
    method: 'POST', headers,
    body: JSON.stringify({
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    }),
  })
  const commit = await json<{ sha: string }>(request, `${base}/git/commits`, 'creating the commit', {
    method: 'POST', headers,
    body: JSON.stringify({ message: `${input.message.trim() || 'Publish site'}\n\n${SITE_COMMIT_TRAILER}`, tree: tree.sha, parents: beforeSha ? [beforeSha] : [] }),
  })
  if (beforeSha) {
    // force:false — if someone else moved the branch meanwhile, fail instead of discarding their commit.
    await json(request, `${base}/git/refs/heads/${branch}`, `moving ${branch}`, { method: 'PATCH', headers, body: JSON.stringify({ sha: commit.sha, force: false }) })
  } else {
    await json(request, `${base}/git/refs`, `creating ${branch}`, { method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) })
  }

  const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`
  const pagesRes = await request(`${base}/pages`, { headers })
  if (pagesRes.ok) {
    const site = await pagesRes.json() as { html_url?: string; source?: { branch?: string; path?: string } }
    const sourceBranch = site.source?.branch
    // An existing site serving another source is reported, not repointed: that would unpublish it.
    return {
      commitSha: commit.sha, beforeSha, branch, createdBranch: !beforeSha, files: files.map(f => f.path),
      pagesUrl: site.html_url || pagesUrl,
      pages: sourceBranch === branch ? 'already-serving' : 'serving-other-source',
      pagesSource: sourceBranch ? `${sourceBranch}${site.source?.path || ''}` : undefined,
    }
  }
  if (pagesRes.status !== 404) throw await githubError(pagesRes, 'reading the Pages configuration')
  const created = await json<{ html_url?: string }>(request, `${base}/pages`, 'enabling GitHub Pages', {
    method: 'POST', headers, body: JSON.stringify({ source: { branch, path: '/' } }),
  })
  return { commitSha: commit.sha, beforeSha, branch, createdBranch: !beforeSha, files: files.map(f => f.path), pagesUrl: created.html_url || pagesUrl, pages: 'enabled' }
}

export interface PagesStatus { status: string; url: string; commit?: string; error?: string; updatedAt?: string }

/** The latest Pages build: queued/building/built/errored. A publish is not verified until this says built for its commit. */
export async function pagesStatus(request: GithubRequest, owner: string, repo: string, token: string): Promise<PagesStatus> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `token ${token}`
  const base = `${API}/repos/${owner}/${repo}/pages`
  const site = await json<{ html_url?: string; status?: string }>(request, base, 'reading the Pages site', { headers })
  const res = await request(`${base}/builds/latest`, { headers })
  if (res.status === 404) return { status: site.status || 'not built yet', url: site.html_url || '' }
  if (!res.ok) throw await githubError(res, 'reading the latest Pages build')
  const build = await res.json() as { status?: string; commit?: string; error?: { message?: string | null }; updated_at?: string }
  return { status: build.status || 'unknown', url: site.html_url || '', commit: build.commit, error: build.error?.message || undefined, updatedAt: build.updated_at }
}

export interface CreateRepoInput { token: string; name: string; description?: string; private?: boolean }

/** Create a repository under the token's user account. Pages on free plans needs a public repository. */
export async function createRepo(request: GithubRequest, input: CreateRepoInput): Promise<{ owner: string; repo: string; url: string; defaultBranch: string }> {
  if (!input.token) throw new Error('No GitHub token configured. Add gh_token in settings.')
  const name = (input.name || '').trim()
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') throw new Error(`invalid repository name: ${input.name}`)
  const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const res = await request(`${API}/user/repos`, {
    method: 'POST', headers,
    // auto_init gives the repo a main branch, so the site branch is never the default branch.
    body: JSON.stringify({ name, description: input.description || '', private: !!input.private, auto_init: true }),
  })
  if (res.status === 422) {
    const body = await res.json().catch(() => ({})) as { message?: string; errors?: Array<{ message?: string }> }
    throw new Error(`repository ${name} was not created: ${body.errors?.[0]?.message || body.message || 'GitHub 422'}`)
  }
  if (!res.ok) throw await githubError(res, 'creating the repository')
  const repo = await res.json() as { name: string; html_url: string; default_branch?: string; owner?: { login?: string } }
  return { owner: repo.owner?.login || '', repo: repo.name, url: repo.html_url, defaultBranch: repo.default_branch || 'main' }
}
