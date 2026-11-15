// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── One-tap SEND of the Nexus store export ─────────────────────────────────
// EXPORT NEXUS STORE downloads nexus-store-export.json; on the operator's phone that file then
// has to be found and attached by hand. SEND removes the file handling: it commits the exact
// same payload buildNexusStoreExport produces into a PRIVATE repository under the operator's
// own GitHub account, where a lane can pull it directly. Privacy is structural, not a promise:
// the destination repository is verified private before any write, and a repository that is —
// or becomes — public refuses the send with nothing written. The export builder's fail-closed
// credential abort is inherited unchanged: a credential-looking record value stops the send
// before a single network call. The GitHub token never leaves the app; it is only the
// Authorization header on these calls (credentials law).

import { buildNexusStoreExport, type NexusStoreStorage } from './corpus'
import { createRepo, describeTokenProblem, type GithubRequest } from './githubPublish'

/**
 * Why this default: a dedicated single-purpose repository keeps the operator's approved
 * knowledge out of every other repo's history and makes the privacy check unambiguous —
 * one repo, one file, verified private on every send.
 */
export const DEFAULT_NEXUS_SEND_REPO = 'nexus-exports'
/** Why fixed: the file name is the contract with the pull side, which fetches this exact path. */
export const NEXUS_SEND_FILE_PATH = 'nexus-store-export.json'
/**
 * Why 900_000: the GitHub Contents API refuses files around 1 MB. Failing here with a named
 * reason (and the manual EXPORT fallback) beats surfacing a raw 422 from the PUT.
 */
export const NEXUS_SEND_MAX_BYTES = 900_000

const GITHUB_API = 'https://api.github.com'
const REPO_DESCRIPTION = 'ForgeClaw Nexus store exports — private staging for Nexus training data'
/** Why: GitHub accepts only this repo-name shape; validating operator input up front fails legibly with zero network calls instead of a create that 422s. */
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
/** Why 32 KiB chunks: String.fromCharCode over a whole near-limit payload can exceed the engine's argument-count limit; chunked conversion cannot. */
const BASE64_CHUNK_BYTES = 32_768

export type NexusStoreSendResult =
  | { ok: true; repoFullName: string; commitSha: string; approvedCount: number; keyCount: number; createdRepo: boolean }
  | { ok: false; reason: 'no-token' }
  | { ok: false; reason: 'storage-unreadable' }
  | { ok: false; reason: 'too-large' }
  | { ok: false; reason: 'credential'; keyPrefix: string }
  | { ok: false; reason: 'repo-not-private'; repoFullName: string }
  | { ok: false; reason: 'github'; detail: string }

export interface NexusStoreSendDeps {
  request: GithubRequest
  /** Injectable for tests; defaults to githubPublish.createRepo. */
  createRepoImpl?: typeof createRepo
}

export interface NexusStoreSendInput {
  storage: NexusStoreStorage
  origin: string
  token: string
  repoName: string
  deps: NexusStoreSendDeps
}

interface RepoInfo { full_name?: string; private?: boolean; default_branch?: string }

/** UTF-8 → base64 as the Contents API expects it (TextEncoder bytes, chunked btoa). */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

/** A failed GitHub call, explained the way githubPublish explains publish failures (status + body message + token diagnosis). */
async function githubDetail(res: Response, step: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { message?: string }
  return `${step}: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}${describeTokenProblem(res)}`
}

/**
 * Send the Nexus store export to the operator's private staging repository. Never throws:
 * every failure is a named result, and every refusal path (no token, credential, oversize,
 * non-private repo) completes with zero writes — most with zero network calls at all.
 */
export async function sendNexusStoreExport(input: NexusStoreSendInput): Promise<NexusStoreSendResult> {
  const token = (input.token || '').trim()
  if (!token) return { ok: false, reason: 'no-token' }

  const repoName = (input.repoName || '').trim()
  if (!REPO_NAME_PATTERN.test(repoName) || repoName === '.' || repoName === '..') {
    return { ok: false, reason: 'github', detail: 'invalid repository name' }
  }

  const built = buildNexusStoreExport(input.storage, input.origin)
  if (!built.ok) {
    return built.reason === 'credential'
      ? { ok: false, reason: 'credential', keyPrefix: built.keyPrefix }
      : { ok: false, reason: 'storage-unreadable' }
  }
  if (new TextEncoder().encode(built.json).length > NEXUS_SEND_MAX_BYTES) {
    return { ok: false, reason: 'too-large' }
  }

  const request = input.deps.request
  const createRepoImpl = input.deps.createRepoImpl ?? createRepo
  const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }

  try {
    const meRes = await request(`${GITHUB_API}/user`, { headers })
    if (!meRes.ok) return { ok: false, reason: 'github', detail: await githubDetail(meRes, 'reading the account for the token') }
    const owner = ((await meRes.json()) as { login?: string }).login
    if (!owner) return { ok: false, reason: 'github', detail: 'reading the account for the token: the response carried no login' }

    const repoUrl = `${GITHUB_API}/repos/${owner}/${repoName}`
    let createdRepo = false
    let repoRes = await request(repoUrl, { headers })
    if (repoRes.status === 404) {
      await createRepoImpl(request, { token, name: repoName, private: true, description: REPO_DESCRIPTION })
      createdRepo = true
      repoRes = await request(repoUrl, { headers })
    }
    if (!repoRes.ok) return { ok: false, reason: 'github', detail: await githubDetail(repoRes, 'reading the repository') }
    const repo = (await repoRes.json()) as RepoInfo
    const repoFullName = repo.full_name || `${owner}/${repoName}`
    // The privacy gate: checked on the repository as it exists NOW, on every send, before any write.
    if (repo.private !== true) return { ok: false, reason: 'repo-not-private', repoFullName }
    const branch = repo.default_branch || 'main'

    const contentsUrl = `${repoUrl}/contents/${NEXUS_SEND_FILE_PATH}`
    let existingSha: string | undefined
    const fileRes = await request(contentsUrl, { headers })
    if (fileRes.ok) {
      existingSha = ((await fileRes.json()) as { sha?: string }).sha
    } else if (fileRes.status !== 404) {
      return { ok: false, reason: 'github', detail: await githubDetail(fileRes, 'reading the existing export') }
    }

    const putRes = await request(contentsUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `nexus store export ${built.envelope.exportedAt} — ${built.approvedCount} approved records`,
        content: base64Utf8(built.json),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    })
    if (!putRes.ok) return { ok: false, reason: 'github', detail: await githubDetail(putRes, 'writing the export') }
    const put = (await putRes.json()) as { commit?: { sha?: string } }
    return {
      ok: true,
      repoFullName,
      commitSha: put.commit?.sha || '',
      approvedCount: built.approvedCount,
      keyCount: built.keyCount,
      createdRepo,
    }
  } catch (err) {
    return { ok: false, reason: 'github', detail: err instanceof Error ? err.message : String(err) }
  }
}
