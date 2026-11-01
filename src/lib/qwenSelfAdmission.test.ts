// @vitest-environment jsdom
// Route C (owner directive, 2026-11-01): a Qwen answer paired with any successful evidence tool used to be recorded
// 'verified', admit itself by convergence, and come back to Qwen as owner-curated guidance. Machines do not promote
// machines: an answer with Qwen lineage stays a candidate whatever else succeeded in the turn.
import { beforeEach, describe, expect, it } from 'vitest'
import { corpusRepository, type CorpusRecord } from './corpus'
import { recordLearningEvent } from './learningEvents'
import { answerLineage, answerOutcome, CONVERGED_BY, hasQwenLineage } from './nexusConvergence'
import { nexusGuidanceForDeepSeek } from './nexusGuidance'

beforeEach(() => localStorage.clear())

/** Record one owner chat turn exactly the way App.tsx does (logToCorpus -> recordLearning), and return what Nexus did with it. */
async function chatTurn(task: string, answer: string, provider: string, model: string, tools: string[]) {
  const results = tools.map(name => ({ name }))
  await recordLearningEvent({ channel: 'chat', input: task, result: answer, outcome: answerOutcome(false, results),
    runtime: provider, model, lineage: answerLineage(provider, results) })
  const stored = corpusRepository.listCandidates(1000).find(c => c.content.includes(answer.slice(0, 20)))
  return {
    outcome: answerOutcome(false, results),
    admittedBy: stored?.metadata.admittedBy ?? null,
    retrievable: corpusRepository.retrieve(task, 10).some(r => r.content.includes(answer.slice(0, 20))),
    inGuidance: nexusGuidanceForDeepSeek(task).text.includes(answer.slice(0, 20)),
  }
}
const TASK = 'zebrafinch quarterly ledger reconciliation for the falcon account'

describe('Route C: Qwen answers never admit themselves', () => {
  it('(a) a Qwen answer plus a successful web_search stays a candidate: not admitted, not retrievable, not guidance', async () => {
    const r = await chatTurn(TASK, 'QWEN-A the falcon ledger total is 401', 'deepseek', 'deepseek-16b', ['web_search', 'deepseek_reason'])
    expect(r.outcome).toBe('verified') // the evidence gate still records what happened
    expect(r.admittedBy).toBeNull()
    expect(r.retrievable).toBe(false)
    expect(r.inGuidance).toBe(false)
  })

  it('(a2) the same when another provider ran Qwen as a tool in the turn', async () => {
    const r = await chatTurn(TASK, 'QWEN-A2 the falcon ledger total is 401', 'moonshot', 'kimi-k2.7-code', ['web_search', 'deepseek_reason'])
    expect(r.admittedBy).toBeNull()
    expect(r.inGuidance).toBe(false)
  })

  it('(b) an answer from another provider backed by evidence still admits itself (no regression)', async () => {
    const r = await chatTurn(TASK, 'OWNER-B the falcon ledger total is 391', 'moonshot', 'kimi-k2.7-code', ['web_search'])
    expect(r.outcome).toBe('verified')
    expect(r.admittedBy).toBe(CONVERGED_BY)
    expect(r.retrievable).toBe(true)
    expect(r.inGuidance).toBe(true)
  })

  it('(c) a Qwen answer alone is unchanged: completed, a candidate', async () => {
    const r = await chatTurn(TASK, 'QWEN-C the falcon ledger total is 401', 'deepseek', 'deepseek-16b', ['deepseek_reason'])
    expect(r.outcome).toBe('completed')
    expect(r.admittedBy).toBeNull()
    expect(r.inGuidance).toBe(false)
  })

  it('a Qwen-provider turn is caught by its runtime even when a caller wrongly states lineage none', async () => {
    await recordLearningEvent({ channel: 'chat', input: TASK, result: 'NOMARK the falcon ledger total is 401', outcome: 'verified', runtime: 'deepseek', model: 'deepseek-16b', lineage: 'none' })
    expect(corpusRepository.listCandidates(1000).find(c => c.content.startsWith('NOMARK'))?.metadata.admittedBy).toBeUndefined()
  })
})

describe('lineage helpers', () => {
  it('answerLineage: Qwen provider, or a Qwen tool anywhere in the turn', () => {
    expect(answerLineage('deepseek', [])).toBe('qwen')
    expect(answerLineage('corpus', [{ name: 'web_search' }])).toBe('qwen')
    expect(answerLineage('moonshot', [{ name: 'web_search' }, { name: 'ask_deepseek' }])).toBe('qwen')
    expect(answerLineage('moonshot', [{ name: 'web_search' }])).toBe('none')
    expect(answerLineage('anthropic', [])).toBe('none')
  })
  it('hasQwenLineage reads the marker, and for older records the runtime, the model id or the deepseek source', () => {
    expect(hasQwenLineage({ metadata: { lineage: 'qwen' } })).toBe(true)
    expect(hasQwenLineage({ context: 'channel=chat; outcome=verified; lineage=qwen' })).toBe(true)
    expect(hasQwenLineage({ metadata: { runtime: 'corpus', model: 'x' } })).toBe(true)
    expect(hasQwenLineage({ metadata: { runtime: 'moonshot', model: 'Qwen/Qwen3-8B' } })).toBe(true)
    expect(hasQwenLineage({ source: 'deepseek:github-actions' })).toBe(true)
    expect(hasQwenLineage({ metadata: { runtime: 'moonshot', model: 'kimi-k2.7-code' } })).toBe(false)
  })
})

describe('guidance says who vouched for a record', () => {
  const rec = (id: string, content: string, metadata: Record<string, string>): CorpusRecord =>
    ({ id, corpusId: 'c', source: 'learning:chat', content, timestamp: '2026-10-30T00:00:00Z', version: 1, recordType: 'interaction' as never, integrity: id, admissionStatus: 'approved', metadata })
  const none = { decisions: { approved: [], rejected: [] }, candidates: [] }
  const task = 'falcon ledger reconciliation zebrafinch quarterly account'

  it('a legacy converged record with Qwen lineage (admitted before this fix) never reaches a prompt', () => {
    const legacy = rec('l1', 'LEGACY-QWEN falcon ledger reconciliation zebrafinch quarterly account total 401', { admittedBy: CONVERGED_BY, runtime: 'deepseek', model: 'deepseek-16b' })
    const g = nexusGuidanceForDeepSeek(task, { ...none, retrieve: () => [legacy] })
    expect(g.text).not.toContain('LEGACY-QWEN')
    expect(g.records).toBe(0)
  })

  it('a converged record is never labeled as curated by the owner', () => {
    const learned = rec('c1', 'LEARNED falcon ledger reconciliation zebrafinch quarterly account total 391', { admittedBy: CONVERGED_BY, runtime: 'moonshot', model: 'kimi-k2.7-code' })
    const g = nexusGuidanceForDeepSeek(task, { ...none, retrieve: () => [learned] })
    expect(g.text).toContain('LEARNED')
    expect(g.text).toContain('not reviewed by the owner')
    expect(g.text).not.toContain('curated by the owner')
  })

  it('an owner-admitted record, Qwen lineage or not, keeps the curated label', () => {
    const owned = rec('o1', 'OWNED falcon ledger reconciliation zebrafinch quarterly account total 391', { admittedBy: 'owner-signature', runtime: 'deepseek', model: 'deepseek-16b' })
    const g = nexusGuidanceForDeepSeek(task, { ...none, retrieve: () => [owned] })
    expect(g.text).toContain('OWNED')
    expect(g.text).toContain('curated by the owner')
    expect(g.text).not.toContain('not reviewed by the owner')
  })
})
