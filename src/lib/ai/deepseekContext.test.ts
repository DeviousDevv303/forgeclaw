// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { CorpusRepository } from '../corpus'
import { buildDeepSeekTaskPayload } from './deepseekContext'

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

describe('DeepSeek task/context boundary', () => {
  beforeEach(() => storage.clear())

  it('preserves the user task and supplies relevant ForgeClaw architecture separately from runtime state', () => {
    const task = "Explain ForgeClaw's default reasoning flow. Tell me which model is primary and which is secondary."
    const payload = buildDeepSeekTaskPayload(`${task}\n\n[RUNTIME_STATE repository="DeviousDevv303/forgeclaw" taskStatus="idle"]\nRepository evidence comes from GitHub tools; never infer or preload contents.\n[/RUNTIME_STATE]`)

    expect(payload.task).toBe(task)
    expect(payload.context).toContain('ForgeClaw architecture facts')
    expect(payload.context).toContain('deepseek-ai/deepseek-coder-6.7b-instruct')
    expect(payload.context).toContain('There is no browser-local model fallback')
    expect(payload.context).toContain('not repository evidence')
    expect(payload.context).not.toContain('[/RUNTIME_STATE]\n\n[RUNTIME_STATE')
  })

  it('includes only approved CORPUS records and preserves actual tool results as separately labelled evidence', async () => {
    const repository = new CorpusRepository()
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
    await repository.admitCandidate(approved.candidate.id)

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
})
