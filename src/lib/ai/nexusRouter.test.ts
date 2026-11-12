import { describe, expect, it } from 'vitest'
import { getBestProvider, isNexusIntelligenceProvider, sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'
import { FORGE_TOOLS } from '../forgeTools'
import { isRouterIssued, nexusDispatchToolNames } from '../toolExposure'

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

  it('routes an image request through the Nexus dispatch — no refusal, no intercept', async () => {
    // Owner's correction (2026-11-11): "Nexus has an image generator." The generate-image
    // workflow is part of Nexus Intelligence (ForgeClaw is its body), so an image request
    // under the Nexus provider dispatches to Nexus like any other turn (bootstrap
    // nexus_reason, the image request as the task). The retired behaviors: the refusal
    // ('nexus-image-not-served') and the silent direct-image intercept that dispatched
    // diffusion and attributed the turn to Nexus without Nexus deciding.
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content: 'generate an image of a lighthouse' }], tools: TOOLS }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
      expect(result.response.toolCalls?.[0]?.input.task).toBe('generate an image of a lighthouse')
      expect(result.response.text).not.toMatch(/can't generate images/)
    }
  })

  it('executes a generate_image segment through the nexus-tool-call route', async () => {
    const segment = '<|route:tool|><|call|>{"name":"generate_image","arguments":{"prompt":"a lighthouse at dusk"}}<|/call|>'
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'generate an image of a lighthouse' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'generate an image of a lighthouse' } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(segment) },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-tool-call' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('generate_image')
      // The chat attaches the picture only for ids with this prefix (App.tsx), so the model-issued call needs it too.
      expect(result.response.toolCalls?.[0]?.id.startsWith('direct-image-')).toBe(true)
      expect(result.response.toolCalls?.[0]?.input).toEqual({ prompt: 'a lighthouse at dusk' })
    }
  })

  // THE IMAGE GUARANTEE (owner, 2026-11-11: "Need to make sure it actually calls on the Nexus Intelligence LLM image
  // generator we made it"). Live defect the same day, 10:15 CST: an image request under Nexus came back as a fragment of
  // trading grammar and no image, because the checkpoint's segment did not call generate_image.
  describe('the image guarantee', () => {
    const ask = 'generate an image of a lighthouse'
    const afterNexus = (segment: string): AIRequest => ({
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: ask },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: ask } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(segment) },
      ],
    })

    it('calls the generator when the Nexus segment answers in text instead', async () => {
      const result = await sendViaRouter(afterNexus('<|ev:verified|><|answer|>Verdict: CON rate style with a str finished: CONFIRMED.<|/answer|><|end|>'), '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-image-generator' } })
      if (result.success) {
        expect(result.response.toolCalls).toHaveLength(1)
        expect(result.response.toolCalls?.[0]?.name).toBe('generate_image')
        expect(String(result.response.toolCalls?.[0]?.input.prompt)).toMatch(/lighthouse/)
        expect(result.response.toolCalls?.[0]?.id.startsWith('direct-image-guaranteed-')).toBe(true)
        expect(isRouterIssued(result.response.stopReason)).toBe(true)
      }
    })

    it('calls the generator when the Nexus segment calls some other tool', async () => {
      const result = await sendViaRouter(afterNexus(CALL_SEGMENT), '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-nexus-image-generator' } })
      if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('generate_image')
    })

    it('ends the turn naming the generator and who called it, without re-dispatching Nexus', async () => {
      const request = afterNexus(ANSWER_SEGMENT)
      request.messages.push(
        { role: 'assistant', content: '', tool_calls: [{ id: 'direct-image-guaranteed-1', name: 'generate_image', input: { prompt: 'a lighthouse' } }] },
        { role: 'tool', tool_call_id: 'direct-image-guaranteed-1', content: 'Image generated with Stable Diffusion v1.5.' },
      )
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-image-generator-complete' } })
      if (result.success) {
        expect(result.response.toolCalls ?? []).toHaveLength(0)
        expect(result.response.text).toMatch(/Nexus Intelligence's image generator/)
        expect(result.response.text).toMatch(/language model did not issue the call/)
      }
    })

    it('never attributes a model-issued image call to the router', async () => {
      const segment = '<|route:tool|><|call|>{"name":"generate_image","arguments":{"prompt":"a lighthouse at dusk"}}<|/call|>'
      const first = await sendViaRouter(afterNexus(segment), '', 'nexus-intelligence')
      expect(first).toMatchObject({ success: true, response: { stopReason: 'nexus-tool-call' } })
      if (!first.success) return
      const callId = first.response.toolCalls?.[0]?.id ?? ''
      expect(callId.startsWith('direct-image-nexus-')).toBe(true)
      const request = afterNexus(segment)
      request.messages.push(
        { role: 'assistant', content: '', tool_calls: [{ id: callId, name: 'generate_image', input: { prompt: 'a lighthouse at dusk' } }] },
        { role: 'tool', tool_call_id: callId, content: 'Image generated with Stable Diffusion v1.5.' },
      )
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      if (result.success) {
        expect(result.response.stopReason).not.toBe('nexus-image-generator-complete')
        expect(result.response.text ?? '').not.toMatch(/did not issue the call/)
      }
    })

    it('reports a failed generator call as a failure, not as a picture', async () => {
      const request = afterNexus(ANSWER_SEGMENT)
      request.messages.push(
        { role: 'assistant', content: '', tool_calls: [{ id: 'direct-image-guaranteed-1', name: 'generate_image', input: { prompt: 'a lighthouse' } }] },
        { role: 'tool', tool_call_id: 'direct-image-guaranteed-1', content: '[TOOL ERROR] No GitHub token configured.' },
      )
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.message).toMatch(/No GitHub token configured/)
    })

    it('leaves a non-image Nexus turn alone', async () => {
      const request: AIRequest = {
        model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
        messages: [
          { role: 'user', content: 'what is the package name?' },
          { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'what is the package name?' } }] },
          { role: 'tool', tool_call_id: 'b1', content: nexusResult(ANSWER_SEGMENT) },
        ],
      }
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { stopReason: 'nexus-synthesis-complete' } })
    })
  })

  it('other providers still get the direct image dispatch', async () => {
    const request: AIRequest = { model: 'qwen3-8b', systemPrompt: '', messages: [{ role: 'user', content: 'generate an image of a lighthouse' }], tools: [] }
    const result = await sendViaRouter(request, '', 'qwen')
    expect(result).toMatchObject({ success: true, response: { provider: 'qwen', stopReason: 'direct-image-intent' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('generate_image')
  })

  it('refuses to pretend when the nexus_reason tool is unavailable', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }], tools: [] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toContain('nexus-not-dispatched')
  })
})
