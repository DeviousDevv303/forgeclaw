// 2026-11-01 graded failure (Muse, #235): "what happened at UFC last night" was answered with the September 19
// card relabelled as last night's, plus a KO and an opponent no source carried. Each gate below closes one link.
import { describe, expect, it } from 'vitest'
import { formatDdgResults, STALE_RESULTS_NOTE } from './ddgWorkflowSearch'
import { buildLiveAnswerTask, cleanSearchDisplay, groundedLiveAnswer, liveAnswerDateLine, unsupportedNames } from './liveAnswer'
import { buildLiveSearchQuery, routeLiveDataQuestion } from './liveDataRouting'

const NOW = new Date('2026-11-01T15:00:00Z')
const OLD_HITS = [
  { title: 'UFC 331 results: Van defeats Pantoja', href: 'https://example.test/ufc331', body: 'September 19, 2026 — Joshua Van retained against Alexandre Pantoja.' },
]
const LAST_NIGHT_HITS = [
  { title: 'UFC Fight Night 292 results', href: 'https://example.test/ufn292', body: 'Tom Nolan def. Renato Moicano by TKO in round 3; Jacobe Smith def. Randy Brown by unanimous decision.' },
]

describe('stale results are labelled, never passed off as fresh', () => {
  it('an unfiltered fallback carries the stale note; a time-limited hit does not', () => {
    const stale = formatDdgResults('q', 5, [{ query: 'q', results: OLD_HITS, freshness: 'unfiltered-fallback' }])
    expect(stale).toContain(STALE_RESULTS_NOTE)
    expect(cleanSearchDisplay(stale)).toContain(STALE_RESULTS_NOTE) // the user-facing fallback keeps it
    const fresh = formatDdgResults('q', 5, [{ query: 'q', results: LAST_NIGHT_HITS, freshness: 'timelimit=w' }])
    expect(fresh).not.toContain(STALE_RESULTS_NOTE)
  })
})

describe('just-past questions take the dated live path', () => {
  for (const q of ['what happened at UFC last night?', 'UFC results last night?', 'how did the UFC fights go yesterday', 'who won UFC last night?']) {
    it(`routes "${q}" to a web search dated October 31`, () => {
      const call = routeLiveDataQuestion(q, NOW)
      expect(call?.name).toBe('web_search')
      expect(String(call?.input.query)).toContain('October 31, 2026')
      expect(call?.input.timelimit).toBe('w')
    })
  }
  it('today and tomorrow keep their own dates', () => {
    expect(buildLiveSearchQuery('any UFC fights tonight?', NOW)).toContain('November 1, 2026')
    expect(buildLiveSearchQuery('UFC fights tomorrow?', NOW)).toContain('November 2, 2026')
  })
})

describe('the synthesis hop knows the date it is judging against', () => {
  it('states today and the day asked about', () => {
    expect(liveAnswerDateLine('UFC results last night?', NOW)).toBe("Today's date is Sunday, November 1, 2026. The question asks about Saturday, October 31, 2026.")
    expect(buildLiveAnswerTask('UFC results last night?', 'hits', NOW)).toContain('The question asks about Saturday, October 31, 2026.')
    expect(buildLiveAnswerTask('UFC results last night?', 'hits', NOW)).toContain('Never present an event from another date as the one asked about.')
  })
})

describe('grounding gate: every name in the answer must be in the results', () => {
  const raw = formatDdgResults('q', 5, [{ query: 'q', results: LAST_NIGHT_HITS, freshness: 'timelimit=w' }])
  it('passes an answer built from the results', () => {
    const a = 'Tom Nolan beat Renato Moicano by TKO in round 3, and Jacobe Smith beat Randy Brown by decision.'
    expect(unsupportedNames(a, raw)).toEqual([])
    expect(groundedLiveAnswer(a, raw)).toBe(a)
  })
  it('withholds the fabricated shape: a fighter and finish no source carries', () => {
    const a = 'Natalia Silva won the title, and Gable Steveson scored a KO.'
    expect(unsupportedNames(a, raw)).toEqual(expect.arrayContaining(['Natalia', 'Silva', 'Gable', 'Steveson']))
    expect(groundedLiveAnswer(a, raw)).toBe('')
  })
  it('accents and case do not cause a false withhold', () => {
    expect(unsupportedNames('Jean-Paul Lebosnoyani won.', 'jean-paul lebosnoyani def. farman hasanov')).toEqual([])
    expect(unsupportedNames('Lucía Szabová won.', 'Lucia Szabova def. Tainara Lisboa')).toEqual([])
  })
  it('a grounded answer from stale results is shown with the stale note in front', () => {
    const staleRaw = formatDdgResults('q', 5, [{ query: 'q', results: OLD_HITS, freshness: 'unfiltered-fallback' }])
    const out = groundedLiveAnswer('Joshua Van beat Alexandre Pantoja on September 19.', staleRaw)
    expect(out.startsWith(STALE_RESULTS_NOTE)).toBe(true)
  })
  it('an empty draft stays empty', () => expect(groundedLiveAnswer('', raw)).toBe(''))
})
