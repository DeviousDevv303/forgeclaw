import { describe, expect, it } from 'vitest'
import { getBestProvider, isNexusIntelligenceProvider, NEXUS_TEXT_ANSWER_NOTE, sendViaRouter } from './providerRouter'
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

  it('still dispatches a fourth call in the turn instead of hitting the call cap', async () => {
    // The frozen swarm benchmark expects up to 6 spawns in a turn (sw-018; sw-006
    // expects 4). With the old cap of 3, this fourth spawn segment came back as the
    // nexus-call-cap text and the spawn never ran — those rows were unpassable in
    // the app even for a perfect model.
    const spawnSegment = (task: string) => `<|route:tool|><|call|>${JSON.stringify({ name: 'spawn_agent', arguments: { system_prompt: 'You are a research agent.', task, tools: 'web_search' } })}<|/call|>`
    const messages: AIRequest['messages'] = [{ role: 'user', content: 'check the repo state, the test suite, and the docs, in parallel' }]
    for (let i = 1; i <= 3; i++) {
      messages.push(
        { role: 'assistant', content: '', tool_calls: [{ id: `b${i}`, name: 'nexus_reason', input: { task: 'check things in parallel' } }] },
        { role: 'tool', tool_call_id: `b${i}`, content: nexusResult(spawnSegment(`subtask ${i}`), `nexus-${i}`) },
        { role: 'assistant', content: '', tool_calls: [{ id: `s${i}`, name: 'spawn_agent', input: { system_prompt: 'You are a research agent.', task: `subtask ${i}`, tools: 'web_search' } }] },
        { role: 'tool', tool_call_id: `s${i}`, content: `Sub-agent ${i} completed and returned its findings.` },
      )
    }
    messages.push(
      { role: 'assistant', content: '', tool_calls: [{ id: 'b4', name: 'nexus_reason', input: { task: 'check things in parallel' } }] },
      { role: 'tool', tool_call_id: 'b4', content: nexusResult(spawnSegment('subtask 4'), 'nexus-4') },
    )
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', tools: TOOLS, messages }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-tool-call' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('spawn_agent')
      expect(result.response.toolCalls?.[0]?.input).toEqual({ system_prompt: 'You are a research agent.', task: 'subtask 4', tools: 'web_search' })
      expect(result.response.text).not.toMatch(/loop limit/)
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
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-synthesis-complete' } })
    // The answer is shown verbatim, followed by the standing capability note (owner report 2026-11-12).
    if (result.success) expect(result.response.text).toBe(`The package is named forgeclaw.\n\n${NEXUS_TEXT_ANSWER_NOTE}`)
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

  describe('attached photo analysis', () => {
    const photo = 'data:image/png;base64,aGVsbG8='
    const imageTools = [
      ...TOOLS,
      { name: 'analyze_image', description: 'Analyze attached image', parameters: {} },
    ]

    it('sends a Nexus photo turn to the vision workflow instead of the text-only checkpoint', async () => {
      const request: AIRequest = {
        model: 'nexus-run25', systemPrompt: '', tools: imageTools,
        messages: [{ role: 'user', content: 'What is in this photo? Please give me feedback.', image_url: photo }],
      }
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-image-analysis' } })
      if (result.success) {
        expect(result.response.toolCalls?.[0]).toMatchObject({ name: 'analyze_image', input: { image_url: 'attached', prompt: 'What is in this photo? Please give me feedback.' } })
        expect(result.response.toolCalls?.some(call => call.name === 'nexus_reason')).toBe(false)
      }
    })

    it('returns the actual vision result directly and never asks Nexus to rewrite it', async () => {
      const request: AIRequest = {
        model: 'nexus-run25', systemPrompt: '', tools: imageTools,
        messages: [
          { role: 'user', content: 'What is in this photo?', image_url: photo },
          { role: 'assistant', content: '', tool_calls: [{ id: 'vision-1', name: 'analyze_image', input: { image_url: 'attached' } }] },
          { role: 'tool', tool_call_id: 'vision-1', content: '✓ Image analysis by Qwen2-VL-2B (GitHub Actions, CPU) · run https://github.com/run/1\nA red bicycle leaning against a brick wall.' },
        ],
      }
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', model: 'Qwen2-VL-2B (GitHub Actions, CPU)', stopReason: 'nexus-image-analysis-complete' } })
      if (result.success) {
        expect(result.response.text).toContain('A red bicycle leaning against a brick wall.')
        expect(result.response.text).toContain('text-only Nexus checkpoint was not asked to interpret the image')
        expect(result.response.toolCalls ?? []).toHaveLength(0)
      }
    })

    it('surfaces vision-workflow failures instead of falling back to a Nexus guess', async () => {
      const request: AIRequest = {
        model: 'nexus-run25', systemPrompt: '', tools: imageTools,
        messages: [
          { role: 'user', content: 'Describe this picture', image_url: photo },
          { role: 'assistant', content: '', tool_calls: [{ id: 'vision-1', name: 'analyze_image', input: { image_url: 'attached' } }] },
          { role: 'tool', tool_call_id: 'vision-1', content: '[TOOL ERROR] image analysis run failed' },
        ],
      }
      const result = await sendViaRouter(request, '', 'nexus-intelligence')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.message).toContain('picture could not be analyzed')
    })
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

  it('cuts a repetition loop out of a Nexus answer, with the loop-cut marker visible', async () => {
    // The Nexus answer return gets the same truncateRepetitionLoop protection the Qwen path has:
    // the answer up to the loop is kept, the loop is cut, and the marker says so.
    const looped = '<|ev:verified|><|answer|>the market is closed today the market is closed today the market is closed today the market is closed today<|/answer|><|end|>'
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: TOOLS,
      messages: [
        { role: 'user', content: 'what is the package name?' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'what is the package name?' } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(looped) },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'nexus-synthesis-complete' } })
    if (result.success) {
      expect(result.response.text).toContain('[ForgeClaw cut the rest of this answer: the model fell into a repetition loop.]')
      expect(result.response.text?.match(/the market is closed today/g)).toHaveLength(1)
    }
  })

  it('names the un-run call at the loop cap instead of showing its JSON', async () => {
    const capSegment = '<|route:tool|><|call|>{"name":"funds_propose","arguments":{"market":"KXBTC-26JAN01","max_stake":0.57}}<|/call|>'
    const messages: AIRequest['messages'] = [{ role: 'user', content: 'propose a trade' }]
    for (const n of [1, 2, 3, 4, 5, 6]) {
      messages.push(
        { role: 'assistant', content: '', tool_calls: [{ id: `b${n}`, name: 'nexus_reason', input: { task: 'propose a trade' } }] },
        { role: 'tool', tool_call_id: `b${n}`, content: nexusResult(CALL_SEGMENT, `nexus-${n}`) },
        { role: 'assistant', content: '', tool_calls: [{ id: `c${n}`, name: 'github_read_file', input: { path: 'package.json' } }] },
        { role: 'tool', tool_call_id: `c${n}`, content: '{"name":"forgeclaw"}' },
      )
    }
    messages.push(
      { role: 'assistant', content: '', tool_calls: [{ id: 'b7', name: 'nexus_reason', input: { task: 'propose a trade' } }] },
      { role: 'tool', tool_call_id: 'b7', content: nexusResult(capSegment, 'nexus-7') },
    )
    const result = await sendViaRouter({ model: 'nexus-run25', systemPrompt: '', tools: TOOLS, messages }, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'nexus-call-cap' } })
    if (result.success) {
      expect(result.response.text).toContain('a call to `funds_propose` that was not run')
      expect(result.response.text).not.toContain('arguments')
      expect(result.response.text).not.toContain('max_stake')
    }
  })
})
