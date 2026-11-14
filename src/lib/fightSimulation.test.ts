// @vitest-environment node
// The in-house fight simulation that replaces MiroFish (owner order 2026-11-14: "We need to fix this to work correctly" after
// "Run a simulation of josh hokit vs ciryl gane ..." returned word salad). A research step gathers one public-facts packet; a
// fixed set of persona agents each give a probability from the SAME packet; the app aggregates deterministically and labels the
// result as what it is: model personas, never evidence about the fight. These tests pin that contract with scripted models.
import { describe, expect, it } from 'vitest'
import {
  aggregateVerdicts, formatSimulation, parseMatchup, parsePersonaReply, PERSONAS, pickSimulationProvider, runFightSimulation, SIMULATION_MIN_VALID,
  type PersonaVerdict,
} from './fightSimulation'

describe('parseMatchup: who fights whom, from the owner\'s own wording', () => {
  it.each([
    ['Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday tomorrows ufc bout', 'Josh Hokit', 'Ciryl Gane'],
    ['simulate Yan vs Dvalishvili', 'Yan', 'Dvalishvili'],
    ['run a sim of Gane versus Hokit', 'Gane', 'Hokit'],
    ['Start a simulation of petr yan v. merab dvalishvili on the card', 'Petr Yan', 'Merab Dvalishvili'],
    ['run a simulation on Hokit vs Gane.', 'Hokit', 'Gane'],
  ])('%j', (text, a, b) => {
    expect(parseMatchup(text)).toEqual({ a, b })
  })

  it('returns null when no two sides are named', () => {
    expect(parseMatchup('run a simulation')).toBeNull()
    expect(parseMatchup('simulate the main event')).toBeNull()
    expect(parseMatchup('')).toBeNull()
  })
})

describe('pickSimulationProvider: a capable hosted model, whichever provider is selected', () => {
  const keys = { moonshot: 'sk-m', openrouter: 'sk-o' }
  const models = { moonshot: 'kimi-k2.7-code', openrouter: 'x/y' }

  it('uses the active provider when it is hosted and keyed', () => {
    expect(pickSimulationProvider({ active: 'openrouter', keys, models })).toEqual({ provider: 'openrouter', model: 'x/y', apiKey: 'sk-o' })
    expect(pickSimulationProvider({ active: 'moonshot', keys, models })).toEqual({ provider: 'moonshot', model: 'kimi-k2.7-code', apiKey: 'sk-m' })
  })
  it('under Nexus (or any non-hosted provider) falls back by priority: Kimi, then OpenRouter', () => {
    expect(pickSimulationProvider({ active: 'nexus-intelligence', keys, models })?.provider).toBe('moonshot')
    expect(pickSimulationProvider({ active: 'corpus', keys: { openrouter: 'sk-o' }, models })?.provider).toBe('openrouter')
  })
  it('ignores blank keys and returns null when no hosted key exists', () => {
    expect(pickSimulationProvider({ active: 'nexus-intelligence', keys: { moonshot: '  ', openrouter: '' }, models })).toBeNull()
    expect(pickSimulationProvider({ active: 'openrouter', keys: {}, models })).toBeNull()
  })
})

describe('parsePersonaReply: strict, never repaired', () => {
  it('accepts one JSON object, even inside chatter', () => {
    expect(parsePersonaReply('{"winner":"A","probability_a":0.62,"reason":"Better wrestling."}')).toEqual({ ok: true, probabilityA: 0.62, reason: 'Better wrestling.' })
    expect(parsePersonaReply('Sure! Here you go:\n{"winner":"B","probability_a":0.35,"reason":"Reach."} Hope that helps.')).toMatchObject({ ok: true, probabilityA: 0.35 })
  })
  it('refuses what cannot be read as a call, so a garbled persona is counted, not guessed', () => {
    for (const raw of ['', 'I think A wins', '{"winner":"A"}', '{"winner":"A","probability_a":1.4,"reason":"x"}', '{"winner":"A","probability_a":"high","reason":"x"}',
      '{"winner":"C","probability_a":0.6,"reason":"x"}', '{"winner":"A","probability_a":0.3,"reason":"contradicts itself"}', '{"winner":"B","probability_a":0.7,"reason":"contradicts"}']) {
      expect(parsePersonaReply(raw).ok).toBe(false)
    }
  })
  it('a 50% reply with either winner is a no-call, and an over-long or control-laden reason is cut and cleaned', () => {
    expect(parsePersonaReply('{"winner":"A","probability_a":0.5,"reason":"Coin flip."}')).toEqual({ ok: true, probabilityA: 0.5, reason: 'Coin flip.' })
    const long = parsePersonaReply(`{"winner":"A","probability_a":0.6,"reason":"${'x'.repeat(400)}\\u0007bell"}`)
    expect(long.ok && long.reason.length).toBeLessThanOrEqual(200)
    expect(long.ok && Array.from(long.reason).some(ch => ch.charCodeAt(0) < 32)).toBe(false)
  })
})

describe('aggregateVerdicts', () => {
  const v = (id: string, p: number): PersonaVerdict => ({ id, role: id, probabilityA: p, reason: '' })
  it('median, range and the pick counts, with 50% as no call', () => {
    expect(aggregateVerdicts([v('a', 0.6), v('b', 0.55), v('c', 0.7), v('d', 0.5), v('e', 0.62)])).toEqual({ valid: 5, median: 0.6, min: 0.5, max: 0.7, picksA: 4, picksB: 0, noCall: 1 })
    expect(aggregateVerdicts([v('a', 0.3), v('b', 0.4), v('c', 0.8), v('d', 0.45)])).toMatchObject({ valid: 4, median: 0.425, picksA: 1, picksB: 3 })
  })
})

describe('runFightSimulation: orchestration with scripted models', () => {
  const matchup = { a: 'Josh Hokit', b: 'Ciryl Gane' }
  const reply = (p: number, reason = 'because') => JSON.stringify({ winner: p > 0.5 ? 'A' : 'B', probability_a: p, reason })
  const askBy = (byRole: Record<string, string | Error>) => async (system: string) => {
    const persona = PERSONAS.find(x => system.includes(x.role))!
    const out = byRole[persona.id]
    if (out instanceof Error) throw out
    return out
  }
  const all = (p: number) => Object.fromEntries(PERSONAS.map(x => [x.id, reply(p)]))

  it('five valid personas: every one sees the same packet and the two named fighters, and the report states what it is', async () => {
    const seen: string[] = []
    const outcome = await runFightSimulation(matchup, {
      research: async () => 'PACKET: Hokit 6-0, Gane 13-2, five rounds.',
      ask: async (system, task) => { seen.push(task); return askBy(all(0.6))(system) },
    })
    expect(PERSONAS).toHaveLength(5)
    expect(seen).toHaveLength(5)
    for (const task of seen) { expect(task).toContain('PACKET: Hokit 6-0'); expect(task).toContain('Josh Hokit'); expect(task).toContain('Ciryl Gane') }
    expect(outcome.inconclusive).toBe(false)
    expect(outcome.aggregate).toMatchObject({ valid: 5, median: 0.6, picksA: 5 })
    const text = formatSimulation(outcome, 'Kimi · kimi-k2.7-code')
    expect(text).toMatch(/Josh Hokit vs Ciryl Gane/)
    expect(text).toMatch(/Kimi · kimi-k2.7-code/)
    expect(text).toMatch(/not evidence about the fight/i)
    expect(text).toMatch(/unverified model output/i)
    expect(text).toMatch(/Nothing here moves a stake/)
    expect(text).toMatch(/Median Josh Hokit 60%/)
    for (const p of PERSONAS) expect(text).toContain(p.role)
  })

  it('a garbled or failing persona is counted and named, never fatal and never guessed', async () => {
    const byRole = { ...all(0.6), [PERSONAS[1].id]: 'word salad', [PERSONAS[2].id]: new Error('provider 500') }
    const outcome = await runFightSimulation(matchup, { research: async () => 'p', ask: askBy(byRole) })
    expect(outcome.aggregate?.valid).toBe(3)
    expect(outcome.invalidRoles).toEqual([PERSONAS[1].role, PERSONAS[2].role])
    const text = formatSimulation(outcome, 'Kimi')
    expect(text).toMatch(/3 of 5/)
    expect(text).toContain(PERSONAS[1].role)
  })

  it(`fewer than ${SIMULATION_MIN_VALID} valid personas is inconclusive: no median is invented`, async () => {
    const byRole = { ...all(0.6), [PERSONAS[0].id]: 'x', [PERSONAS[1].id]: 'y', [PERSONAS[2].id]: 'z' }
    const outcome = await runFightSimulation(matchup, { research: async () => 'p', ask: askBy(byRole) })
    expect(outcome.inconclusive).toBe(true)
    const text = formatSimulation(outcome, 'Kimi')
    expect(text).toMatch(/inconclusive/i)
    expect(text).not.toMatch(/Median/)
  })

  it('a failed or empty research step is stated in the report, and the personas still run on the names alone', async () => {
    for (const research of [async () => { throw new Error('search down') }, async () => '', async () => '(no response)']) {
      const outcome = await runFightSimulation(matchup, { research, ask: askBy(all(0.55)) })
      expect(outcome.researchOk).toBe(false)
      expect(formatSimulation(outcome, 'Kimi')).toMatch(/no research was gathered/i)
    }
  })

  it('stops at once if the request was aborted, and does not run personas', async () => {
    const controller = new AbortController(); controller.abort()
    let asked = 0
    await expect(runFightSimulation(matchup, { research: async () => 'p', ask: async () => { asked++; return '' }, signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(asked).toBe(0)
  })
})
