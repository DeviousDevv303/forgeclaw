// @vitest-environment node
// The glue between a chat request and the in-house fight simulation: matchup, hosted-model choice, the research sub-agent (with its
// two read-only tools) and the single-shot persona calls. Model calls are injected, so this tests the real decisions.
import { describe, expect, it, vi } from 'vitest'
import { runSimulationRequest } from './simulationRunner'
import { PERSONAS, SIMULATION_NEEDS_KEY_NOTICE, SIMULATION_NEEDS_SIDES_NOTICE } from './fightSimulation'

const reply = (p: number) => JSON.stringify({ winner: p > 0.5 ? 'A' : 'B', probability_a: p, reason: 'because' })
const base = {
  active: 'nexus-intelligence',
  keys: { moonshot: 'sk-m' }, models: { moonshot: 'kimi-k2.7-code' },
  allTools: [] as never[], toolCtx: {} as never, signal: undefined,
}

describe('runSimulationRequest', () => {
  it('names the missing piece instead of running: no two sides, or no hosted key', async () => {
    const runSubAgentFn = vi.fn(); const callProviderFn = vi.fn()
    const noSides = await runSimulationRequest('run a simulation', { ...base, runSubAgentFn, callProviderFn })
    expect(noSides).toMatchObject({ ok: false, text: SIMULATION_NEEDS_SIDES_NOTICE })
    const noKey = await runSimulationRequest('run a simulation of Hokit vs Gane', { ...base, keys: {}, runSubAgentFn, callProviderFn })
    expect(noKey).toMatchObject({ ok: false, text: SIMULATION_NEEDS_KEY_NOTICE })
    expect(runSubAgentFn).not.toHaveBeenCalled()
    expect(callProviderFn).not.toHaveBeenCalled()
  })

  it('runs on the hosted model even though Nexus is the selected provider: research with two read-only tools, then five persona calls', async () => {
    const runSubAgentFn = vi.fn(async () => 'Hokit 6-0, five rounds scheduled. Gane 13-2, former interim champion. Odds not found.')
    const callProviderFn = vi.fn(async () => ({ text: reply(0.4), provider: 'moonshot' as const, model: 'kimi-k2.7-code' }))
    const out = await runSimulationRequest('Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday', { ...base, runSubAgentFn, callProviderFn })
    expect(out.ok).toBe(true)
    expect(out.provider).toBe('moonshot')
    expect(out.model).toBe('kimi-k2.7-code')
    // the researcher: its tools are exactly these two reads, and it runs on the hosted provider, not on Nexus
    const [, task, tools, provider, model, apiKey] = runSubAgentFn.mock.calls[0] as unknown as [string, string, string[], string, string, string]
    expect(tools).toEqual(['web_search', 'espn_fight_stats'])
    expect(provider).toBe('moonshot'); expect(model).toBe('kimi-k2.7-code'); expect(apiKey).toBe('sk-m')
    expect(task).toContain('Josh Hokit'); expect(task).toContain('Ciryl Gane')
    // five single-shot persona calls, none of them with tools
    expect(callProviderFn).toHaveBeenCalledTimes(PERSONAS.length)
    for (const call of callProviderFn.mock.calls) {
      const args = call as unknown as [string, string, string, unknown[], string, { tools?: unknown }]
      expect(args[0]).toBe('moonshot'); expect(args[5]?.tools).toBeUndefined()
    }
    expect(out.text).toMatch(/Fight simulation: Josh Hokit vs Ciryl Gane/)
    expect(out.text).toMatch(/Median Josh Hokit 40% \/ Ciryl Gane 60%/)
    expect(out.text).toMatch(/not evidence about the fight/i)
  })

  it('a research failure does not stop the simulation, and the report says no research was gathered', async () => {
    const runSubAgentFn = vi.fn(async () => { throw new Error('search down') })
    const callProviderFn = vi.fn(async () => ({ text: reply(0.55), provider: 'moonshot' as const, model: 'm' }))
    const out = await runSimulationRequest('simulate Hokit vs Gane', { ...base, runSubAgentFn, callProviderFn })
    expect(out.ok).toBe(true)
    expect(out.text).toMatch(/No research was gathered/)
  })

  it('an inconclusive simulation is reported as not done, never as a result', async () => {
    const runSubAgentFn = vi.fn(async () => 'some facts about the fight, long enough to count as a packet')
    const callProviderFn = vi.fn(async () => ({ text: 'word salad', provider: 'moonshot' as const, model: 'm' }))
    const out = await runSimulationRequest('simulate Hokit vs Gane', { ...base, runSubAgentFn, callProviderFn })
    expect(out.ok).toBe(false)
    expect(out.text).toMatch(/Inconclusive/)
  })
})
