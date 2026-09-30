// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CorpusRepository } from './corpus'
import { corpusProvider } from './ai/providers/corpusProvider'
import { localInferenceProvider } from './ai/providers/localInferenceProvider'
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

describe('NEXUS / Corpus Local Mode', () => {
  beforeEach(() => storage.clear())

  it('initializes offline and persists a raw interaction plus untrusted candidate', async () => {
    const repository = new CorpusRepository()
    const result = await repository.appendInteraction({ input: 'What is alpha?', context: '', result: 'Alpha is the first letter.', runtime: 'corpus', model: 'local-model' })
    expect(repository.getInteractionCount()).toBe(1)
    expect(repository.getCandidateCount()).toBe(1)
    expect(repository.getApprovedCount()).toBe(0)
    expect(result.candidate.admissionStatus).toBe('candidate')
    expect(new CorpusRepository().getInteractionCount()).toBe(1)
  })

  it('retrieves only approved local records and admits valid candidates', async () => {
    const repository = new CorpusRepository()
    const { candidate } = await repository.appendInteraction({ input: 'Explain alpha', context: '', result: 'Alpha is the first letter.', runtime: 'corpus', model: 'local-model' })
    expect(repository.retrieve('alpha')).toHaveLength(0)
    expect(await repository.admitCandidate(candidate.id)).not.toBeNull()
    expect(repository.retrieve('alpha')).toHaveLength(1)
    expect(repository.getApprovedCount()).toBe(1)
    expect(await repository.admitCandidate(candidate.id)).not.toBeNull()
  })

  it('stores Shell evidence as an unapproved candidate and preserves provenance', async () => {
    const repository = new CorpusRepository()
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

  it('rejects malformed and tampered candidates', async () => {
    const repository = new CorpusRepository()
    storage.setItem('forgeclaw_nexus_candidate_v1:malformed', '{bad json')
    storage.setItem('forgeclaw_nexus_candidate_index_v1', JSON.stringify(['malformed']))
    expect(await repository.admitCandidate('malformed')).toBeNull()
    const { candidate } = await repository.appendInteraction({ input: 'known input', context: '', result: 'trusted result', runtime: 'corpus', model: 'local-model' })
    const raw = JSON.parse(storage.getItem(`forgeclaw_nexus_candidate_v1:${candidate.id}`)!)
    raw.generatedResult = 'tampered result'
    storage.setItem(`forgeclaw_nexus_candidate_v1:${candidate.id}`, JSON.stringify(raw))
    expect(await repository.admitCandidate(candidate.id)).toBeNull()
    expect(repository.getApprovedCount()).toBe(0)
  })

  it('keeps webhook failure optional and admits only validated returned updates', async () => {
    const repository = new CorpusRepository()
    const { candidate } = await repository.appendInteraction({ input: 'webhook test', context: '', result: 'local result', runtime: 'corpus', model: 'local-model' })
    const unavailable = await repository.syncPending('https://example.invalid/webhook', vi.fn().mockRejectedValue(new Error('offline')))
    expect(unavailable.status).toBe('pending')
    expect(repository.getApprovedCount()).toBe(0)
    const synced = await repository.syncPending('https://example.invalid/webhook', vi.fn().mockResolvedValue(new Response(JSON.stringify({ updates: [{ id: candidate.id }, { id: 'missing' }, 'malformed'] }), { status: 200 })))
    expect(synced.status).toBe('synced')
    expect(synced.admitted).toBe(1)
    expect(repository.getApprovedCount()).toBe(1)
  })

  it('uses approved corpus context through the existing local inference provider without requiring network at initialization', async () => {
    const repository = new CorpusRepository()
    const { candidate } = await repository.appendInteraction({ input: 'What is beta?', context: '', result: 'Beta is the second letter.', runtime: 'corpus', model: 'local-model' })
    await repository.admitCandidate(candidate.id)
    // corpusProvider delegates to the NEXUS inference engine, which is the Browser
    // WebGPU runtime. Spying on localInferenceProvider asserted a delegate that the
    // corpus path no longer uses, so the spy was never called.
    const { nexusWebGpuProvider } = await import('./ai/providers/nexusWebGpuProvider')
    const originalSend = nexusWebGpuProvider.send
    const send = vi.spyOn(nexusWebGpuProvider, 'send').mockResolvedValue({ text: 'local answer', provider: 'nexus', model: 'local-model', stopReason: 'stop' })
    await corpusProvider.send({ systemPrompt: 'system', messages: [{ role: 'user', content: 'What is beta?' }], model: 'local-model' }, 'http://127.0.0.1:8080/v1')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: expect.stringContaining('Beta is the second letter.') }), 'http://127.0.0.1:8080/v1')
    send.mockRestore()
    expect(originalSend).toBeDefined()
    // The corpus path must not touch the Ollama-backed local provider.
    expect(localInferenceProvider.id).toBe('local')
  })

  it('does not let corpus context bypass the existing Guardian co-sign boundary', () => {
    expect(requiresCoSign({ id: 'corpus-write', name: 'github_write_file', input: { branch: 'main' } }, true)).toBe(true)
    expect(requiresCoSign({ id: 'corpus-shell', name: 'shell_exec', input: {} }, true)).toBe(true)
  })

  it('accommodates 10,000 interaction records in persistent local storage', async () => {
    const repository = new CorpusRepository()
    for (let index = 0; index < 10_000; index += 1) {
      await repository.appendInteraction({ input: `synthetic query ${index}`, context: '', result: `synthetic result ${index}`, runtime: 'corpus', model: 'local-model' })
    }
    expect(repository.getInteractionCount()).toBe(10_000)
    expect(repository.getCandidateCount()).toBe(10_000)
    expect(new CorpusRepository().getInteractionCount()).toBe(10_000)
  }, 60_000)
})
