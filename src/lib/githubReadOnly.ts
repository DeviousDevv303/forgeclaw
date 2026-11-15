// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Read-only GitHub access — thin wrapper over githubRepoOps + auth resolver.

import { readForgeclawRepo, type RepoReadResult } from './githubRepoOps'
import { resolveGithubToken, githubTokenSource } from './githubAuth'

export type { RepoReadResult as RepoReadSnapshot }

export async function readRepoSnapshot(
  token: string,
  owner: string,
  repo: string,
  samplePath?: string,
): Promise<RepoReadResult> {
  return readForgeclawRepo({
    token: token || resolveGithubToken(),
    owner,
    repo,
    samplePath,
  })
}

export function formatRepoSnapshotForContext(snapshot: RepoReadResult): string {
  return [
    'GITHUB REPOSITORY SNAPSHOT (read-only, authenticated)',
    `repo: ${snapshot.owner}/${snapshot.repo}`,
    `url: ${snapshot.htmlUrl}`,
    `defaultBranch: ${snapshot.defaultBranch}`,
    `HEAD: ${snapshot.headSha} (${snapshot.headShaShort})`,
    `tokenSource: ${snapshot.tokenSource}`,
    `sampleFile: ${snapshot.samplePath} (${snapshot.sampleBytes} bytes)`,
    '--- sample preview ---',
    snapshot.samplePreview,
    '--- end sample ---',
    'Informational only. Do not invent file contents beyond this snapshot.',
  ].join('\n')
}

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

export function isExplicitRepoWriteRequest(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(commit|push)\b.*\b(github|repo|repository)\b/.test(t) ||
    /\b(update|write|modify)\b.*\b(repo|repository|github)\b/.test(t) ||
    /\bdeliver\b.*\b(to\s+)?github\b/.test(t)
  )
}

export { resolveGithubToken, githubTokenSource }
