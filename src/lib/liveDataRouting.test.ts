import { describe, expect, it } from 'vitest'
import { buildKalshiQuery, buildLiveSearchQuery, isLiveDataQuestion, routeLiveDataQuestion } from './liveDataRouting'

const sat = new Date('2026-10-17T18:00:00Z')

describe('isLiveDataQuestion', () => {
  it.each([
    'Is there any UFC fights tonight',
    'Is there any UFC fights tonight?',
    'what time is the Broncos game today',
    "what's the weather",
    'who won the Lakers game last night? final score',
    'any news today about wind turbine blade recalls',
    'hey, are there any fights this weekend?',
  ])('routes: %s', text => expect(isLiveDataQuestion(text)).toBe(true))

  it.each([
    'what is the current state of the forgeclaw repo',
    'is the build passing today',
    'fix the bug in the shell tool today',
    'explain how fight or flight works',
    'what is a heat engine',
    'write a poem about tonight',
    '',
    'x'.repeat(300),
    'line one\nis there a UFC fight tonight',
  ])('leaves on the normal path: %s', text => expect(isLiveDataQuestion(text)).toBe(false))
})

describe('buildLiveSearchQuery', () => {
  it('adds the real date to tonight/today questions', () => {
    expect(buildLiveSearchQuery('Is there any UFC fights tonight?', sat)).toBe('Is there any UFC fights tonight Saturday, October 17, 2026')
  })
  it('uses the next day for tomorrow', () => {
    expect(buildLiveSearchQuery('what time is the game tomorrow', sat)).toContain('Sunday, October 18, 2026')
  })
  it('strips politeness and trailing punctuation', () => {
    expect(buildLiveSearchQuery('please tell me the weather forecast?!', sat)).toBe('the weather forecast')
  })
})

describe('routeLiveDataQuestion', () => {
  it('returns a web_search call with a note', () => {
    const call = routeLiveDataQuestion('Is there any UFC fights tonight', sat)!
    expect(call.name).toBe('web_search')
    expect(call.input.count).toBe(5)
    expect(call.input.query).toContain('UFC')
    expect(call.notes?.[0]).toContain('web search')
    expect(call.error).toBeUndefined()
  })
  it('returns null otherwise', () => expect(routeLiveDataQuestion('what is the forgeclaw repo state today', sat)).toBeNull())
  it('passes the weather day as a number, matching the tool schema', () => {
    const call = routeLiveDataQuestion("what's the weather in Oklahoma City tomorrow", sat)!
    expect(call.name).toBe('weather_forecast')
    expect(call.input.day).toBe(1)
  })
})

describe('Kalshi questions route to the live kalshi_markets API', () => {
  it('routes a Kalshi question to kalshi_markets with the topic as query', () => {
    const call = routeLiveDataQuestion('What does Kalshi say about the Chiefs game tonight?', sat)!
    expect(call.name).toBe('kalshi_markets')
    expect(call.input.query).toBe('chiefs')
    expect(call.input.limit).toBe(10)
    expect(call.notes?.[0]).toContain('kalshi_markets')
  })
  it('routes a Kalshi question with no live-topic or time word (it used to fall through to model memory)', () => {
    const call = routeLiveDataQuestion("what's the Kalshi price on bitcoin?", sat)!
    expect(call.name).toBe('kalshi_markets')
    expect(call.input.query).toBe('bitcoin')
  })
  it('a bare Kalshi question lists markets with no query filter', () => {
    const call = routeLiveDataQuestion('what does kalshi say?', sat)!
    expect(call.name).toBe('kalshi_markets')
    expect(call.input.query).toBeUndefined()
  })
  it('leaves ForgeClaw questions that mention Kalshi on the normal path', () => {
    expect(routeLiveDataQuestion('is the kalshi snapshot workflow running today', sat)).toBeNull()
    expect(routeLiveDataQuestion('fix the kalshi panel in the repo', sat)).toBeNull()
  })
  it('buildKalshiQuery keeps content words only, capped at 3', () => {
    expect(buildKalshiQuery('What does Kalshi say about the Chiefs game tonight?')).toBe('chiefs')
    expect(buildKalshiQuery('kalshi odds on the fed rate decision in december')).toBe('fed rate decision')
    expect(buildKalshiQuery('what does kalshi say?')).toBe('')
  })
})

describe('routeLiveDataQuestion freshness', () => {
  it('routes a live question to web_search with a past-week timelimit', () => {
    const call = routeLiveDataQuestion('Is there any UFC fights tonight', new Date('2026-10-31T12:00:00Z'))!
    expect(call.name).toBe('web_search')
    expect(call.input.timelimit).toBe('w')
  })
})
