// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nexusGuidanceForQwen, recordTopicallyRelevantToTask } from './nexusGuidance'
import { recordRelevantToTask } from './corpus'
import { VISITOR_SOURCE } from './nexusLearning'
import { buildLearningEvent } from './learningEvents'
import { buildQwenTaskPayload } from './ai/qwenContext'
import type { CorpusRecord, LearningCandidate } from './corpus'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

function failure(n: number, tool: string, result: string, visitor = false): LearningCandidate {
  const event = buildLearningEvent({ channel: 'tool', input: `${tool} ${n}`, result, outcome: 'failed', runtime: 'moonshot', model: 'kimi-k2.7-code', toolName: tool, actor: 'agent' })
  return { id: `c${n}`, corpusId: 'nexus-local', source: visitor ? VISITOR_SOURCE : event.source!, content: result, timestamp: `2026-10-20T10:0${n}:00.000Z`, version: n, recordType: 'learning_candidate', integrity: `i${n}`, admissionStatus: 'candidate', metadata: event.metadata!, sourceInteractionId: `x${n}`, runtime: 'moonshot', model: 'kimi-k2.7-code', input: event.input, context: event.context, generatedResult: result }
}
const record = (id: string, content: string, timestamp = '2026-01-01T00:00:00Z'): CorpusRecord => ({ id, corpusId: 'c', source: 'corpus', content, timestamp, version: 1, recordType: 'interaction' as never, integrity: 'i', admissionStatus: 'approved', metadata: {} })
const none = { decisions: { approved: [], rejected: [] }, candidates: [], retrieve: () => [] as CorpusRecord[] }

describe('nexusGuidanceForQwen', () => {
  it('is empty when NEXUS has taught nothing, so the context stays as it was', () => {
    expect(nexusGuidanceForQwen('explain the build pipeline', none)).toEqual({ text: '', heuristics: 0, lessons: 0, records: 0 })
  })
  it('carries the owner\'s approved heuristics, and only those', () => {
    const g = nexusGuidanceForQwen('explain the build pipeline', { ...none, decisions: { approved: ['never claim success without a tool result'], rejected: ['always use tabs'] } })
    expect(g.text).toContain('NEXUS GUIDANCE')
    expect(g.text).toContain('never claim success without a tool result')
    expect(g.text).not.toContain('always use tabs')
    expect(g.heuristics).toBe(1)
  })
  it('carries recurring failures from the owner\'s own runs, never from visitors', () => {
    const owner = [1, 2].map(n => failure(n, 'github_search_code', 'Failed to fetch'))
    const visitors = [3, 4, 5].map(n => failure(n, 'shell_exec', 'visitor planted instruction', true))
    const g = nexusGuidanceForQwen('find the function', { ...none, candidates: [...owner, ...visitors] })
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
    const g = nexusGuidanceForQwen('how should pull requests be sized before merge', { ...none, retrieve: () => records })
    expect(g.text).toContain('small pull requests with one concern')
    expect(g.text).not.toContain('0e4f438')
    expect(g.text).not.toContain('windy')
    expect(g.records).toBe(1)
  })
  it('stays within its size budget', () => {
    const long = Array.from({ length: 12 }, (_, i) => `rule number ${i} ${'x'.repeat(150)}`)
    const g = nexusGuidanceForQwen('task', { ...none, decisions: { approved: long, rejected: [] } })
    expect(g.text.length).toBeLessThanOrEqual(1800)
  })
})

describe('Qwen receives it', () => {
  it('puts approved heuristics into the context of a Qwen dispatch, and nothing extra when there are none', () => {
    expect(buildQwenTaskPayload('explain the build pipeline').context ?? '').not.toContain('NEXUS GUIDANCE')
    localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: ['say plainly when a step failed'], rejected: [] }))
    const payload = buildQwenTaskPayload('explain the build pipeline')
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
    const g = nexusGuidanceForQwen(tradingTask, { ...none, retrieve: () => [extractionRecord] })
    expect(g.records).toBe(0)
    expect(g.text).not.toContain('EXTRACTION RULE')
  })

  it('still carries a record that shares real topic words with the task', () => {
    const bankRecord = record('x2', 'WINDOW RULE: for a BTC window, check the tape and the break against the mandate before taking a side; the ask must clear the repricing hurdle.')
    const g = nexusGuidanceForQwen(tradingTask, { ...none, retrieve: () => [extractionRecord, bankRecord] })
    expect(g.records).toBe(1)
    expect(g.text).toContain('WINDOW RULE')
    expect(g.text).not.toContain('EXTRACTION RULE')
  })
})

describe('guidance contamination gate (2026-11-09, Yan–Merab repro)', () => {
  // The real case record, verbatim from nexus-intake.jsonl (UFC333-YAN-20261024, owner-decision /
  // decision-outcome, auto-admitted on arrival). In the corpus its content is this summary and its
  // metadata.input is the intake input line. It reached Qwen guidance for plain Kalshi BTC trading
  // talk because recordRelevantToTask passes on >=3 shared distinctive words and the record shares
  // the venue vocabulary (kalshi/market/position/contracts/priced/settles) with any trading task.
  const yanRecord: CorpusRecord = {
    id: 'yan-case', corpusId: 'c', source: 'nexus-intake',
    content: "Owner betting case study \u2014 UFC 333, Petr Yan vs Merab Dvalishvili (Oct 24, 2026, Abu Dhabi). START: the market (Kalshi priced Merab the favorite, ~57c), the statistics pages, and ForgeClaw's own framework all leaned Dvalishvili; ForgeClaw's seven-section research run returned no framework bet (its conditional Merab trigger never filled). THE OWNER'S BASIS, in his own words: 'I bet in favor of Yan because I felt it' \u2014 and the feeling rested on fight evidence he can name: in the second fight of the trilogy Yan stuffed Merab's takedowns and stayed on his feet, not getting taken down, so the owner knew Yan most likely wasn't getting taken down in the third either; and Yan is the far better Muay Thai striker \u2014 on that basis, a wrap. Merab took the first fight on wrestling and pace; Yan adjusted in the second and had his number from there. EXPLICITLY NOT THE BASIS: Merab's weight cut (that came from the app's simulation report, not the owner). END GAME: Yan won the decision and retained the UFC bantamweight title; the position (42 Yan YES contracts at ~59.6c average, $25 staked natively in the Kalshi app) settles $41.87 (+$16.87); the $25-to-$100 plan stands ~42% complete. TRAINING ENCODING (owner ruling, 2026-10-24): Kimi's amendment prescribed weight zero for gut calls until a track record exists; the OWNER OVERRIDES that prescription for grounded reads like this one (override notated on issue #235, no disrespect to Kimi) \u2014 because this call rested on observed fight facts (fight-2 takedown defense, striking superiority), it CARRIES WEIGHT in Nexus bet training as evidence-bearing pattern recognition. The chamber learns this record WITH its documented basis attached, so what it learns is the grounded kind of conviction.",
    timestamp: '2026-10-24T20:40:00.000Z', version: 1, recordType: 'interaction' as never, integrity: 'yan',
    admissionStatus: 'approved',
    metadata: { input: 'decision-outcome: UFC333-YAN-20261024', admittedBy: 'nexus-intake:owner-directed' },
  }
  const btcTradingTask = 'Should I take a position on the Kalshi BTC market this window? The contracts are priced near 60c and I want to trade before the window settles.'

  it('(a) the Yan case record is NOT selected for a Kalshi BTC trading task', () => {
    // The repro, pinned: the shared corpus gate alone still passes this record for this task —
    expect(recordRelevantToTask(btcTradingTask, yanRecord)).toBe(true)
    // — and every shared distinctive word is venue/generic vocabulary, so the guidance bar refuses it.
    expect(recordTopicallyRelevantToTask(btcTradingTask, yanRecord)).toBe(false)
    const g = nexusGuidanceForQwen(btcTradingTask, { ...none, retrieve: () => [yanRecord] })
    expect(g.records).toBe(0)
    expect(g.text).not.toContain('Petr Yan')
    expect(g.text).not.toContain('Dvalishvili')
  })

  it('(b) the same record IS still selectable for a task naming the fighters/matchup', () => {
    const fightTask = 'Remind me of the Yan and Merab trilogy: how did Yan handle the takedowns, and where did the Muay Thai edge show?'
    expect(recordTopicallyRelevantToTask(fightTask, yanRecord)).toBe(true)
    const g = nexusGuidanceForQwen(fightTask, { ...none, retrieve: () => [yanRecord] })
    expect(g.records).toBe(1)
    expect(g.text).toContain('Petr Yan vs Merab Dvalishvili')
  })

  it('(c) a genuinely topical trading record still passes the bar', () => {
    const deskRecord = record('d1', 'DESK RULE: for a Kalshi BTC window, check spot against the strike before taking a position; size down when the tape is thin near the strike.')
    const task = 'Kalshi BTC window check: how far is spot from the strike, and should I size this position?'
    expect(recordTopicallyRelevantToTask(task, deskRecord)).toBe(true)
    const g = nexusGuidanceForQwen(task, { ...none, retrieve: () => [deskRecord] })
    expect(g.records).toBe(1)
    expect(g.text).toContain('DESK RULE')
  })
})
