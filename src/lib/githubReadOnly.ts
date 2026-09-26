// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Read-only GitHub repository access for browser/Pages (NEXUS-assisted inspect).
//
// SECURITY (browser-hosted PAT):
// - The GitHub PAT is supplied by the operator via Settings and stored only in
//   browser localStorage under the existing key `gh_token`.
// - This module never hard-codes, logs, or returns the raw token.
// - localStorage is origin-scoped but readable by any script on this origin
//   (XSS risk). It is NOT equivalent to a server-side secret store.
// - Prefer a fine-scoped classic/fine-grained PAT (contents:read for read-only).
// - For production write access, prefer a server-side proxy so the PAT never
//   touches the browser; write APIs remain gated until that path is verified.
// - Do not commit tokens. Clearing site data removes the stored PAT.

import {
  createClient,
  getRepo,
  getLatestCommit,
  getFileContent,
} from './github'

export interface RepoReadSnapshot {
  owner: string
  repo: string
  defaultBranch: string
  htmlUrl: string
  headSha: string
  headShaShort: string
  samplePath: string
  samplePreview: string
  sampleBytes: number
}

const DEFAULT_SAMPLE_PATHS = [
  'package.json',
  'README.md',
  'src/lib/github.ts',
]

/**
 * Authenticated read-only probe against a repository.
 * Uses the operator-provided PAT at call time only (not persisted here).
 */
export async function readRepoSnapshot(
  token: string,
  owner: string,
  repo: string,
  samplePath?: string,
): Promise<RepoReadSnapshot> {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error('GitHub PAT is not set. Enter it in Settings and press SAVE.')
  }
  if (trimmed.startsWith('ghp_') && trimmed.length < 20) {
    throw new Error('GitHub PAT looks incomplete.')
  }

  const octokit = createClient(trimmed)
  const meta = await getRepo(octokit, owner, repo)
  const headSha = await getLatestCommit(octokit, owner, repo, meta.defaultBranch)

  const paths = samplePath ? [samplePath, ...DEFAULT_SAMPLE_PATHS] : DEFAULT_SAMPLE_PATHS
  let chosen = samplePath || DEFAULT_SAMPLE_PATHS[0]
  let content = ''
  let lastError: unknown
  for (const path of paths) {
    try {
      const file = await getFileContent(octokit, owner, repo, path, meta.defaultBranch)
      content = file.content
      chosen = path
      lastError = undefined
      break
    } catch (err) {
      lastError = err
    }
  }
  if (!content && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  const preview = content.length > 1200 ? content.slice(0, 1200) + '\n… [truncated]' : content
  return {
    owner: meta.owner,
    repo: meta.repo,
    defaultBranch: meta.defaultBranch,
    htmlUrl: meta.htmlUrl,
    headSha,
    headShaShort: headSha.slice(0, 12),
    samplePath: chosen,
    samplePreview: preview,
    sampleBytes: new TextEncoder().encode(content).byteLength,
  }
}

/** Format a snapshot for UI or for injection into a NEXUS prompt (no secrets). */
export function formatRepoSnapshotForContext(snapshot: RepoReadSnapshot): string {
  return [
    'GITHUB REPOSITORY SNAPSHOT (read-only, authenticated via operator PAT in this browser)',
    'repo: ' + snapshot.owner + '/' + snapshot.repo,
    'url: ' + snapshot.htmlUrl,
    'defaultBranch: ' + snapshot.defaultBranch,
    'HEAD: ' + snapshot.headSha + ' (' + snapshot.headShaShort + ')',
    'sampleFile: ' + snapshot.samplePath + ' (' + snapshot.sampleBytes + ' bytes)',
    '--- sample preview ---',
    snapshot.samplePreview,
    '--- end sample ---',
    'This context is informational only. Do not invent file contents beyond this snapshot.',
  ].join('\n')
}

/** Detect explicit operator requests to inspect the configured GitHub repo. */
export function isExplicitRepoInspectRequest(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\binspect\b.*\b(repo|repository|forgeclaw)\b/.test(t) ||
    /\b(repo|repository)\b.*\binspect\b/.test(t) ||
    /\bgithub\s+(status|read|inspect)\b/.test(t) ||
    /\bread\b.*\b(forgeclaw\s+)?(repo|repository|package\.json)\b/.test(t) ||
    /\bshow\b.*\b(current\s+)?(commit|branch|repo)\b/.test(t)
  )
}
