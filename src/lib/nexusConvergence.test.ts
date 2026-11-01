// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildLearningEvent } from './learningEvents'
import { answerOutcome, convergencePhase, INTAKE_ADMITTED_BY, knowledgeOrigin, OWNER_ADMITTED_BY, PLAYBOOK_SOURCE, VISITOR_SOURCE_ID } from './nexusConvergence'
import { BROWSER_PLAYBOOK_SOURCE } from './browserLearning'
import { VISITOR_SOURCE } from './nexusLearning'
import { corpusRepository, type LearningCandidate } from './corpus'
import { heuristicsForPrompt } from './nexusHeuristics'

const chat = (outcome: 'verified' | 'completed' | 'failed' | 'blocked', actor: 'user' | 'agent' = 'user') =>
  buildLearningEvent({ channel: 'chat', input: 'how many open PRs are there', result: 'Two: #209 and #210 (github_list_prs).', outcome, runtime: 'kimi', model: 'k2', actor, lineage: 'none' })

describe('what converges into knowledge by itself', () => {
  beforeEach(() => localStorage.clear())
  it('pins the shared source names', () => {
    expect(PLAYBOOK_SOURCE).toBe(BROWSER_PLAYBOOK_SOURCE)
    expect(VISITOR_SOURCE_ID).toBe(VISITOR_SOURCE)
  })
  it('First Principles: the owner\'s task answered with tool evidence', () => {
    expect(convergencePhase(chat('verified'))).toBe('first_principles')
  })
  it('never: an answer with no evidence, a failure, a block, an agent record or a visitor', () => {
    expect(convergencePhase(chat('completed'))).toBeNull()
    expect(convergencePhase(chat('failed'))).toBeNull()
    expect(convergencePhase(chat('blocked'))).toBeNull()
    expect(convergencePhase(chat('verified', 'agent'))).toBeNull()
    expect(convergencePhase({ ...chat('verified'), source: VISITOR_SOURCE })).toBeNull()
  })
  it('a visitor is refused on any one of its three markers, even a record claiming "verified"', () => {
    const verified = chat('verified')
    expect(convergencePhase({ ...verified, source: VISITOR_SOURCE })).toBeNull()
    expect(convergencePhase({ ...verified, metadata: { ...verified.metadata, channel: 'visitor' }, context: verified.context.replace('channel=chat', 'channel=visitor') })).toBeNull()
    expect(convergencePhase({ ...verified, metadata: { ...verified.metadata, visitor: 'v-123' } })).toBeNull()
  })
  it('a verified answer is stored as approved knowledge, marked and never served verbatim', async () => {
    await corpusRepository.appendInteraction(chat('verified'))
    const known = corpusRepository.retrieve('how many open PRs', 3)
    expect(known).toHaveLength(1)
    expect(known[0].metadata).toMatchObject({ admittedBy: 'nexus-convergence', phase: 'first_principles' })
    expect(corpusRepository.getConvergedCounts()).toEqual({ first_principles: 1 })
    expect(corpusRepository.getApprovedCount()).toBe(1)
    expect(corpusRepository.checkNexusKnowledge('how many open PRs')).toBeNull()
  })
  it('an auto-admitted entry is stamped with its phase and time, and the owner can remove it for good', async () => {
    await corpusRepository.appendInteraction(chat('verified'))
    const [candidate] = corpusRepository.listCandidates(5)
    expect(candidate.metadata).toMatchObject({ admittedBy: 'nexus-convergence', phase: 'first_principles' })
    expect(Number.isNaN(Date.parse(String(candidate.metadata.admittedAt)))).toBe(false)
    expect(await corpusRepository.rejectCandidate(candidate.id, 'removed by the owner')).not.toBeNull()
    expect(corpusRepository.retrieve('how many open PRs', 3)).toEqual([])
    expect(corpusRepository.getApprovedCount()).toBe(0)
    expect(corpusRepository.listCandidates(5)[0].admissionStatus).toBe('rejected')
    // the same thing happening again does not bring it back
    await corpusRepository.appendInteraction(chat('verified'))
    expect(corpusRepository.retrieve('how many open PRs', 3)).toEqual([])
    expect(corpusRepository.getApprovedCount()).toBe(0)
  })
  it('an unverified answer stays a candidate', async () => {
    await corpusRepository.appendInteraction(chat('completed'))
    expect(corpusRepository.retrieve('how many open PRs', 3)).toEqual([])
    expect(corpusRepository.listCandidates(5)[0].admissionStatus).toBe('candidate')
  })
})

describe('Heuristics: the owner\'s rules are active without approval', () => {
  const said = (id: string, input: string) => ({ id, input, timestamp: '2026-10-21T00:00:00Z', source: 'learning:chat', metadata: { channel: 'chat', actor: 'user' } } as unknown as LearningCandidate)
  it('a rule said twice reaches the prompt; a removed one does not', () => {
    const c = [said('a', 'always verify the exit code'), said('b', 'always verify the exit code')]
    expect(heuristicsForPrompt({ approved: [], rejected: [] }, c)).toContain('- always verify the exit code')
    expect(heuristicsForPrompt({ approved: [], rejected: ['always verify the exit code'] }, c)).toBe('')
  })
})

describe('knowledge: listed, labelled by origin, removable', () => {
  beforeEach(() => localStorage.clear())
  it('labels each origin', () => {
    expect(knowledgeOrigin({ timestamp: '2026-10-21T22:00:00Z', metadata: { admittedBy: 'nexus-convergence' } })).toBe('AUTO-ADDED')
    expect(knowledgeOrigin({ timestamp: '2026-10-24T22:00:00Z', metadata: { admittedBy: INTAKE_ADMITTED_BY } })).toBe('AUTO-ADDED · AUDIT-ADJUDICATED')
    expect(knowledgeOrigin({ timestamp: '2026-10-24T22:00:00Z', metadata: { admittedBy: OWNER_ADMITTED_BY } })).toBe('AUTO-ADDED · OWNER-DIRECTED')
    expect(knowledgeOrigin({ timestamp: '2026-10-02T12:00:00Z', metadata: {} })).toMatch(/^LEGACY · admitted without review/)
    expect(knowledgeOrigin({ timestamp: '2026-10-20T12:00:00Z', metadata: {} })).toBe('ADMITTED · origin not recorded')
  })
  it('lists only knowledge, and removing an auto-added entry keeps it from coming back', async () => {
    await corpusRepository.appendInteraction(chat('completed'))
    expect(corpusRepository.listKnowledge()).toEqual([])
    await corpusRepository.appendInteraction(chat('verified'))
    const [known] = corpusRepository.listKnowledge()
    expect(known.metadata.admittedBy).toBe('nexus-convergence')
    expect(corpusRepository.removeKnowledge(known.id)).toBe(true)
    expect(corpusRepository.listKnowledge()).toEqual([])
    expect(corpusRepository.getApprovedCount()).toBe(0)
    await corpusRepository.appendInteraction(chat('verified'))
    expect(corpusRepository.listKnowledge()).toEqual([])
    expect(corpusRepository.removeKnowledge('knowledge-nope')).toBe(false)
  })
  it('removes a legacy entry written by the old unsigned path', () => {
    const legacy = { id: 'knowledge-legacy1', corpusId: 'nexus-local', source: 'forgeclaw', content: 'old answer', timestamp: '2026-10-02T12:00:00.000Z', version: 1, recordType: 'knowledge', integrity: 'legacy1', admissionStatus: 'approved', metadata: { input: 'old question', runtime: 'corpus', model: 'corpus', sourceInteractionId: 'interaction-legacy1' } }
    localStorage.setItem('forgeclaw_nexus_record_v1:knowledge-legacy1', JSON.stringify(legacy))
    localStorage.setItem('forgeclaw_nexus_index_v1', JSON.stringify(['knowledge-legacy1']))
    expect(corpusRepository.listKnowledge().map(k => k.id)).toEqual(['knowledge-legacy1'])
    expect(knowledgeOrigin(corpusRepository.listKnowledge()[0])).toMatch(/^LEGACY/)
    expect(corpusRepository.removeKnowledge('knowledge-legacy1')).toBe(true)
    expect(corpusRepository.getApprovedCount()).toBe(0)
    expect(localStorage.getItem('forgeclaw_nexus_record_v1:knowledge-legacy1')).toBeNull()
  })
  it('counts only evidence-backed knowledge as training data, not legacy entries', async () => {
    const legacy = { id: 'knowledge-legacy2', corpusId: 'nexus-local', source: 'forgeclaw', content: 'una Personen Thanksgiving skew', timestamp: '2026-10-02T12:00:00.000Z', version: 1, recordType: 'knowledge', integrity: 'legacy2', admissionStatus: 'approved', metadata: { input: 'hi', model: 'qwen2.5-3b' } }
    localStorage.setItem('forgeclaw_nexus_record_v1:knowledge-legacy2', JSON.stringify(legacy))
    localStorage.setItem('forgeclaw_nexus_index_v1', JSON.stringify(['knowledge-legacy2']))
    await corpusRepository.appendInteraction(chat('verified'))
    expect(corpusRepository.getApprovedCount()).toBe(2)
    expect(corpusRepository.getTrainingCount()).toBe(1)
  })
})

describe('only real evidence makes an answer "verified"', () => {
  // 2026-10-22: DeepSeek answered "there are no pending PRs" (PR #223 was open) with only its own reasoning call behind it.
  it('a model\'s own reasoning is not evidence', () => {
    expect(answerOutcome(false, [{ name: 'deepseek_reason' }])).toBe('completed')
    expect(answerOutcome(false, [{ name: 'ask_deepseek' }, { name: 'review_code' }, { name: 'coding_task_update' }])).toBe('completed')
  })
  it('a real tool result is, even alongside reasoning', () => {
    expect(answerOutcome(false, [{ name: 'deepseek_reason' }, { name: 'github_list_prs' }])).toBe('verified')
    expect(answerOutcome(false, [{ name: 'shell_exec' }])).toBe('verified')
  })
  it('a failed evidence tool does not count, and a blocked run is blocked', () => {
    expect(answerOutcome(false, [{ name: 'github_list_prs', isError: true }])).toBe('completed')
    expect(answerOutcome(true, [{ name: 'github_list_prs' }])).toBe('blocked')
    expect(answerOutcome(false, [])).toBe('completed')
  })
})
