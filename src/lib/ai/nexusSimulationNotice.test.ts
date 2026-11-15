// @vitest-environment node
// A simulation request under the Nexus provider is answered by the router itself (no checkpoint dispatch): the checkpoint
// cannot run a simulation, nothing else can either (MiroFish was removed 2026-11-14), and a dispatch would spend a GitHub
// Actions run to print word salad (owner report 2026-11-14).
import { describe, expect, it } from 'vitest'
import { sendViaRouter } from './providerRouter'
import { SIMULATION_UNAVAILABLE_NOTICE } from '../simulationRequest'
import type { AIRequest } from './types'

const TOOLS = [{ name: 'nexus_reason', description: 'reason', parameters: {} }]
const ask = (content: string): AIRequest => ({ model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content }], tools: TOOLS })

describe('Nexus router: a simulation request', () => {
  it('is answered with the deterministic notice, no tool call, and no checkpoint dispatch', async () => {
    const result = await sendViaRouter(ask('Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday tomorrows ufc bout'), '', 'nexus-intelligence')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.toolCalls ?? []).toEqual([])
    expect(result.response.stopReason).toBe('deterministic-nexus-simulation-notice')
    expect(result.response.provider).toBe('nexus-intelligence')
    expect(result.response.text).toBe(SIMULATION_UNAVAILABLE_NOTICE)
    // Provider truth: the standing "this is the Nexus checkpoint answering alone" note is for model text, and none was produced.
    expect(result.response.text).not.toMatch(/checkpoint answering alone/)
  })

  it('still dispatches Nexus for everything else, including talk about simulations', async () => {
    for (const text of ['what is a simulation?', 'tell me about Hokit vs Gane', 'github_read_file path="package.json"']) {
      const result = await sendViaRouter(ask(text), '', 'nexus-intelligence')
      expect(result.success).toBe(true)
      if (!result.success) continue
      expect(result.response.stopReason).toBe('deterministic-nexus-reasoning')
      expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
    }
  })

  it('does not interrupt a turn already in progress: a later segment is still handled by the loop', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'run a simulation of the card' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'run a simulation of the card' } }] },
        { role: 'tool', tool_call_id: 'b1', content: '✓ Nexus Intelligence completed as nexus-1 on o/r@main.\nStages: dispatch=accepted; checkpoint=nexus-run25-sha256-c41852fb0ac1.\n\n<|ev:verified|><|answer|>ok<|/answer|><|end|>' },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(true)
    if (result.success) expect(result.response.stopReason).not.toBe('deterministic-nexus-simulation-notice')
  })
})
