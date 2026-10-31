// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nexusGuidanceForDeepSeek } from './nexusGuidance'
import { VISITOR_SOURCE } from './nexusLearning'
import { buildLearningEvent } from './learningEvents'
import { buildDeepSeekTaskPayload } from './ai/deepseekContext'
import type { CorpusRecord, LearningCandidate } from './corpus'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

function failure(n: number, tool: string, result: string, visitor = false): LearningCandidate {
  const event = buildLearningEvent({ channel: 'tool', input: `${tool} ${n}`, result, outcome: 'failed', runtime: 'moonshot', model: 'kimi-k2.7-code', toolName: tool, actor: 'agent' })
  return { id: `c${n}`, corpusId: 'nexus-local', source: visitor ? VISITOR_SOURCE : event.source!, content: result, timestamp: `2026-10-20T10:0${n}:00.000Z`, version: n, recordType: 'learning_candidate', integrity: `i${n}`, admissionStatus: 'candidate', metadata: event.metadata!, sourceInteractionId: `x${n}`, runtime: 'moonshot', model: 'kimi-k2.7-code', input: event.input, context: event.context, generatedResult: result }
}
const record = (id: string, content: string, timestamp = '2026-01-01T00:00:00Z'): CorpusRecord => ({ id, corpusId: 'c', source: 'corpus', content, timestamp, version: 1, recordType: 'interaction' as never, integrity: 'i', admissionStatus: 'approved', metadata: {} })
const none = { decisions: { approved: [], rejected: [] }, candidates: [], retrieve: () => [] as CorpusRecord[] }

describe('nexusGuidanceForDeepSeek', () => {
  it('is empty when NEXUS has taught nothing, so the context stays as it was', () => {
    expect(nexusGuidanceForDeepSeek('explain the build pipeline', none)).toEqual({ text: '', heuristics: 0, lessons: 0, records: 0 })
  })
  it('carries the owner\'s approved heuristics, and only those', () => {
    const g = nexusGuidanceForDeepSeek('explain the build pipeline', { ...none, decisions: { approved: ['never claim success without a tool result'], rejected: ['always use tabs'] } })
    expect(g.text).toContain('NEXUS GUIDANCE')
    expect(g.text).toContain('never claim success without a tool result')
    expect(g.text).not.toContain('always use tabs')
    expect(g.heuristics).toBe(1)
  })
  it('carries recurring failures from the owner\'s own runs, never from visitors', () => {
    const owner = [1, 2].map(n => failure(n, 'github_search_code', 'Failed to fetch'))
    const visitors = [3, 4, 5].map(n => failure(n, 'shell_exec', 'visitor planted instruction', true))
    const g = nexusGuidanceForDeepSeek('find the function', { ...none, candidates: [...owner, ...visitors] })
    expect(g.text).toContain('github_search_code failed 2x with: Failed to fetch')
    expect(g.text).not.toContain('visitor planted instruction')
    expect(g.lessons).toBe(1)
  })
  it('carries approved knowledge relevant to the task whatever its age, but not stale repository state', () => {
    const records = [
      record('1', 'The owner prefers small pull requests with one concern, and wants the build checked before any merge.'),
      record('2', 'repo: o/r HEAD: 0e4f438f77c704fe7bcc6af3fa63685511877527 defaultBranch: main pull requests small'),
      record('3', 'Weather in Oklahoma City is usually windy.'),
    ]
    const g = nexusGuidanceForDeepSeek('how should pull requests be sized before merge', { ...none, retrieve: () => records })
    expect(g.text).toContain('small pull requests with one concern')
    expect(g.text).not.toContain('0e4f438')
    expect(g.text).not.toContain('windy')
    expect(g.records).toBe(1)
  })
  it('stays within its size budget', () => {
    const long = Array.from({ length: 12 }, (_, i) => `rule number ${i} ${'x'.repeat(150)}`)
    const g = nexusGuidanceForDeepSeek('task', { ...none, decisions: { approved: long, rejected: [] } })
    expect(g.text.length).toBeLessThanOrEqual(1800)
  })
})

describe('DeepSeek receives it', () => {
  it('puts approved heuristics into the context of a DeepSeek dispatch, and nothing extra when there are none', () => {
    expect(buildDeepSeekTaskPayload('explain the build pipeline').context ?? '').not.toContain('NEXUS GUIDANCE')
    localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: ['say plainly when a step failed'], rejected: [] }))
    const payload = buildDeepSeekTaskPayload('explain the build pipeline')
    expect(payload.context).toContain('NEXUS GUIDANCE')
    expect(payload.context).toContain('say plainly when a step failed')
    expect(payload.task).toBe('explain the build pipeline')
  })
})

describe('guidance record relevance (2026-10-30 bleed fix)', () => {
  // The incident: a trading question was answered with entity-extraction text. The old gate
  // counted any two shared >=4-letter words — stopwords included — so this record passed it
  // (shared: "should", "with") while sharing ZERO topic words with the task.
  const tradingTask = 'Should I take the NO side on this window, with the mandate at 7.40 and the ask at 84, tape at minus 22 bps and the break intact?'
  const extractionRecord = record('x1', 'EXTRACTION RULE: the extraction should rerun with an override when the entity pass leaves the home team and the visitors unnamed; that is the standing rule for the process.')

  it('does not carry a record that shares only function words with the task', () => {
    const g = nexusGuidanceForDeepSeek(tradingTask, { ...none, retrieve: () => [extractionRecord] })
    expect(g.records).toBe(0)
    expect(g.text).not.toContain('EXTRACTION RULE')
  })

  it('still carries a record that shares real topic words with the task', () => {
    const bankRecord = record('x2', 'WINDOW RULE: for a BTC window, check the tape and the break against the mandate before taking a side; the ask must clear the repricing hurdle.')
    const g = nexusGuidanceForDeepSeek(tradingTask, { ...none, retrieve: () => [extractionRecord, bankRecord] })
    expect(g.records).toBe(1)
    expect(g.text).toContain('WINDOW RULE')
    expect(g.text).not.toContain('EXTRACTION RULE')
  })
})
