// Directive item Tier 1 — autonomous-fix learning admission.
// Design decisions: facts are serialized as JSON, source is fixed to autonomous-fix,
// and the existing candidate pipeline remains the only admission path.
// Remaining: candidates still require the existing explicit curation/admission flow.
import { beforeEach, describe, expect, it } from 'vitest'
import { appendAutonomousFixLearning, CorpusRepository } from '../src/lib/corpus'

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

describe('autonomous-fix learning candidates', () => {
  beforeEach(() => storage.clear())

  it('records verified facts as an unapproved candidate', async () => {
    const result = await appendAutonomousFixLearning({
      filesChanged: ['.github/workflows/build-gate.yml'],
      description: 'Build gate now runs the repository test suite.',
      testCountBefore: 153,
      testCountAfter: 154,
      prUrl: 'https://github.com/DeviousDevv303/forgeclaw/pull/31',
    })

    expect(result.candidate.admissionStatus).toBe('candidate')
    expect(result.candidate.source).toBe('autonomous-fix')
    expect(JSON.parse(result.candidate.input)).toEqual({
      filesChanged: ['.github/workflows/build-gate.yml'],
      description: 'Build gate now runs the repository test suite.',
    })
    expect(JSON.parse(result.candidate.context)).toEqual({ testCountBefore: 153, testCountAfter: 154 })
    expect(JSON.parse(result.candidate.generatedResult)).toEqual({
      prUrl: 'https://github.com/DeviousDevv303/forgeclaw/pull/31',
    })
    expect(new CorpusRepository().getApprovedCount()).toBe(0)
  })
})
