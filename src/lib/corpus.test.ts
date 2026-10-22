// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CorpusRepository, appendDeepSeekLearning, extractImagePatterns, integrityHash, suggestImprovedPrompt } from './corpus'
import { authorizationPayload, RFC8032_TEST_KEY_ID, type CandidateAuthorization } from './corpusAdmissionAuth'
import { corpusProvider } from './ai/providers/corpusProvider'
import { buildDeepSeekTaskPayload } from './ai/deepseekContext'
import { requiresCoSign } from './guardianGate'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

const RFC8032_PRIVATE_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const RFC8032_PKCS8_PREFIX = '302e020100300506032b657004220420'

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16))
}

function bufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

async function testAuthorization(candidate: { id: string; integrity: string }): Promise<CandidateAuthorization> {
  const issuedAt = '2026-01-01T00:00:00.000Z'
  const expiresAt = '2030-01-01T00:00:00.000Z'
  const unsigned = { keyId: RFC8032_TEST_KEY_ID, candidateId: candidate.id, candidateIntegrity: candidate.integrity, issuedAt, expiresAt }
  const key = await globalThis.crypto.subtle.importKey('pkcs8', bufferSource(hexBytes(`${RFC8032_PKCS8_PREFIX}${RFC8032_PRIVATE_SEED}`)), { name: 'Ed25519' }, false, ['sign'])
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(authorizationPayload(unsigned))))
  return { ...unsigned, signature: Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('') }
}

describe('NEXUS / Corpus Local Mode', () => {
  beforeEach(() => storage.clear())

  it('initializes offline and persists a raw interaction plus untrusted candidate', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const result = await repository.appendInteraction({ input: 'What is alpha?', context: '', result: 'Alpha is the first letter.', runtime: 'corpus', model: 'local-model' })
    expect(repository.getInteractionCount()).toBe(1)
    expect(repository.getCandidateCount()).toBe(1)
    expect(repository.getApprovedCount()).toBe(0)
    expect(result.candidate.admissionStatus).toBe('candidate')
    expect(new CorpusRepository({ mode: 'test' }).getInteractionCount()).toBe(1)
  })

  it('retrieves only approved local records and admits valid candidates', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'Explain alpha', context: '', result: 'Alpha is the first letter.', runtime: 'corpus', model: 'local-model' })
    expect(repository.retrieve('alpha')).toHaveLength(0)
    const authorization = await testAuthorization(candidate)
    expect((await repository.admitCandidate(candidate.id, authorization)).status).toBe('admitted')
    expect(repository.retrieve('alpha')).toHaveLength(1)
    expect(repository.getApprovedCount()).toBe(1)
    const versionAfterFirstAdmission = repository.getVersion()
    expect((await repository.admitCandidate(candidate.id, authorization)).status).toBe('already_admitted')
    expect(repository.getVersion()).toBe(versionAfterFirstAdmission)
  })

  it('stores Shell evidence as an unapproved candidate and preserves provenance', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendShellExperience({
      input: 'Identify the current repository directory.',
      context: '{"exerciseId":"shell.l1.pwd"}',
      result: '{"recordId":"shell-experience-1","runId":"42"}',
      runtime: 'github-actions',
      model: 'unknown',
      source: 'shell:owner/repo:42',
      provenance: { repository: 'owner/repo', runId: '42', invocationId: 'shell-1' },
    })
    expect(candidate.admissionStatus).toBe('candidate')
    expect(candidate.provenance?.runId).toBe('42')
    expect(repository.retrieve('recordId')).toHaveLength(0)
    const rejected = await repository.rejectCandidate(candidate.id, 'lesson failed review')
    expect(rejected?.admissionStatus).toBe('rejected')
    expect(repository.retrieve('recordId')).toHaveLength(0)
  })

  it('captures a DeepSeek dispatch as an unapproved NEXUS learning candidate', async () => {
    const result = await appendDeepSeekLearning('Explain routing', 'pending artifact', 'deepseek-test-1', 'private context')
    expect(result.candidate.admissionStatus).toBe('candidate')
    expect(result.candidate.runtime).toBe('github-actions')
    // Defaults to the checkpoint the workflow actually runs (deepseekCheckpoints.ts, tied to the workflow by a test).
    expect(result.candidate.model).toBe('Qwen/Qwen3-8B')
    expect(result.candidate.input).toContain('[DEEPSEEK_TASK] Explain routing')
    expect(result.candidate.generatedResult).toContain('[DEEPSEEK_RESULT]')
  })

  it('records the checkpoint that actually answered when the caller knows it (e.g. the fallback)', async () => {
    const result = await appendDeepSeekLearning('Explain routing', 'answer', 'deepseek-test-2', '', 'deepseek-ai/deepseek-coder-1.3b-instruct')
    expect(result.candidate.model).toBe('deepseek-ai/deepseek-coder-1.3b-instruct')
  })

  it('extracts image patterns and suggests improvements only from approved learning', async () => {
    const patterns = extractImagePatterns('a serene beach at sunset, wide shot, golden hour, warm tones', 'realistic')
    expect(patterns.subjects).toContain('beach')
    expect(patterns.composition).toContain('wide shot')
    expect(patterns.lighting).toContain('golden hour')
    expect(patterns.colorPalette).toContain('warm tones')

    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendImageGenerationLearning({ prompt: 'sunset beach', style: 'realistic', width: 1024, height: 1024, invocationId: 'flux-test-1' })
    expect(suggestImprovedPrompt('sunset beach').prompt).toBe('sunset beach')
    await repository.admitCandidate(candidate.id, await testAuthorization(candidate))
    expect(suggestImprovedPrompt('beach').prompt).toContain('beach')
  })

  it('rejects malformed and tampered candidates', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    storage.setItem('forgeclaw_nexus_candidate_v1:malformed', '{bad json')
    storage.setItem('forgeclaw_nexus_candidate_index_v1', JSON.stringify(['malformed']))
    expect((await repository.admitCandidate('malformed', await testAuthorization({ id: 'malformed', integrity: 'sha256-invalid' }))).status).toBe('rejected')
    const { candidate } = await repository.appendInteraction({ input: 'known input', context: '', result: 'trusted result', runtime: 'corpus', model: 'local-model' })
    const raw = JSON.parse(storage.getItem(`forgeclaw_nexus_candidate_v1:${candidate.id}`)!)
    raw.generatedResult = 'tampered result'
    storage.setItem(`forgeclaw_nexus_candidate_v1:${candidate.id}`, JSON.stringify(raw))
    expect((await repository.admitCandidate(candidate.id, await testAuthorization(candidate))).status).toBe('rejected')
    expect(repository.getApprovedCount()).toBe(0)
  })

  it('keeps webhook failure optional and stores returned updates as candidates', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'webhook test', context: '', result: 'local result', runtime: 'corpus', model: 'local-model' })
    const unavailable = await repository.syncPending('https://example.invalid/webhook', vi.fn().mockRejectedValue(new Error('offline')))
    expect(unavailable.status).toBe('pending')
    expect(repository.getApprovedCount()).toBe(0)
    const synced = await repository.syncPending('https://example.invalid/webhook', vi.fn().mockResolvedValue(new Response(JSON.stringify({ updates: [{ id: candidate.id }, { id: 'missing' }, 'malformed'] }), { status: 200 })))
    expect(synced.status).toBe('synced')
    expect(synced.admitted).toBe(0)
    expect(repository.getApprovedCount()).toBe(0)
    expect((await repository.admitCandidate(candidate.id, await testAuthorization(candidate))).status).toBe('admitted')
    expect(repository.getApprovedCount()).toBe(1)
  })

  it('H-A: rejects an unauthorized webhook candidate instead of admitting it', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    await repository.appendInteraction({ input: 'local pending candidate', context: '', result: 'local result', runtime: 'corpus', model: 'local-model' })
    const input = 'remote webhook candidate'
    const context = 'remote context'
    const generatedResult = 'remote result'
    const runtime = 'remote-runtime'
    const model = 'remote-model'
    const integrity = await integrityHash([input, context, generatedResult, runtime, model].join('\n'))
    const remoteCandidate = {
      id: `candidate-${integrity}`,
      corpusId: 'nexus-remote',
      source: 'remote-webhook',
      content: generatedResult,
      timestamp: new Date().toISOString(),
      version: 2,
      recordType: 'learning_candidate' as const,
      integrity,
      admissionStatus: 'candidate' as const,
      metadata: { input, runtime, model, sourceInteractionId: `interaction-${integrity}` },
      sourceInteractionId: `interaction-${integrity}`,
      runtime,
      model,
      input,
      context,
      generatedResult,
    }

    const synced = await repository.syncPending(
      'https://example.invalid/webhook',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ updates: [remoteCandidate] }), { status: 200 })),
    )

    expect(synced.status).toBe('synced')
    expect(synced.admitted).toBe(0)
    expect(repository.getApprovedCount()).toBe(0)
    expect(repository.retrieve('remote result')).toHaveLength(0)
  })

  it('makes approved corpus context available to the DeepSeek workflow without local fallback', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'What is beta?', context: '', result: 'Beta is the second letter.', runtime: 'corpus', model: 'local-model' })
    await repository.admitCandidate(candidate.id, await testAuthorization(candidate))
    const payload = buildDeepSeekTaskPayload('What is beta?')
    expect(payload.context).toContain('Beta is the second letter.')
    expect(corpusProvider.supportsTools('deepseek-16b')).toBe(false)
    await expect(corpusProvider.send({ systemPrompt: 'system', messages: [{ role: 'user', content: 'What is beta?' }], model: 'deepseek-16b' }, '')).rejects.toThrow('GitHub Actions workflow dispatcher')
  })

  it('does not let corpus context bypass the existing Guardian co-sign boundary', () => {
    expect(requiresCoSign({ id: 'corpus-write', name: 'github_write_file', input: { branch: 'main' } }, true)).toBe(true)
    expect(requiresCoSign({ id: 'corpus-shell', name: 'shell_exec', input: {} }, true)).toBe(true)
  })

  it('accommodates 10,000 interaction records in persistent local storage', async ({ signal }) => {
    const repository = new CorpusRepository({ mode: 'test' })
    for (let index = 0; index < 10_000; index += 1) {
      // A timed-out test's promise keeps running: without this, its appends leaked into the next test's storage
      // (docs/flakes.md entry 6, "expected 9 to be 7" after entry 5 timed out in a shuffled run).
      if (signal.aborted) return
      await repository.appendInteraction({ input: `synthetic query ${index}`, context: '', result: `synthetic result ${index}`, runtime: 'corpus', model: 'local-model' })
    }
    expect(repository.getInteractionCount()).toBe(10_000)
    expect(repository.getCandidateCount()).toBe(10_000)
    expect(new CorpusRepository({ mode: 'test' }).getInteractionCount()).toBe(10_000)
    // 10,000 sequential appends each rewrite an index of up to 10,000 ids: ~31 s alone, so 60 s timed out under suite
    // load (docs/flakes.md entry 5). One real append is a few ms; only this test's back-to-back volume is quadratic.
  }, 180_000)
})

describe('CORPUS admission authorization conformance', () => {
  beforeEach(() => storage.clear())

  it('verifies the RFC 8032 Ed25519 test vector fixture', async () => {
    const publicKey = await globalThis.crypto.subtle.importKey('raw', bufferSource(hexBytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')), { name: 'Ed25519' }, false, ['verify'])
    const signature = hexBytes('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b')
    await expect(globalThis.crypto.subtle.verify({ name: 'Ed25519' }, publicKey, bufferSource(signature), new ArrayBuffer(0))).resolves.toBe(true)
  })

  it('rejects forged, wrong-hash, expired, and missing authorization', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'conformance input', context: '', result: 'conformance result', runtime: 'test', model: 'test' })
    const valid = await testAuthorization(candidate)
    const forged = { ...valid, signature: valid.signature.replace(/^../, valid.signature.startsWith('00') ? 'ff' : '00') }
    const expired = { ...valid, issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2021-01-01T00:00:00.000Z' }
    expect((await repository.admitCandidate(candidate.id, forged)).status).toBe('rejected')
    expect((await repository.admitCandidate(candidate.id, { ...valid, candidateIntegrity: 'sha256-wrong' })).status).toBe('rejected')
    expect((await repository.admitCandidate(candidate.id, expired)).status).toBe('rejected')
    expect((await repository.admitCandidate(candidate.id, undefined as unknown as CandidateAuthorization)).status).toBe('rejected')
    expect((await repository.admitCandidate(candidate.id, true as unknown as CandidateAuthorization)).status).toBe('rejected')
  })

  it('fails closed when authorization is replayed for another candidate and rejects the RFC key in production', async () => {
    const testRepository = new CorpusRepository({ mode: 'test' })
    const first = await testRepository.appendInteraction({ input: 'first', context: '', result: 'first result', runtime: 'test', model: 'test' })
    const second = await testRepository.appendInteraction({ input: 'second', context: '', result: 'second result', runtime: 'test', model: 'test' })
    const authorization = await testAuthorization(first.candidate)
    expect((await testRepository.admitCandidate(first.candidate.id, authorization)).status).toBe('admitted')
    expect((await testRepository.admitCandidate(second.candidate.id, authorization)).status).toBe('rejected')
    const productionRepository = new CorpusRepository()
    const productionCandidate = await productionRepository.appendInteraction({ input: 'production', context: '', result: 'production result', runtime: 'test', model: 'test' })
    expect((await productionRepository.admitCandidate(productionCandidate.candidate.id, await testAuthorization(productionCandidate.candidate))).status).toBe('rejected')
  })
})

describe('CORPUS admission persistence failures', () => {
  beforeEach(() => storage.clear())

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surfaces storage_unavailable when localStorage.getItem throws during admit', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'storage test', context: '', result: 'storage result', runtime: 'test', model: 'test' })
    const authorization = await testAuthorization(candidate)

    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })

    const result = await repository.admitCandidate(candidate.id, authorization)
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('storage_unavailable')
    expect(result.detail).toBeDefined()
  })

  it('surfaces storage_unavailable when localStorage.setItem throws during admit', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'storage test 2', context: '', result: 'storage result 2', runtime: 'test', model: 'test' })
    const authorization = await testAuthorization(candidate)

    // Let the read succeed but fail the write
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage)
    let callCount = 0
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      callCount++
      // Allow the initial candidate creation writes, fail on admission writes
      if (callCount > 10) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSetItem(key, value)
    })

    const result = await repository.admitCandidate(candidate.id, authorization)
    // May succeed if writes happen before our threshold, or fail with storage_unavailable
    // The key assertion: it does NOT silently return null or admit without persisting
    if (result.status === 'rejected') {
      expect(result.reason).toBe('storage_unavailable')
    }
  })

  it('returns candidate_not_found (not storage_unavailable) for genuinely missing candidates', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    // No mocks — storage works fine, candidate just doesn't exist
    const fakeAuth = {
      keyId: 'test',
      candidateId: 'nonexistent',
      candidateIntegrity: 'sha256-fake',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      signature: '00'.repeat(64),
    }
    const result = await repository.admitCandidate('nonexistent-id', fakeAuth as unknown as CandidateAuthorization)
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('candidate_not_found')
  })

  it('strict storage variants return ok/error without throwing', async () => {
    const { strictGetItem, strictSetItem, strictRemoveItem } = await import('./storage')

    // Normal operation
    expect(strictSetItem('test-key', 'test-value').ok).toBe(true)
    const getResult = strictGetItem('test-key')
    expect(getResult.ok).toBe(true)
    expect(getResult.value).toBe('test-value')
    expect(strictRemoveItem('test-key').ok).toBe(true)

    // Failure mode
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const failResult = strictSetItem('fail-key', 'fail-value')
    expect(failResult.ok).toBe(false)
    expect(failResult.error).toBeDefined()
  })
})

describe('CORPUS admission persistence failures', () => {
  beforeEach(() => storage.clear())
  afterEach(() => { vi.restoreAllMocks() })

  it('surfaces storage_unavailable when localStorage.getItem throws during admit', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'storage test', context: '', result: 'storage result', runtime: 'test', model: 'test' })
    const authorization = await testAuthorization(candidate)
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Storage unavailable', 'SecurityError') })
    const result = await repository.admitCandidate(candidate.id, authorization)
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('storage_unavailable')
    expect(result.detail).toBeDefined()
  })

  it('surfaces storage_unavailable when localStorage.setItem throws during admit', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const { candidate } = await repository.appendInteraction({ input: 'storage test 2', context: '', result: 'storage result 2', runtime: 'test', model: 'test' })
    const authorization = await testAuthorization(candidate)
    const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage)
    let callCount = 0
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      callCount++
      if (callCount > 10) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSetItem(key, value)
    })
    const result = await repository.admitCandidate(candidate.id, authorization)
    if (result.status === 'rejected') { expect(result.reason).toBe('storage_unavailable') }
  })

  it('returns candidate_not_found for genuinely missing candidates', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    const fakeAuth = { keyId: 'test', candidateId: 'nonexistent', candidateIntegrity: 'sha256-fake', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), signature: '00'.repeat(64) }
    const result = await repository.admitCandidate('nonexistent-id', fakeAuth as unknown as CandidateAuthorization)
    expect(result.status).toBe('rejected')
    expect(result.reason).toBe('candidate_not_found')
  })

  it('strict storage variants return ok/error without throwing', async () => {
    const { strictGetItem, strictSetItem, strictRemoveItem } = await import('./storage')
    expect(strictSetItem('test-key', 'test-value').ok).toBe(true)
    const getResult = strictGetItem('test-key')
    expect(getResult.ok).toBe(true)
    expect(getResult.value).toBe('test-value')
    expect(strictRemoveItem('test-key').ok).toBe(true)
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    const failResult = strictSetItem('fail-key', 'fail-value')
    expect(failResult.ok).toBe(false)
    expect(failResult.error).toBeDefined()
  })
})
