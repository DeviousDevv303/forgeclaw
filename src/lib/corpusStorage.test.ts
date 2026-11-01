// @vitest-environment jsdom
// 2026-10-21: the newest entry on the NEXUS page was hours old. localStorage was full, safeSetItem swallowed the error, and
// NEXUS stopped recording without saying so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLearningEvent, MAX_TOOL_RECORD_CHARS, recordLearningEvent } from './learningEvents'
import { CorpusRepository } from './corpus'

/** A localStorage that is full at `limit` characters, like a phone browser's. */
class LimitedStorage {
  private map = new Map<string, string>()
  private limit: number
  constructor(limit: number) { this.limit = limit }
  private size() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n }
  get length() { return this.map.size }
  key(i: number) { return [...this.map.keys()][i] ?? null }
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) {
    const next = this.size() - (this.map.has(k) ? k.length + (this.map.get(k) as string).length : 0) + k.length + v.length
    if (next > this.limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    this.map.set(k, v)
  }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

const chat = (n: number, outcome: 'completed' | 'verified' = 'completed') =>
  buildLearningEvent({ channel: 'chat', input: `question ${n}`, result: `answer ${n} ${'x'.repeat(1_500)}`, outcome, runtime: 'kimi', model: 'k2', actor: 'user', runId: `run-${n}`, lineage: 'none' })

describe('when the browser\'s storage is full', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new LimitedStorage(40_000)) })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps recording: the oldest unapproved entries make room', async () => {
    const corpus = new CorpusRepository()
    for (let i = 0; i < 40; i++) await corpus.appendInteraction(chat(i))
    const candidates = corpus.listCandidates(100)
    expect(candidates.length).toBeGreaterThanOrEqual(4)
    expect(candidates.length).toBeLessThan(40)
    expect(candidates[0].input).toBe('question 39') // the newest is first, though all 40 were stamped in the same millisecond
    expect(candidates.some(c => c.input === 'question 0')).toBe(false) // the oldest made room
  })

  it('never removes knowledge to make room', async () => {
    const corpus = new CorpusRepository()
    await corpus.appendInteraction(chat(0, 'verified')) // converges into knowledge
    for (let i = 1; i < 40; i++) await corpus.appendInteraction(chat(i))
    expect(corpus.getApprovedCount()).toBe(1)
    expect(corpus.listCandidates(100).some(c => c.input === 'question 0')).toBe(true)
    expect(corpus.retrieve('question 0 answer', 3)).toHaveLength(1)
  })

  it('says so when nothing more can be removed, instead of pretending it recorded', async () => {
    vi.stubGlobal('localStorage', new LimitedStorage(12_000))
    const corpus = new CorpusRepository()
    await corpus.appendInteraction(chat(0, 'verified')) // knowledge fills the little room there is
    await expect(corpus.appendInteraction(chat(1, 'verified'))).rejects.toThrow(/storage is full/)
    // recordLearningEvent turns that into false, which the app reports as a failure
    expect(await recordLearningEvent(chat(2) as never, corpus)).toBe(false)
  })
})

describe('tool and shell records stay small; chat answers keep their full bound', () => {
  it('clips a file dump to the tool limit and flags it', () => {
    const tool = buildLearningEvent({ channel: 'tool', input: 'github_read_file {"path":"src/App.tsx"}', result: `File: src/App.tsx\n${'y'.repeat(5_000)}`, outcome: 'completed', runtime: 'kimi', model: 'k2', toolName: 'github_read_file', actor: 'agent' })
    expect(tool.result.length).toBe(MAX_TOOL_RECORD_CHARS)
    expect(tool.metadata?.redacted_or_truncated).toBe('true')
    const shell = buildLearningEvent({ channel: 'shell', input: 'cat big.txt', result: 'z'.repeat(5_000), outcome: 'completed', runtime: 'kimi', model: 'k2' })
    expect(shell.result.length).toBe(MAX_TOOL_RECORD_CHARS)
  })
  it('a chat answer keeps up to 4,000 characters', () => {
    const answer = buildLearningEvent({ channel: 'chat', input: 'q', result: 'a'.repeat(5_000), outcome: 'completed', runtime: 'kimi', model: 'k2', lineage: 'none' })
    expect(answer.result.length).toBe(4_000)
  })
  it('a failure still shows its cause in the first lines', () => {
    const failure = buildLearningEvent({ channel: 'tool', input: 'shell_exec {"command":"gh pr list"}', result: `[TOOL ERROR] Shell execution failed.\nCommand: gh pr list\nExit code: 4\n\ngh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.\n${'.'.repeat(3_000)}`, outcome: 'failed', runtime: 'kimi', model: 'k2', toolName: 'shell_exec' })
    expect(failure.result).toContain('set the GH_TOKEN environment variable')
  })
})
