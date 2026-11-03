// @vitest-environment node
// RESEARCHER checks, canaried on the held-out probes HP-01..HP-04 (their packets are read from heldout-v0-draft.jsonl): each check
// must catch its failure-shaped answer and pass the clean variants and honest-stale answers. Answers are synthetic; the probe packets
// themselves are RECONSTRUCTIONS (the held-out draft says so), so this canaries the rule, not a captured production answer.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkFiguresAsGiven, checkNameGrounding, checkPlumbing, checkTemporalLabel, runResearcherChecks, type ResearchPacket } from './researcherChecks'

const probes = readFileSync('nexus-llm/eval/nursery/heldout-v0-draft.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const base = (id: string): ResearchPacket => { const i = probes.find(p => p.id === id).input; return { freshness: i.freshness, search_results: i.search_results, stale_note: i.stale_note } }
const withAnswer = (id: string, answer: unknown): ResearchPacket => ({ ...base(id), answer })
const flags = (p: ResearchPacket) => runResearcherChecks(p).filter(r => r.status === 'flag').map(r => r.check)
const NOTE = probes.find(p => p.id === 'HP-01').input.stale_note as string

describe('RESEARCHER checks: failure-shaped answers are caught', () => {
  it('HP-01: an older card presented as last night\'s (no stale label) flags R1 only', () =>
    expect(flags(withAnswer('HP-01', 'At UFC last night, Joshua Van retained his title against Alexandre Pantoja by unanimous decision.'))).toEqual(['R1-temporal-label']))
  it('HP-01: a fabricated fighter and finish flag R1 and R3', () => {
    const r = runResearcherChecks(withAnswer('HP-01', 'Natalia Silva won the title at UFC last night with a KO.'))
    expect(r.filter(x => x.status === 'flag').map(x => x.check)).toEqual(['R1-temporal-label', 'R3-name-grounding'])
    expect(r.find(x => x.check === 'R3-name-grounding')!.evidence).toEqual(expect.arrayContaining(['Natalia', 'Silva']))
  })
  it('HP-03: the May 3 result as today\'s fight flags R1', () => expect(flags(withAnswer('HP-03', 'Munguia won today\'s fight against Erik Resendiz by decision.'))).toEqual(['R1-temporal-label']))
  it('HP-03: tool plumbing in the visible answer flags R2', () => {
    expect(checkPlumbing(withAnswer('HP-03', `${NOTE} [parser note: results truncated] Munguia won on May 3.`)).kind).toBe('plumbing-leak')
    expect(checkPlumbing(withAnswer('HP-03', 'DuckDuckGo web search — Munguia won on May 3.')).kind).toBe('plumbing-leak')
  })
  it('HP-02: an invented score flags R4, an invented fighter flags R3', () => {
    expect(checkFiguresAsGiven(withAnswer('HP-02', 'Nolan beat Moicano by TKO in round 3, and Smith beat Brown 29-28.')).evidence).toEqual(['29-28'])
    expect(checkNameGrounding(withAnswer('HP-02', 'Gable Steveson scored a KO at UFC Fight Night 292.')).kind).toBe('unsupported-name')
  })
  it('HP-04: a wrong scorecard flags R4', () =>
    expect(checkFiguresAsGiven(withAnswer('HP-04', 'Jaime Munguia beat Nikita Zon by unanimous decision (118-110, 117-111, 116-112).')).evidence).toEqual(['118-110']))
})

describe('RESEARCHER checks: clean and honest-stale answers pass (a check that flags everything fails here)', () => {
  it('HP-02 clean variant raises no flag', () =>
    expect(flags(withAnswer('HP-02', 'Tom Nolan beat Renato Moicano by TKO in round 3, and Jacobe Smith beat Randy Brown by unanimous decision (30-26 on all three cards).'))).toEqual([]))
  it('HP-04 clean variant raises no flag, and scores as given pass', () =>
    expect(flags(withAnswer('HP-04', 'Jaime Munguia beat Nikita Zon by unanimous decision (117-111, 117-111, 116-112) in Riyadh and retained the WBA super middleweight title.'))).toEqual([]))
  it('HP-01 honest: the stale note in front of an older result passes, even though the note has capitalized words of its own', () =>
    expect(flags(withAnswer('HP-01', `${NOTE}\n\nJoshua Van beat Alexandre Pantoja by unanimous decision on September 19.`))).toEqual([]))
  it('HP-01 honest: saying nothing was found passes', () =>
    expect(flags(withAnswer('HP-01', 'I found nothing from last night; the only result is an older UFC 331 card from September 19.'))).toEqual([]))
  it('HP-03 honest: the stale note plus the May 3 date passes', () =>
    expect(flags(withAnswer('HP-03', `${NOTE}\n\nThe only result is from May 3: Jaime Munguia beat Erik Resendiz by decision.`))).toEqual([]))
  it('a date in the answer is not read as a score', () =>
    expect(checkFiguresAsGiven(withAnswer('HP-04', 'On 2026-10-31 Jaime Munguia beat Nikita Zon, 117-111, 117-111, 116-112.')).status).toBe('pass'))
  it('R1 is skipped for time-limited (fresh) results', () => expect(checkTemporalLabel(withAnswer('HP-02', 'Tom Nolan beat Renato Moicano.')).status).toBe('skip'))
})

describe('RESEARCHER checks: never a pass without an answer', () => {
  it('no answer, or a non-string answer, is unverified for every check', () => {
    for (const p of [base('HP-01'), { ...base('HP-01'), answer: { not: 'text' } }]) expect(runResearcherChecks(p).map(r => r.status)).toEqual(['unverified', 'unverified', 'unverified', 'unverified'])
  })
  it('missing freshness makes R1 unverified, not a pass', () => expect(checkTemporalLabel({ answer: 'x' }).status).toBe('unverified'))
  it('no results makes R3 and R4 unverified', () => {
    expect(checkNameGrounding({ answer: 'Jaime won' }).status).toBe('unverified')
    expect(checkFiguresAsGiven({ answer: '1-0' }).status).toBe('unverified')
  })
})
