// src/lib/github.ts
//
// ForgeClaw GitHub Autonomous Connector
// Scope: Full CRUD on repos, files, branches, PRs, workflows
// Error handling: rate-limit aware, typed errors, retry-ready

import { Octokit } from '@octokit/rest'

// =============================================================================
// GUARDIAN AUTHORITY GATE
// =============================================================================

export class GuardianAuthorityError extends Error {
  constructor(operation: string) {
    super(
      `[GUARDIAN BLOCK] Operation "${operation}" requires a valid Guardian-signed token. ` +
        `Obtain token from Guardian review before retry. ` +
        `Token format: forge-guardian-{min 48 chars} — available from Guardian approval comment.`
    )
    this.name = 'GuardianAuthorityError'
  }
}

const GUARDIAN_TOKEN_PREFIX = 'forge-guardian-'

function validateGuardianToken(
  token: string | undefined,
  operation: string
): asserts token is string {
  if (!token || !token.startsWith(GUARDIAN_TOKEN_PREFIX) || token.length < 48) {
    throw new GuardianAuthorityError(operation)
  }
}

// =============================================================================
// TYPES
// =============================================================================

export interface GithubError {
  status: number
  message: string
  documentation_url?: string
  retryAfter?: number // seconds from Rate-Limit-Reset header
}

export interface RepoMeta {
  owner: string
  repo: string
  defaultBranch: string
  htmlUrl: string
}

export interface TreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

export interface PullRequestMeta {
  number: number
  title: string
  body?: string
  head: string
  base: string
  htmlUrl: string
  state: string
}

export interface BranchRef {
  ref: string
  sha: string
}

// =============================================================================
// CLIENT FACTORY
// =============================================================================

export function createClient(token: string): Octokit {
  return new Octokit({ auth: token })
}

// =============================================================================
// REPO METADATA
// =============================================================================

export async function getRepo(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoMeta> {
  const { data } = await octokit.repos.get({ owner, repo })
  return {
    owner: data.owner.login,
    repo: data.name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
  }
}

// =============================================================================
// FILE OPERATIONS
// =============================================================================

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ content: string; sha: string }> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  })

  if ('content' in data && !Array.isArray(data)) {
    const decoded = decodeURIComponent(escape(atob(data.content)))
    return { content: decoded, sha: data.sha }
  }
  throw new Error(`Path ${path} is a directory, not a file`)
}

export async function getTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<TreeItem[]> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  })

  if (Array.isArray(data)) {
    return data.map((item) => ({
      path: item.path,
      type: item.type as 'blob' | 'tree',
      sha: item.sha,
      size: item.size,
    }))
  }
  throw new Error(`Path ${path} is a file, not a directory`)
}

export async function createOrUpdateFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  const encoded = btoa(unescape(encodeURIComponent(content)))
  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encoded,
    branch,
    sha, // required for updates; omit for creates
  })
  return {
    sha: data.content?.sha || '',
    commitSha: data.commit?.sha || '',
  }
}

// Simple pushFile helper — creates/updates file with auto-encoded content
export async function pushFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  token?: string
): Promise<{ sha: string; commitSha: string }> {
  if (!token) {
    throw new Error('GitHub token required for pushFile')
  }
  const octokit = createClient(token)
  return createOrUpdateFile(octokit, owner, repo, path, content, message, branch)
}

export async function deleteFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string,
  branch?: string,
  guardianToken?: string // NEW
): Promise<void> {
  validateGuardianToken(guardianToken, 'deleteFile')
  await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha,
    branch,
  })
}

// =============================================================================
// BRANCH OPERATIONS
// =============================================================================

export async function getLatestCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const { data } = await octokit.repos.getBranch({ owner, repo, branch })
  return data.commit.sha
}

export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  newBranch: string,
  fromBranch?: string
): Promise<BranchRef> {
  const base = fromBranch || (await getRepo(octokit, owner, repo)).defaultBranch
  const baseSha = await getLatestCommit(octokit, owner, repo, base)

  const { data } = await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${newBranch}`,
    sha: baseSha,
  })
  return { ref: data.ref, sha: data.object.sha }
}

// =============================================================================
// PULL REQUESTS
// =============================================================================

export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string
): Promise<PullRequestMeta> {
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
  })
  return {
    number: data.number,
    title: data.title,
    body: data.body || undefined,
    head: data.head.ref,
    base: data.base.ref,
    htmlUrl: data.html_url,
    state: data.state,
  }
}

export async function mergePullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitTitle?: string
): Promise<{ merged: boolean; message: string }> {
  try {
    const { data } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      commit_title: commitTitle,
    })
    return { merged: data.merged, message: data.message }
  } catch (err: any) {
    return { merged: false, message: err.message || 'Merge failed' }
  }
}

// =============================================================================
// WORKFLOWS
// =============================================================================

export async function triggerWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  branch?: string,
  inputs?: Record<string, string>
): Promise<{ runId: number; htmlUrl: string }> {
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref: branch || 'main',
    inputs,
  })
  // GitHub returns 204 No Content; fetch latest run manually
  const runs = await octokit.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowId,
    per_page: 1,
  })
  const run = runs.data.workflow_runs[0]
  return { runId: run.id, htmlUrl: run.html_url }
}

export async function listWorkflowRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  branch?: string,
  status?: string
): Promise<Array<{ id: number; status: string; conclusion?: string; htmlUrl: string }>> {
  const { data } = await octokit.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowId,
    branch,
    status: status as any,
    per_page: 10,
  })
  return data.workflow_runs.map((run) => ({
    id: run.id,
    status: run.status || '',
    conclusion: run.conclusion || undefined,
    htmlUrl: run.html_url,
  }))
}

// =============================================================================
// AUTONOMOUS DEPLOY
// =============================================================================

export interface DeployPayload {
  owner: string
  repo: string
  files: Array<{ path: string; content: string }>
  commitMessage: string
  prTitle?: string
  prBody?: string
  branchName?: string
  autoMerge?: boolean
  guardianToken?: string // NEW — required if autoMerge is true
}

/**
 * End-to-end autonomous deployment:
 * 1. Create branch
 * 2. Push all files
 * 3. Open PR
 * 4. (Optional) Merge PR
 */
export async function autonomousDeploy(
  octokit: Octokit,
  payload: DeployPayload
): Promise<{
  branch: string
  prNumber?: number
  prUrl?: string
  merged?: boolean
  commitSha?: string
}> {
  const {
    owner,
    repo,
    files,
    commitMessage,
    prTitle,
    prBody,
    branchName = `forgeclaw-deploy-${Date.now()}`,
    autoMerge = false,
    guardianToken,
  } = payload

  // 1. Create branch
  await createBranch(octokit, owner, repo, branchName)

  // 2. Push files
  for (const file of files) {
    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      file.path,
      file.content,
      `${commitMessage} — ${file.path}`,
      branchName
    )
  }

  // 3. Open PR if title provided
  let pr: PullRequestMeta | undefined
  if (prTitle) {
    pr = await createPullRequest(
      octokit,
      owner,
      repo,
      prTitle,
      branchName,
      (await getRepo(octokit, owner, repo)).defaultBranch,
      prBody
    )
  }

  // 4. Auto-merge if requested
  let merged = false
  if (autoMerge && pr) {
    validateGuardianToken(guardianToken, 'autonomousDeploy:autoMerge')
    // Poll for mergeability (GitHub sets this async)
    let attempts = 0
    while (attempts < 10) {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pr.number,
      })
      if (data.mergeable === true) {
        const result = await mergePullRequest(octokit, owner, repo, pr.number)
        merged = result.merged
        break
      }
      if (data.mergeable === false) {
        throw new Error(`PR #${pr.number} has merge conflicts`)
      }
      // null = GitHub still computing; wait and retry
      await new Promise((r) => setTimeout(r, 1000))
      attempts++
    }
  }

  return {
    branch: branchName,
    prNumber: pr?.number,
    prUrl: pr?.htmlUrl,
    merged,
    commitSha: pr ? await getLatestCommit(octokit, owner, repo, branchName) : undefined,
  }
}

// =============================================================================
// ERROR HELPERS
// =============================================================================

export function isRateLimitError(err: unknown): err is GithubError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    (err as GithubError).status === 403
  )
}

export function extractRetryAfter(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'retryAfter' in err) {
    return (err as GithubError).retryAfter
  }
  return undefined
}
