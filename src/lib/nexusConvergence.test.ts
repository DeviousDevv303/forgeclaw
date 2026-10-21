// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildLearningEvent } from './learningEvents'
import { convergencePhase, PLAYBOOK_SOURCE, VISITOR_SOURCE_ID } from './nexusConvergence'
import { BROWSER_PLAYBOOK_SOURCE } from './browserLearning'
import { VISITOR_SOURCE } from './nexusLearning'
import { corpusRepository, type LearningCandidate } from './corpus'
import { heuristicsForPrompt } from './nexusHeuristics'

const chat = (outcome: 'verified' | 'completed' | 'failed' | 'blocked', actor: 'user' | 'agent' = 'user') =>
  buildLearningEvent({ channel: 'chat', input: 'how many open PRs are there', result: 'Two: #209 and #210 (github_list_prs).', outcome, runtime: 'kimi', model: 'k2', actor })

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
