// @vitest-environment jsdom
// 2026-10-21: the newest entry on the NEXUS page was hours old. localStorage was full, safeSetItem swallowed the error, and
// NEXUS stopped recording without saying so.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLearningEvent, MAX_TOOL_RECORD_CHARS, recordLearningEvent } from './learningEvents'
import { CorpusRepository, corpusStorageChars } from './corpus'

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

/** Admitted knowledge, written the way the owner's intake admits it. Since 2026-11-09 no chat
 * answer converges into knowledge on its own (nexusConvergence.ts), so the storage tests that
 * need real knowledge in the store admit it explicitly instead of relying on a 'verified' stamp. */
const admittedChat = (corpus: CorpusRepository, n: number) =>
  corpus.appendIntakeExperience(
    { input: `question ${n}`, context: 'channel=chat; outcome=verified; origin=typed; actor=user', result: `answer ${n} ${'x'.repeat(1_500)}`, runtime: 'kimi', model: 'k2', source: 'nexus-intake', provenance: { admittedBy: 'nexus-intake:owner-directed' } },
    'nexus-intake:owner-directed',
  )

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

  it('spends unapproved churn before touching knowledge (knowledge eviction is the last resort)', async () => {
    const corpus = new CorpusRepository()
    await admittedChat(corpus, 0) // admitted knowledge — never removable to make room
    for (let i = 1; i < 40; i++) await corpus.appendInteraction(chat(i))
    expect(corpus.getApprovedCount()).toBe(1)
    expect(corpus.listCandidates(100).some(c => c.input === 'question 0')).toBe(true)
    expect(corpus.retrieve('question 0 answer', 3)).toHaveLength(1)
  })

  it('reclaims redundant raw interactions while preserving approved knowledge', async () => {
    vi.stubGlobal('localStorage', new LimitedStorage(12_000))
    const corpus = new CorpusRepository()
    await admittedChat(corpus, 0)
    await expect(admittedChat(corpus, 1)).resolves.toBeDefined()
    expect(corpus.getApprovedCount()).toBe(2)
    const knowledge = corpus.listKnowledge(10)
    expect(knowledge).toHaveLength(2)
    expect(knowledge.map(record => record.metadata.input)).toEqual(expect.arrayContaining(['question 0', 'question 1']))
    // The same recovery path keeps subsequent learning events recording instead of dropping them silently.
    expect(await recordLearningEvent(chat(2) as never, corpus)).toBe(true)
  })
})

describe('byte budget: the oldest records make room (owner ruling, 2026-11-12)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('evicts the oldest knowledge once over budget and keeps the newest — no browser wall involved', async () => {
    vi.stubGlobal('localStorage', new LimitedStorage(10_000_000)) // the wall never binds; only the budget can evict
    // 8,000 sits below the floor that knowledge + its raw interactions alone occupy, so the
    // ladder's earlier stages (candidate churn, raw reclaim) cannot hold the budget by
    // themselves — the oldest knowledge itself has to go. (At a roomier budget the ladder
    // correctly spends everything else first and the knowledge all survives.)
    const corpus = new CorpusRepository({}, { maxStorageChars: 8_000 })
    for (let i = 0; i < 6; i++) await admittedChat(corpus, i)
    const knowledge = corpus.listKnowledge(20)
    const inputs = knowledge.map(record => record.metadata.input)
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge.length).toBeLessThan(6)
    expect(inputs).toContain('question 5') // the newest learning is preserved
    expect(inputs).not.toContain('question 0') // the oldest was evicted to hold the budget
    expect(corpusStorageChars()).toBeLessThan(11_000) // budget + the last intake's own writes
  })

  it('at a zero budget only the record just written survives its own append', async () => {
    vi.stubGlobal('localStorage', new LimitedStorage(10_000_000))
    const corpus = new CorpusRepository({}, { maxStorageChars: 0 })
    await admittedChat(corpus, 0)
    await admittedChat(corpus, 1)
    const knowledge = corpus.listKnowledge(20)
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].metadata.input).toBe('question 1')
  })

  it('keeps admitting at the browser wall by evicting the oldest knowledge', async () => {
    vi.stubGlobal('localStorage', new LimitedStorage(20_000))
    const corpus = new CorpusRepository() // default budget: here the browser's wall is what binds
    for (let i = 0; i < 8; i++) await admittedChat(corpus, i) // must not throw
    const inputs = corpus.listKnowledge(20).map(record => record.metadata.input)
    expect(inputs).toContain('question 7')
    expect(inputs).not.toContain('question 0')
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
