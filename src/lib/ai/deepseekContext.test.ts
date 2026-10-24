// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { CorpusRepository } from '../corpus'
import { authorizationPayload, RFC8032_TEST_KEY_ID } from '../corpusAdmissionAuth'
import { buildDeepSeekTaskPayload, FORGECLAW_ARCHITECTURE_CONTEXT } from './deepseekContext'
import { DEEPSEEK_FALLBACK_CHECKPOINT, DEEPSEEK_PRIMARY_CHECKPOINT } from '../deepseekCheckpoints'
import { DEFAULT_PROVIDER } from '../providerDefaults'
import { readFileSync } from 'node:fs'
import { buildRuntimeRequestContext } from '../codingAgentRuntime'

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
const hexBytes = (value: string) => Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16))
const bufferSource = (value: Uint8Array) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer

describe('DeepSeek task/context boundary', () => {
  beforeEach(() => storage.clear())

  it('preserves the user task and supplies relevant ForgeClaw architecture separately from runtime state', () => {
    const task = "Explain ForgeClaw's default reasoning flow. Tell me which model is primary and which is secondary."
    const payload = buildDeepSeekTaskPayload(`${task}\n\n[RUNTIME_STATE repository="DeviousDevv303/forgeclaw" taskStatus="idle"]\nRepository evidence comes from GitHub tools; never infer or preload contents.\n[/RUNTIME_STATE]`)

    expect(payload.task).toBe(task)
    expect(payload.context).toContain('ForgeClaw architecture facts')
    expect(payload.context).toContain('the DeepSeek GitHub Actions workflow is the default reasoning runtime')
    expect(payload.context).toContain('Moonshot/Kimi, Anthropic and local llama.cpp are explicit selectable alternatives')
    expect(payload.context).toContain('There is no browser-local model fallback')
    expect(payload.context).toContain('not repository evidence')
    expect(payload.context).not.toContain('[/RUNTIME_STATE]\n\n[RUNTIME_STATE')
  })

  it('includes only approved CORPUS records and preserves actual tool results as separately labelled evidence', async () => {
    const repository = new CorpusRepository({ mode: 'test' })
    await repository.appendInteraction({
      input: 'ForgeClaw runtime flow',
      context: '',
      result: 'PENDING-CORPUS-FACT',
      runtime: 'test',
      model: 'test',
    })
    const approved = await repository.appendInteraction({
      input: 'ForgeClaw default reasoning flow',
      context: '',
      result: 'APPROVED-CORPUS-FACT',
      runtime: 'test',
      model: 'test',
    })
    const unsigned = { keyId: RFC8032_TEST_KEY_ID, candidateId: approved.candidate.id, candidateIntegrity: approved.candidate.integrity, issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' }
    const key = await globalThis.crypto.subtle.importKey('pkcs8', bufferSource(hexBytes(`${RFC8032_PKCS8_PREFIX}${RFC8032_PRIVATE_SEED}`)), { name: 'Ed25519' }, false, ['sign'])
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(authorizationPayload(unsigned))))
    await repository.admitCandidate(approved.candidate.id, { ...unsigned, signature: Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('') })

    const payload = buildDeepSeekTaskPayload(
      'Explain ForgeClaw default reasoning flow.',
      'github_repo_state result:\nHEAD: 0123456789abcdef',
    )
    expect(payload.context).toContain('APPROVED-CORPUS-FACT')
    expect(payload.context).not.toContain('PENDING-CORPUS-FACT')
    expect(payload.context).toContain('Actual ForgeTools results from this turn')
    expect(payload.context).toContain('HEAD: 0123456789abcdef')
  })

  it('does not add ForgeClaw architecture context to an unrelated user task', () => {
    expect(buildDeepSeekTaskPayload('What is 2 + 2?')).toEqual({ task: 'What is 2 + 2?' })
  })

  it('keeps the APPLICATION_IDENTITY block out of the task the model is asked to answer', () => {
    // Exactly what App.tsx sends: the question, then buildRuntimeRequestContext().
    const envelope = buildRuntimeRequestContext({ owner: 'DeviousDevv303', repo: 'forgeclaw', taskStatus: 'idle' })
    const payload = buildDeepSeekTaskPayload(`What causes rainbows to form after rain?\n\n${envelope}`)
    expect(payload.task).toBe('What causes rainbows to form after rain?')
    expect(payload.task).not.toMatch(/APPLICATION_IDENTITY|RUNTIME_STATE/)
    // Still available to the model, but labelled as context, not as the question.
    expect(payload.context).toContain('[APPLICATION_IDENTITY application="Nexus Intelligence"')
    expect(payload.context).toContain('[RUNTIME_STATE repository="DeviousDevv303/forgeclaw"')
  })

  it('leaves an identity block the user typed mid-question in the task', () => {
    const envelope = buildRuntimeRequestContext({ owner: 'DeviousDevv303', repo: 'forgeclaw', taskStatus: 'idle' })
    const typed = 'Explain this tag: [APPLICATION_IDENTITY application="X"] then more words [/APPLICATION_IDENTITY] and why it matters'
    expect(buildDeepSeekTaskPayload(`${typed}\n\n${envelope}`).task).toBe(typed)
  })

  it('tells the model the real default provider and the checkpoints the workflow actually runs', () => {
    // The model answers "what is ForgeClaw running?" from these facts, so they must match the source.
    // They had drifted: they claimed DEFAULT_PROVIDER `moonshot` and a 6.7B coder checkpoint.
    const workflow = readFileSync(new URL('../../../.github/workflows/deepseek-16b.yml', import.meta.url), 'utf8')
    expect(workflow).toContain(`PRIMARY_MODEL = '${DEEPSEEK_PRIMARY_CHECKPOINT}'`)
    expect(workflow).toContain(`FALLBACK_MODEL = '${DEEPSEEK_FALLBACK_CHECKPOINT}'`)
    expect(FORGECLAW_ARCHITECTURE_CONTEXT).toContain(`DEFAULT_PROVIDER is \`${DEFAULT_PROVIDER}\``)
    expect(FORGECLAW_ARCHITECTURE_CONTEXT).toContain(DEEPSEEK_PRIMARY_CHECKPOINT)
    expect(FORGECLAW_ARCHITECTURE_CONTEXT).not.toMatch(/moonshot`; Moonshot\/Kimi K2\.6 is the primary|deepseek-coder-6\.7b/)
  })
})
