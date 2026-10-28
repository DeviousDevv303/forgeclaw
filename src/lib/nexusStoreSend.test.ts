// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildNexusStoreExport, type NexusStoreStorage } from './corpus'
import type { CreateRepoInput, GithubRequest } from './githubPublish'
import { DEFAULT_NEXUS_SEND_REPO, NEXUS_SEND_FILE_PATH, sendNexusStoreExport } from './nexusStoreSend'

class StoreStub implements NexusStoreStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  set(key: string, value: string) { this.values.set(key, value) }
}

const RECORD_PREFIX = 'forgeclaw_nexus_record_v1:'
const ORIGIN = 'https://deviousdevv303.github.io'
const AT = '2026-10-27T20:50:00.000Z'
const OWNER = 'octo'
const REPO_URL = `https://api.github.com/repos/${OWNER}/${DEFAULT_NEXUS_SEND_REPO}`
const CONTENTS_URL = `${REPO_URL}/contents/${NEXUS_SEND_FILE_PATH}`

function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'knowledge-abc123',
    corpusId: 'forgeclaw',
    source: 'test',
    content: 'an approved fact',
    timestamp: AT,
    version: 1,
    recordType: 'knowledge',
    integrity: 'abc123',
    admissionStatus: 'approved',
    metadata: {},
    ...overrides,
  })
}

function seededStorage(overrides: Record<string, unknown> = {}): StoreStub {
  const storage = new StoreStub()
  storage.set(`${RECORD_PREFIX}knowledge-abc123`, record(overrides))
  return storage
}

interface RecordedCall { url: string; method: string; body: Record<string, unknown> | null }

interface FakeRepoState {
  exists: boolean
  isPrivate: boolean
  /** sha of the already-committed export file; null when the file does not exist yet. */
  fileSha: string | null
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A GithubRequest that plays GitHub against a mutable repo state and records every call. */
function fakeGithub(state: FakeRepoState): { request: GithubRequest; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const request: GithubRequest = async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    calls.push({ url, method, body })
    if (url === 'https://api.github.com/user' && method === 'GET') return jsonResponse(200, { login: OWNER })
    if (url === REPO_URL && method === 'GET') {
      if (!state.exists) return jsonResponse(404, { message: 'Not Found' })
      return jsonResponse(200, { full_name: `${OWNER}/${DEFAULT_NEXUS_SEND_REPO}`, private: state.isPrivate, default_branch: 'main' })
    }
    if (url === CONTENTS_URL && method === 'GET') {
      return state.fileSha ? jsonResponse(200, { sha: state.fileSha }) : jsonResponse(404, { message: 'Not Found' })
    }
    if (url === CONTENTS_URL && method === 'PUT') {
      return jsonResponse(200, { content: { sha: 'blob-sha' }, commit: { sha: 'commit-sha-123' } })
    }
    throw new Error(`unexpected request: ${method} ${url}`)
  }
  return { request, calls }
}

/** A createRepo stand-in: flips the fake state to "repo exists" with the given read-back privacy. */
function fakeCreateRepo(state: FakeRepoState, readBackPrivate: boolean) {
  return vi.fn(async (_request: GithubRequest, input: CreateRepoInput) => {
    state.exists = true
    state.isPrivate = readBackPrivate
    return { owner: OWNER, repo: input.name, url: `https://github.com/${OWNER}/${input.name}`, defaultBranch: 'main' }
  })
}

function send(storage: NexusStoreStorage, request: GithubRequest, extra: Record<string, unknown> = {}) {
  return sendNexusStoreExport({
    storage,
    origin: ORIGIN,
    token: 'tok',
    repoName: DEFAULT_NEXUS_SEND_REPO,
    deps: { request },
    ...extra,
  })
}

function putCall(calls: RecordedCall[]): RecordedCall {
  const put = calls.find(c => c.method === 'PUT')
  if (!put) throw new Error('expected a PUT call')
  return put
}

describe('sendNexusStoreExport', () => {
  it('commits the export to an existing private repo, creating the file (PUT without sha)', async () => {
    const state: FakeRepoState = { exists: true, isPrivate: true, fileSha: null }
    const gh = fakeGithub(state)
    const result = await send(seededStorage(), gh.request)
    expect(result).toEqual({
      ok: true,
      repoFullName: `${OWNER}/${DEFAULT_NEXUS_SEND_REPO}`,
      commitSha: 'commit-sha-123',
      approvedCount: 1,
      keyCount: 1,
      createdRepo: false,
    })
    const put = putCall(gh.calls)
    expect(put.url).toBe(CONTENTS_URL)
    expect(put.body?.sha).toBeUndefined()
    expect(put.body?.branch).toBe('main')
    expect(String(put.body?.message)).toContain('1 approved records')
  })

  it('updates in place when the file already exists (PUT carries the existing sha)', async () => {
    const state: FakeRepoState = { exists: true, isPrivate: true, fileSha: 'existing-file-sha' }
    const gh = fakeGithub(state)
    const result = await send(seededStorage(), gh.request)
    expect(result.ok).toBe(true)
    expect(putCall(gh.calls).body?.sha).toBe('existing-file-sha')
  })

  it('refuses a public destination repo with zero writes', async () => {
    const state: FakeRepoState = { exists: true, isPrivate: false, fileSha: null }
    const gh = fakeGithub(state)
    const result = await send(seededStorage(), gh.request)
    expect(result).toEqual({ ok: false, reason: 'repo-not-private', repoFullName: `${OWNER}/${DEFAULT_NEXUS_SEND_REPO}` })
    expect(gh.calls.some(c => c.method === 'PUT' || c.method === 'POST')).toBe(false)
  })

  it('creates the repo private when it does not exist, then sends', async () => {
    const state: FakeRepoState = { exists: false, isPrivate: false, fileSha: null }
    const gh = fakeGithub(state)
    const createRepoImpl = fakeCreateRepo(state, true)
    const result = await send(seededStorage(), gh.request, { deps: { request: gh.request, createRepoImpl } })
    expect(createRepoImpl).toHaveBeenCalledTimes(1)
    expect(createRepoImpl.mock.calls[0][1]).toMatchObject({ name: DEFAULT_NEXUS_SEND_REPO, private: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.createdRepo).toBe(true)
    expect(gh.calls.some(c => c.method === 'PUT')).toBe(true)
  })

  it('refuses when the just-created repo reads back public, with no PUT', async () => {
    const state: FakeRepoState = { exists: false, isPrivate: false, fileSha: null }
    const gh = fakeGithub(state)
    const createRepoImpl = fakeCreateRepo(state, false)
    const result = await send(seededStorage(), gh.request, { deps: { request: gh.request, createRepoImpl } })
    expect(result).toEqual({ ok: false, reason: 'repo-not-private', repoFullName: `${OWNER}/${DEFAULT_NEXUS_SEND_REPO}` })
    expect(gh.calls.some(c => c.method === 'PUT')).toBe(false)
  })

  it('aborts on a credential-looking record before any network call', async () => {
    const state: FakeRepoState = { exists: true, isPrivate: true, fileSha: null }
    const gh = fakeGithub(state)
    // Assembled, not literal: the fake credential only needs to match the exporter's secret pattern.
    const storage = seededStorage({ content: `leaked key ${'ghp_' + 'A'.repeat(24)}` })
    const result = await send(storage, gh.request)
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === 'credential') {
      expect(result.keyPrefix).toBe(`${RECORD_PREFIX}knowledge-abc123`)
    } else {
      throw new Error(`expected a credential refusal, got ${JSON.stringify(result)}`)
    }
    expect(gh.calls).toHaveLength(0)
  })

  it('refuses a blank token with zero network calls', async () => {
    const state: FakeRepoState = { exists: true, isPrivate: true, fileSha: null }
    const gh = fakeGithub(state)
    const result = await send(seededStorage(), gh.request, { token: '   ' })
    expect(result).toEqual({ ok: false, reason: 'no-token' })
    expect(gh.calls).toHaveLength(0)
  })

  it('base64-encodes the payload UTF-8 safely — non-ASCII content round-trips byte-identically', async () => {
    const content = 'Réunion — naïve ☃ 日本語テスト'
    const storage = seededStorage({ content })
    const expected = buildNexusStoreExport(storage, ORIGIN)
    expect(expected.ok).toBe(true)
    if (!expected.ok) return

    const state: FakeRepoState = { exists: true, isPrivate: true, fileSha: null }
    const gh = fakeGithub(state)
    const result = await send(storage, gh.request)
    expect(result.ok).toBe(true)

    const decoded = Buffer.from(String(putCall(gh.calls).body?.content), 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as { format: string; origin: string; keys: Record<string, string> }
    // The decoded payload parses back to the very envelope that was sent: same keys, same raw
    // record string — any UTF-8 mangling in the encoder would corrupt the non-ASCII content.
    expect(decoded).toBe(JSON.stringify(parsed))
    expect(parsed.format).toBe('nexus-store-export')
    expect(parsed.origin).toBe(ORIGIN)
    expect(parsed.keys).toEqual(expected.envelope.keys)
    expect(parsed.keys[`${RECORD_PREFIX}knowledge-abc123`]).toContain('日本語テスト')
  })
})
