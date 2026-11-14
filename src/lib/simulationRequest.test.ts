// @vitest-environment node
// 2026-11-14 owner report: under the Nexus provider "Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday"
// came back as word salad. MiroFish (the only simulation tool) was removed at the owner's order, so nothing in the app
// handles a simulation request, and the Nexus checkpoint cannot run the in-house swarm yet. Detection is deliberately
// narrow: an explicit request to RUN a simulation, never talk about simulations.
import { describe, expect, it } from 'vitest'
import { isSimulationRequest, SIMULATION_UNAVAILABLE_NOTICE } from './simulationRequest'

describe('isSimulationRequest: explicit requests to run a simulation', () => {
  it.each([
    'Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday tomorrows ufc bout',
    'run a sim of Yan vs Dvalishvili',
    'Start the swarm simulation for UFC 333',
    'please launch a simulation on this fight',
    'rerun the sim on the main event',
    'kick off a simulation of the card',
    'perform a simulation of Gane vs Hokit',
    'simulate the Hokit vs Gane fight',
    'Simulate this bout: Yan versus Dvalishvili',
    'run a swarm sim',
  ])('detects %j', (text) => {
    expect(isSimulationRequest(text)).toBe(true)
  })

  it('ignores the application\'s own runtime envelope appended to a message', () => {
    expect(isSimulationRequest('hello\n\n[RUNTIME_STATE x]\nrun a simulation\n[/RUNTIME_STATE]')).toBe(false)
    expect(isSimulationRequest('run a simulation of Gane vs Hokit\n\n[RUNTIME_STATE x]\nstuff\n[/RUNTIME_STATE]')).toBe(true)
  })
})

describe('isSimulationRequest: ordinary talk is left alone', () => {
  it.each([
    'what is a simulation?',
    'explain how the simulation lane worked before it was removed',
    'the simulation theory is interesting',
    'Monte Carlo simulation results look noisy',
    'I ran a simulation yesterday and it was great',
    'do you simulate emotions?',
    'simulate a keyboard in JavaScript',
    'tell me about Hokit vs Gane',
    'run the tests',
    'make me a picture of two fighters',
    '',
  ])('does not detect %j', (text) => {
    expect(isSimulationRequest(text)).toBe(false)
  })
})

describe('SIMULATION_UNAVAILABLE_NOTICE', () => {
  it('says plainly that nothing ran, why, and what works now, without claiming Nexus answered', () => {
    expect(SIMULATION_UNAVAILABLE_NOTICE).toMatch(/No simulation was run/)
    expect(SIMULATION_UNAVAILABLE_NOTICE).toMatch(/MiroFish/)
    expect(SIMULATION_UNAVAILABLE_NOTICE).toMatch(/Nexus was not asked/)
    expect(SIMULATION_UNAVAILABLE_NOTICE).toMatch(/Kimi or Claude/)
    expect(SIMULATION_UNAVAILABLE_NOTICE.length).toBeLessThan(800)
  })
})
