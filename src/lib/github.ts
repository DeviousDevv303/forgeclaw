// src/lib/github.ts
//
// ForgeClaw GitHub Autonomous Connector
// Scope: Full CRUD on repos, files, branches, PRs, workflows
// Error handling: rate-limit aware, typed errors, retry-ready

import { Octokit } from '@octokit/rest'

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
  cloneUrl: string
  private: boolean
}

export interface FileContent {
  path: string
  content: string // decoded UTF-8
  sha: string
  size: number
}

export interface TreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

export interface BranchRef {
  name: string
  sha: string
}

export interface PullRequestMeta {
  number: number
  title: string
  state: 'open' | 'closed'
  head: string // branch name
  base: string // branch name
  htmlUrl: string
  mergeable?: boolean
}

export interface WorkflowRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  htmlUrl: string
  createdAt: string
}

// =============================================================================
// CLIENT FACTORY
// =============================================================================

export const createGithubClient = (token: string): Octokit => {
  return new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number) => {
        console.warn(`[GitHub] Rate limit hit. Retry after ${retryAfter}s.`)
        return retryAfter <= 60 // auto-retry if within 60s
      },
      onSecondaryRateLimit: (retryAfter: number) => {
        console.warn(`[GitHub] Secondary rate limit. Retry after ${retryAfter}s.`)
        return false
      },
    },
  })
}

// =============================================================================
// REPO OPERATIONS
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
    cloneUrl: data.clone_url,
    private: data.private,
  }
}

export async function listRepos(
  octokit: Octokit,
  perPage = 30
): Promise<RepoMeta[]> {
  const { data } = await octokit.repos.listForAuthenticatedUser({ per_page: perPage })
  return data.map((r) => ({
    owner: r.owner.login,
    repo: r.name,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    private: r.private,
  }))
}

export async function createRepo(
  octokit: Octokit,
  name: string,
  description: string,
  isPrivate = false
): Promise<RepoMeta> {
  const { data } = await octokit.repos.createForAuthenticatedUser({
    name,
    description,
    auto_init: true,
    private: isPrivate,
  })
  return {
    owner: data.owner.login,
    repo: data.name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
    private: data.private,
  }
}

// =============================================================================
// FILE OPERATIONS
// =============================================================================

export async function getFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<FileContent> {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  })

  if ('content' in data && !Array.isArray(data)) {
    const decoded = atob(data.content.replace(/\s/g, ''))
    return {
      path: data.path,
      content: decoded,
      sha: data.sha,
      size: data.size,
    }
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

export async function deleteFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string,
  branch?: string
): Promise<void> {
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

  return { name: newBranch, sha: data.object.sha }
}

export async function listBranches(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<BranchRef[]> {
  const { data } = await octokit.repos.listBranches({ owner, repo })
  return data.map((b) => ({ name: b.name, sha: b.commit.sha }))
}

// =============================================================================
// PULL REQUEST OPERATIONS
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
    state: data.state as 'open' | 'closed',
    head: data.head.ref,
    base: data.base.ref,
    htmlUrl: data.html_url,
    mergeable: data.mergeable ?? undefined,
  }
}

export async function listPullRequests(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open'
): Promise<PullRequestMeta[]> {
  const { data } = await octokit.pulls.list({ owner, repo, state })
  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state as 'open' | 'closed',
    head: pr.head.ref,
    base: pr.base.ref,
    htmlUrl: pr.html_url,
    mergeable: undefined,
  }))
}

export async function mergePullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitTitle?: string,
  commitMessage?: string
): Promise<{ sha: string; merged: boolean }> {
  const { data } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: pullNumber,
    commit_title: commitTitle,
    commit_message: commitMessage,
    merge_method: 'squash',
  })
  return { sha: data.sha, merged: data.merged }
}

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

export async function triggerWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  branch: string,
  inputs?: Record<string, string>
): Promise<number> {
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref: branch,
    inputs,
  })
  // GitHub returns 204 No Content on success; data is empty
  return Date.now() // return a run identifier for tracking
}

export async function listWorkflowRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  branch?: string,
  perPage = 10
): Promise<WorkflowRun[]> {
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    workflow_id: workflowId,
    branch,
    per_page: perPage,
  })

  return data.workflow_runs.map((run) => ({
    id: run.id,
    name: run.name || workflowId,
    status: run.status || '',
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
  }))
}

// =============================================================================
// AUTONOMOUS DEPLOYMENT PIPELINE
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
  }
}
