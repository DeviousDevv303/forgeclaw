// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// NEXUS/ForgeClaw GitHub repository operations (browser → api.github.com).
// Separate from Local/Ollama/Termux inference paths.

import {
  createClient,
  getRepo,
  getLatestCommit,
  getFileContent,
  createOrUpdateFile,
  createBranch,
} from './github'
import { resolveGithubToken } from './githubAuth'

export interface RepoReadResult {
  owner: string
  repo: string
  defaultBranch: string
  htmlUrl: string
  headSha: string
  headShaShort: string
  samplePath: string
  samplePreview: string
  sampleBytes: number
  tokenSource: 'env' | 'localStorage' | 'none'
}

export interface RepoWriteResult {
  owner: string
  repo: string
  branch: string
  path: string
  commitSha: string
  commitShaShort: string
  contentSha: string
  htmlUrl: string
}

const DEFAULT_SAMPLES = ['package.json', 'README.md', 'src/lib/github.ts']

function requireToken(token?: string): string {
  const t = (token || resolveGithubToken()).trim()
  if (!t) {
    throw new Error(
      'GitHub PAT missing. Set VITE_GITHUB_TOKEN in local .env (dev) or SAVE a PAT in Settings (stored as gh_token).',
    )
  }
  return t
}

/** Authenticated read: metadata, default branch, HEAD, sample file. */
export async function readForgeclawRepo(options?: {
  owner?: string
  repo?: string
  samplePath?: string
  token?: string
}): Promise<RepoReadResult> {
  const token = requireToken(options?.token)
  const owner = (options?.owner || 'DeviousDevv303').trim()
  const repo = (options?.repo || 'forgeclaw').trim()
  const octokit = createClient(token)
  const meta = await getRepo(octokit, owner, repo)
  const headSha = await getLatestCommit(octokit, owner, repo, meta.defaultBranch)

  const paths = options?.samplePath
    ? [options.samplePath, ...DEFAULT_SAMPLES]
    : DEFAULT_SAMPLES
  let samplePath = paths[0]
  let content = ''
  let lastErr: unknown
  for (const p of paths) {
    try {
      const file = await getFileContent(octokit, owner, repo, p, meta.defaultBranch)
      content = file.content
      samplePath = p
      lastErr = undefined
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!content && lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))

  const { githubTokenSource } = await import('./githubAuth')
  return {
    owner: meta.owner,
    repo: meta.repo,
    defaultBranch: meta.defaultBranch,
    htmlUrl: meta.htmlUrl,
    headSha,
    headShaShort: headSha.slice(0, 12),
    samplePath,
    samplePreview: content.length > 1200 ? content.slice(0, 1200) + '\n… [truncated]' : content,
    sampleBytes: new TextEncoder().encode(content).byteLength,
    tokenSource: githubTokenSource(),
  }
}

/**
 * Create or update a file and push a commit.
 * Requires explicitWriteAuthorized === true (operator instruction).
 * Prefer a feature branch; writing main requires allowMainWrite.
 */
export async function commitAndPushFile(options: {
  path: string
  content: string
  message: string
  branch: string
  explicitWriteAuthorized: boolean
  allowMainWrite?: boolean
  owner?: string
  repo?: string
  token?: string
  createBranchFromDefault?: boolean
}): Promise<RepoWriteResult> {
  if (!options.explicitWriteAuthorized) {
    throw new Error('Refusing GitHub write: explicitWriteAuthorized is required.')
  }
  const branch = options.branch.trim()
  if (!branch) throw new Error('branch is required for write')
  if (branch === 'main' && !options.allowMainWrite) {
    throw new Error('Refusing write to main without allowMainWrite. Use a feature branch.')
  }

  const token = requireToken(options.token)
  const owner = (options.owner || 'DeviousDevv303').trim()
  const repo = (options.repo || 'forgeclaw').trim()
  const octokit = createClient(token)
  const meta = await getRepo(octokit, owner, repo)

  if (options.createBranchFromDefault) {
    try {
      await createBranch(octokit, owner, repo, branch, meta.defaultBranch)
    } catch (err) {
      // Branch may already exist
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already exists|Reference already exists/i.test(msg)) {
        // continue if get branch works
        try {
          await getLatestCommit(octokit, owner, repo, branch)
        } catch {
          throw err
        }
      }
    }
  }

  let sha: string | undefined
  try {
    const existing = await getFileContent(octokit, owner, repo, options.path, branch)
    sha = existing.sha
  } catch {
    sha = undefined
  }

  const result = await createOrUpdateFile(
    octokit,
    owner,
    repo,
    options.path,
    options.content,
    options.message,
    branch,
    sha,
  )

  return {
    owner,
    repo,
    branch,
    path: options.path,
    commitSha: result.commitSha,
    commitShaShort: result.commitSha.slice(0, 12),
    contentSha: result.sha,
    htmlUrl: `https://github.com/${owner}/${repo}/commit/${result.commitSha}`,
  }
}
