import { describe, expect, it } from 'vitest'
import { getBestProvider, isNexusIntelligenceProvider, sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'
import { FORGE_TOOLS } from '../forgeTools'
import { nexusDispatchToolNames } from '../toolExposure'

const TOOLS = [{ name: 'nexus_reason', description: 'reason', parameters: {} }]
const CALL_SEGMENT = '<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"package.json"}}<|/call|>'
const ANSWER_SEGMENT = '<|ev:verified|><|answer|>The package is named forgeclaw.<|/answer|><|end|>'

function nexusResult(segment: string, id = 'nexus-1'): string {
  return `✓ Nexus Intelligence completed as ${id} on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; checkpoint=nexus-run25-sha256-c41852fb0ac1.\nRun: https://github.com/DeviousDevv303/forgeclaw/actions/runs/1\n\n${segment}`
}

describe('Nexus Intelligence router loop', () => {
  it('is registered as its own provider, distinct from the Qwen walk', async () => {
    expect(isNexusIntelligenceProvider('nexus-intelligence')).toBe(true)
    expect(isNexusIntelligenceProvider('qwen')).toBe(false)
    await expect(getBestProvider('', 'nexus-intelligence')).resolves.toEqual({ providerId: 'nexus-intelligence', model: 'nexus-run25', level: 1 })
  })

  it('bootstraps a nexus_reason dispatch for a fresh message', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content: 'github_read_file path="package.json"' }], tools: TOOLS }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
      expect(result.response.toolCalls?.[0]?.input.task).toBe('github_read_file path="package.json"')
      expect(result.response.toolCalls?.[0]?.input.context).toBeUndefined()
    }
  })

  it('turns a call segment into a normal app tool call', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'github_read_file path="package.json"' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'github_read_file path="package.json"' } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(CALL_SEGMENT) },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-tool-call' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('github_read_file')
      expect(result.response.toolCalls?.[0]?.input).toEqual({ path: 'package.json' })
    }
  })

  it('re-dispatches with the tool result injected into the transcript after the app runs the call', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'github_read_file path="package.json"' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'github_read_file path="package.json"' } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(CALL_SEGMENT) },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'github_read_file', input: { path: 'package.json' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"name":"forgeclaw"}' },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
      expect(result.response.toolCalls?.[0]?.input.context).toBe('<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"package.json"}}<|/call|><|result:ok|>{"name":"forgeclaw"}<|/result|>')
    }
  })

  it('returns the answer text when a continuation segment answers', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'github_read_file path="package.json"' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b2', name: 'nexus_reason', input: { task: 'github_read_file path="package.json"' } }] },
        { role: 'tool', tool_call_id: 'b2', content: nexusResult(ANSWER_SEGMENT, 'nexus-2') },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', text: 'The package is named forgeclaw.', stopReason: 'nexus-synthesis-complete' } })
  })

  it('surfaces a failed nexus_reason dispatch as a terminal error', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'hello' } }] },
        { role: 'tool', tool_call_id: 'b1', content: '[TOOL ERROR] nexus-dispatch failed: GitHub 404' },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toContain('nexus-dispatch failed')
  })

  it('dispatches when the offered tools are the ones the app offers the Nexus provider', async () => {
    // The seam that broke in production: App.tsx offers the Nexus provider its tools via
    // nexusDispatchToolNames, and the router dispatches only if nexus_reason is among them.
    // Building the request's tools from that same offering pins the two sides together.
    const offered = FORGE_TOOLS.filter(t => nexusDispatchToolNames('nexus-intelligence').includes(t.name))
    expect(offered.map(t => t.name)).toEqual(['nexus_reason'])
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }], tools: offered }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
  })

  it('refuses to pretend when the nexus_reason tool is unavailable', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }], tools: [] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toContain('nexus-not-dispatched')
  })
})
