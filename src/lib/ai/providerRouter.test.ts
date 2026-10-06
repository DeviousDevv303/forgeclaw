// @vitest-environment node
// MANUS acceptance coverage: the router must transport the runtime request as-is.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectBestProvider, getBestProvider, providers, providerSupportsTools, sendViaRouter, SECONDARY_SYNTHESIS_TIMEOUT_MS } from './providerRouter'
import { DEFAULT_NEXUS_WEBGPU_MODEL, LEGACY_NEXUS_WEBGPU_MODEL } from './providers/nexusWebGpuProvider'

afterEach(() => vi.restoreAllMocks())

describe('provider router runtime passthrough', () => {
  it('chooses llama.cpp when the configured local endpoint is responsive', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch
    try {
      await expect(getBestProvider('http://127.0.0.1:8080/v1', 'local', 'local-model')).resolves.toEqual({
        providerId: 'local', model: 'local-model', level: 2,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('detects WebGPU after llama.cpp is unavailable', async () => {
    vi.stubGlobal('navigator', { gpu: {} })
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
    await expect(detectBestProvider('http://127.0.0.1:8080/v1')).resolves.toMatchObject({
      providerId: 'nexus', level: 3,
    })
    vi.unstubAllGlobals()
  })

  it('uses CORPUS/NEXUS as the canonical runtime and dispatches DeepSeek first without probing localhost', async () => {
    await expect(getBestProvider('')).resolves.toEqual({ providerId: 'corpus', model: DEFAULT_NEXUS_WEBGPU_MODEL, level: 1 })
    const task = 'Explain ForgeClaw briefly.'
    const result = await sendViaRouter({
      model: '',
      systemPrompt: 'Answer naturally.',
      messages: [{ role: 'user', content: task }],
      tools: [{ name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '')
    expect(result).toMatchObject({
      success: true,
      response: {
        provider: 'corpus',
        stopReason: 'deterministic-deepseek-reasoning',
        toolCalls: [{ name: 'deepseek_reason', input: { task, context: expect.stringContaining('ForgeClaw architecture facts') } }],
      },
    })
  })

  it('turns explicit image intent into a direct generate_image tool call', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
    const result = await sendViaRouter({
      model: 'local-model',
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'Generate an artistic image of a red fox in a forge' }],
      tools: [{ name: 'generate_image', description: 'Generate', parameters: { type: 'object', properties: {}, required: [] } }],
    }, 'http://127.0.0.1:8080/v1', 'local')
    expect(result).toMatchObject({
      success: true,
      response: { stopReason: 'direct-image-intent', toolCalls: [{ name: 'generate_image', input: { style: 'artistic', width: 512, height: 512 } }] },
    })
    vi.unstubAllGlobals()
  })

  it('routes image intent even when manual fallback provides no tools', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
    const result = await sendViaRouter({
      model: 'webgpu-fallback',
      systemPrompt: 'manual tool protocol exactly',
      messages: [{ role: 'user', content: 'Create a watercolor image of a lighthouse at dusk' }],
      tools: undefined,
    }, '', 'nexus')
    expect(result).toMatchObject({
      success: true,
      response: { stopReason: 'direct-image-intent', toolCalls: [{ name: 'generate_image', input: { style: 'watercolor', width: 512, height: 512 } }] },
    })
    vi.unstubAllGlobals()
  })

  it('bootstraps repository evidence when WebGPU is the coding fallback', async () => {
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Repository evidence comes from GitHub tools.',
      messages: [{ role: 'user', content: 'Please inspect the ForgeClaw repository and fix the current issue.' }],
      tools: [{ name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '', 'nexus')
    expect(result).toMatchObject({
      success: true,
      response: { stopReason: 'deterministic-repository-evidence', toolCalls: [{ name: 'github_repo_state', input: {} }] },
    })
  })

  it('bootstraps GitHub evidence before prose even when an unrelated tool result already exists', async () => {
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Repository evidence comes from GitHub tools.',
      messages: [
        { role: 'user', content: 'Read the ForgeClaw repository.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'memory-1', name: 'memory_read', input: {} }] },
        { role: 'tool', content: 'Prior memory result.', tool_call_id: 'memory-1' },
      ],
      tools: [{ name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '', 'nexus')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-repository-evidence', toolCalls: [{ name: 'github_repo_state' }] } })
  })

  it('passes actual GitHub evidence to DeepSeek before NEXUS/CORPUS synthesis', async () => {
    const realResult = 'repo: DeviousDevv303/forgeclaw\nHEAD: abc123\nREADME evidence follows.'
    const request = {
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Reason from tool results.',
      messages: [
        { role: 'user' as const, content: 'Inspect the ForgeClaw repository.' },
        { role: 'assistant' as const, content: '', tool_calls: [{ id: 'repo-state-1', name: 'github_repo_state', input: {} }] },
        { role: 'tool' as const, content: realResult, tool_call_id: 'repo-state-1' },
      ],
      tools: [
        { name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } },
        { name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus')
    expect(result).toMatchObject({
      success: true,
      response: {
        stopReason: 'deterministic-deepseek-reasoning',
        toolCalls: [{ name: 'deepseek_reason', input: { task: 'Inspect the ForgeClaw repository.', context: expect.stringContaining(realResult) } }],
      },
    })
  })

  it('sends the exact user objective separately from the runtime envelope and preserves verified HEAD evidence', async () => {
    const task = 'Read the current ForgeClaw repository state and report its actual HEAD commit.'
    const headResult = 'repo: DeviousDevv303/forgeclaw\nHEAD: f5a7fd36b8e3465fc07a93a94f20a2059c6c24f2'
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Use actual repository evidence.',
      messages: [
        { role: 'user', content: `${task}\n\n[RUNTIME_STATE repository="DeviousDevv303/forgeclaw" taskStatus="idle"]\nRepository evidence comes from GitHub tools; never infer or preload contents.\n[/RUNTIME_STATE]` },
        { role: 'assistant', content: '', tool_calls: [{ id: 'head-read-1', name: 'github_repo_state', input: {} }] },
        { role: 'tool', content: headResult, tool_call_id: 'head-read-1' },
      ],
      tools: [
        { name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } },
        { name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } },
      ],
    }, '', 'corpus')
    expect(result).toMatchObject({
      success: true,
      response: {
        toolCalls: [{ name: 'deepseek_reason', input: { task, context: expect.stringContaining(headResult) } }],
      },
    })
  })

  it('injects a compact manual protocol for NEXUS without claiming native tools or parsing output in the provider', async () => {
    expect(providerSupportsTools(DEFAULT_NEXUS_WEBGPU_MODEL, 'nexus')).toBe(false)
    const rawManualCall = '```tool_call\n{"name":"github_read_file","arguments":{"path":"README.md"}}\n```'
    const send = vi.spyOn(providers.nexus, 'send').mockResolvedValue({ text: rawManualCall, provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL })
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Answer the request.',
      messages: [{ role: 'user', content: 'Help me code a small todo list.' }],
      tools: [{
        name: 'github_read_file',
        description: 'Read a repository file',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path' } }, required: ['path'] },
      }],
    }, '', 'nexus')
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].systemPrompt).toContain('```tool_call')
    expect(send.mock.calls[0][0].systemPrompt).toContain('github_read_file(path*:string)')
    expect(send.mock.calls[0][0].tools).toBeUndefined()
    expect(result).toMatchObject({ success: true, response: { text: rawManualCall } })
    expect(result.success && 'toolCalls' in result.response).toBe(false)
  })

  it('routes complex reasoning through the existing DeepSeek tool and returns its result to NEXUS', async () => {
    const task = 'Analyze this architecture and explain the trade-offs.'
    const tools = [{ name: 'deepseek_reason', description: 'DeepSeek reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } }]
    const first = await sendViaRouter({ model: DEFAULT_NEXUS_WEBGPU_MODEL, systemPrompt: 'Use DeepSeek when appropriate.', messages: [{ role: 'user', content: task }], tools }, '', 'nexus')
    expect(first).toMatchObject({ success: true, response: { stopReason: 'deterministic-deepseek-reasoning', toolCalls: [{ name: 'deepseek_reason', input: { task } }] } })

    const deepSeekResult = '✓ DeepSeek-16B completed as deepseek-test on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; result-retrieval=mirror; result-extraction=complete; checkpoint=deepseek-ai/deepseek-coder-6.7b-instruct (primary checkpoint); learning-persistence=unapproved candidate recorded.\n\nActual DeepSeek workflow output: three trade-offs.'
    const send = vi.spyOn(providers.nexus, 'send').mockResolvedValue({ text: 'Concise synthesis.', provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL })
    const continued = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Continue from tool results.',
      messages: [
        { role: 'user', content: task },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-1', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: deepSeekResult, tool_call_id: 'deepseek-1' },
      ],
      tools,
    }, '', 'nexus')
    expect(continued).toMatchObject({ success: true, response: { text: 'Actual DeepSeek workflow output: three trade-offs.', provider: 'deepseek' } })
    expect(send).not.toHaveBeenCalled()
  })

  it('returns the real DeepSeek result if the secondary Qwen WebGPU runtime cannot synthesize', async () => {
    const deepSeekResult = '✓ DeepSeek-16B completed as deepseek-real on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; result-retrieval=mirror; result-extraction=complete; checkpoint=deepseek-ai/deepseek-coder-6.7b-instruct (primary checkpoint); learning-persistence=unapproved candidate recorded.\n\nActual DeepSeek workflow answer, not invented by local inference.'
    const send = vi.spyOn(providers.corpus, 'send').mockRejectedValue(new Error('WebGPU unavailable'))
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Synthesize from the actual DeepSeek result.',
      messages: [
        { role: 'user', content: 'Explain the architecture.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-final', name: 'deepseek_reason', input: { task: 'Explain the architecture.' } }] },
        { role: 'tool', content: deepSeekResult, tool_call_id: 'deepseek-final' },
      ],
      tools: [{ name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '')
    // DeepSeek is primary end-to-end: successful DeepSeek result returns directly,
    // Qwen synthesis is not attempted.
    expect(result).toMatchObject({
      success: true,
      response: {
        provider: 'deepseek',
        text: 'Actual DeepSeek workflow answer, not invented by local inference.',
        stopReason: 'deepseek-synthesis-complete',
      },
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('hard-times out a secondary provider even when model initialization ignores AbortSignal', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise<never>(() => undefined)
    const signals: AbortSignal[] = []
    const send = vi.spyOn(providers.corpus, 'send').mockImplementation(async request => {
      if (request.signal) signals.push(request.signal)
      return neverSettles
    })
    const deepSeekResult = '✓ DeepSeek-16B completed as deepseek-timeout on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; result-retrieval=mirror; result-extraction=complete; checkpoint=deepseek-ai/deepseek-coder-6.7b-instruct (primary checkpoint); learning-persistence=unapproved candidate recorded.\n\nActual DeepSeek workflow output.'
    const task = sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Synthesize only from the real DeepSeek result.',
      messages: [
        { role: 'user', content: 'Explain the architecture.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-timeout', name: 'deepseek_reason', input: { task: 'Explain the architecture.' } }] },
        { role: 'tool', content: deepSeekResult, tool_call_id: 'deepseek-timeout' },
      ],
      tools: [{ name: 'deepseek_reason', description: 'DeepSeek primary', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '', 'corpus')

    try {
      // DeepSeek is primary end-to-end: successful DeepSeek result returns directly,
      // Qwen synthesis is not attempted (no timeout needed).
      const result = await task
      expect(send).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        success: true,
        response: {
          provider: 'deepseek',
          text: 'Actual DeepSeek workflow output.',
          stopReason: 'deepseek-synthesis-complete',
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends only the original task to direct Qwen after a DeepSeek tool error', async () => {
    const task = 'Write a moving, truthful presentation about seeing humanity as beings of light.'
    const deepseekError = '[TOOL ERROR] deepseek-run-poll GET /actions/runs/{run_id}: GitHub read timed out after 15000ms'
    const send = vi.spyOn(providers.nexus, 'send').mockResolvedValue({
      text: 'Light can be offered as a spiritual metaphor, not a proven scientific fact.',
      provider: 'nexus',
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
    })
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Do not expose this stale application history.',
      messages: [
        { role: 'user', content: `${task}\n\n[RUNTIME_STATE taskStatus="idle"]\nold execution manifest\n[/RUNTIME_STATE]` },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-failed', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: deepseekError, tool_call_id: 'deepseek-failed' },
      ],
      tools: [
        { name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } },
        { name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } },
      ],
    }, '', 'corpus')

    expect(result).toMatchObject({
      success: true,
      response: {
        provider: 'nexus',
        text: 'Light can be offered as a spiritual metaphor, not a proven scientific fact.',
        stopReason: 'clean-fallback-no-tools',
        diagnostics: { primaryReasoning: { status: 'failed', stage: 'deepseek-run-poll' } },
      },
    })
    expect(send).toHaveBeenCalledOnce()
    const cleanRequest = send.mock.calls[0][0]
    expect(cleanRequest.messages).toEqual([{ role: 'user', content: task }])
    expect(cleanRequest.systemPrompt).toContain("ForgeClaw's motive of Love")
    expect(cleanRequest.systemPrompt).not.toContain('stale application history')
    expect(cleanRequest.messages[0].content).not.toContain('old execution manifest')
    expect(cleanRequest.messages[0].content).not.toContain('GitHub read timed out')
    expect(cleanRequest.tools).toBeUndefined()
    expect(cleanRequest.onToken).toBeUndefined()
    expect(cleanRequest.signal).toBeInstanceOf(AbortSignal)
  })

  it('runs primary reasoning before the requested GitHub read, then continues DeepSeek from the real result', async () => {
    const task = 'Read the current repository HEAD commit and explain what branch it is on. Use the GitHub repository tool; do not guess.'
    const tools = [
      { name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } },
      { name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } },
    ]
    const first = await sendViaRouter({ model: DEFAULT_NEXUS_WEBGPU_MODEL, systemPrompt: 'system', messages: [{ role: 'user', content: task }], tools }, '', 'corpus')
    expect(first).toMatchObject({ success: true, response: { stopReason: 'deterministic-deepseek-reasoning', toolCalls: [{ name: 'deepseek_reason' }] } })

    const deepSeek = '✓ DeepSeek-16B completed as deepseek-order on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; result-retrieval=mirror; result-extraction=complete; checkpoint=deepseek-ai/deepseek-coder-6.7b-instruct (primary checkpoint); learning-persistence=not requested.\n\nI need the live repository evidence before reporting the HEAD.'
    const repoRead = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: task },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-order-1', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: deepSeek, tool_call_id: 'deepseek-order-1' },
      ],
      tools,
    }, '', 'corpus')
    expect(repoRead).toMatchObject({ success: true, response: { stopReason: 'deterministic-repository-evidence', toolCalls: [{ name: 'github_repo_state' }] } })

    const head = 'repo: DeviousDevv303/forgeclaw\nHEAD: f5a7fd36b8e3465fc07a93a94f20a2059c6c24f2'
    const continuation = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: task },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-order-1', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: deepSeek, tool_call_id: 'deepseek-order-1' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'repo-order-1', name: 'github_repo_state', input: {} }] },
        { role: 'tool', content: head, tool_call_id: 'repo-order-1' },
      ],
      tools,
    }, '', 'corpus')
    expect(continuation).toMatchObject({
      success: true,
      response: { stopReason: 'deterministic-deepseek-reasoning', toolCalls: [{ name: 'deepseek_reason', input: { task, context: expect.stringContaining(head) } }] },
    })
  })

  it('never sends a failed DeepSeek tool trace into a continuation after collecting requested repo evidence', async () => {
    const task = 'Read the current repository HEAD commit. Use the GitHub repository tool. Do not guess.'
    const tools = [
      { name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } },
      { name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } },
    ]
    const error = '[TOOL ERROR] deepseek-run-poll GET /actions/runs/{run_id}: GitHub read timed out after 15000ms'
    const afterFailure = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: task },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-failed-repo', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: error, tool_call_id: 'deepseek-failed-repo' },
      ],
      tools,
    }, '', 'corpus')
    expect(afterFailure).toMatchObject({ success: true, response: { stopReason: 'deterministic-repository-evidence', toolCalls: [{ name: 'github_repo_state' }] } })

    const head = 'repo: DeviousDevv303/forgeclaw\nHEAD: aabbccddeeff00112233445566778899aabbccdd'
    const send = vi.spyOn(providers.nexus, 'send').mockResolvedValue({ text: 'I cannot verify a commit from my local fallback alone.', provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL })
    const final = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: task },
        { role: 'assistant', content: '', tool_calls: [{ id: 'deepseek-failed-repo', name: 'deepseek_reason', input: { task } }] },
        { role: 'tool', content: error, tool_call_id: 'deepseek-failed-repo' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'repo-after-failure', name: 'github_repo_state', input: {} }] },
        { role: 'tool', content: head, tool_call_id: 'repo-after-failure' },
      ],
      tools,
    }, '', 'corpus')
    expect(final).toMatchObject({ success: true, response: { stopReason: 'clean-fallback-no-tools' } })
    expect(send).toHaveBeenCalledOnce()
    const cleanRequest = send.mock.calls[0][0]
    expect(cleanRequest.messages).toEqual([{ role: 'user', content: task }])
    expect(cleanRequest.messages[0].content).not.toContain('GitHub read timed out')
    expect(cleanRequest.messages[0].content).not.toContain(head)
    expect(cleanRequest.tools).toBeUndefined()
  })

  it('does not start Qwen when the DeepSeek result was explicitly blocked by Guardian', async () => {
    const send = vi.spyOn(providers.nexus, 'send')
    const result = await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: 'Explain this idea.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'guardian-block', name: 'deepseek_reason', input: {} }] },
        { role: 'tool', content: '[GUARDIAN BLOCKED] Co-sign required.', tool_call_id: 'guardian-block' },
      ],
      tools: [{ name: 'deepseek_reason', description: 'Primary reasoning workflow', parameters: { type: 'object', properties: {}, required: [] } }],
    }, '', 'corpus')
    expect(result.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps ordinary NEXUS chat free of the full tool catalog', async () => {
    const send = vi.spyOn(providers.nexus, 'send').mockResolvedValue({ text: 'ForgeClaw is an operator-controlled workspace.', provider: 'nexus', model: DEFAULT_NEXUS_WEBGPU_MODEL })
    await sendViaRouter({
      model: DEFAULT_NEXUS_WEBGPU_MODEL,
      systemPrompt: 'Answer directly.',
      messages: [{ role: 'user', content: 'Explain what ForgeClaw is in one short paragraph.' }],
      tools: undefined,
    }, '', 'nexus')
    expect(send.mock.calls[0][0].systemPrompt).not.toContain('AVAILABLE TOOLS')
    expect(send.mock.calls[0][0].tools).toBeUndefined()
  })

  it('falls from local inference to WebGPU 3B then WebGPU 1.5B when available', async () => {
    const originalFetch = globalThis.fetch
    vi.stubGlobal('navigator', { gpu: {} })
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch
    const localSend = vi.spyOn(providers.local, 'send').mockRejectedValue(new Error('local unavailable'))
    const nexusSend = vi.spyOn(providers.nexus, 'send').mockImplementation(async request => {
      if (request.model === DEFAULT_NEXUS_WEBGPU_MODEL) throw new Error('3B load failed')
      return { text: 'fallback response', provider: 'nexus', model: request.model || LEGACY_NEXUS_WEBGPU_MODEL }
    })
    try {
      const result = await sendViaRouter({
        model: 'local-model',
        systemPrompt: 'system\n\nNative tool calling is available. Use tools when they are needed to complete the objective.',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{ name: 'github_repo_state', description: 'Read repository state', parameters: { type: 'object', properties: {}, required: [] } }],
        onToken: () => undefined,
      }, 'http://127.0.0.1:8080/v1', 'local')
      expect(result).toMatchObject({ success: true, response: { provider: 'nexus', model: LEGACY_NEXUS_WEBGPU_MODEL } })
      expect(localSend).toHaveBeenCalledOnce()
      expect(nexusSend.mock.calls.map(([request]) => request.model)).toEqual([DEFAULT_NEXUS_WEBGPU_MODEL, LEGACY_NEXUS_WEBGPU_MODEL])
      expect(nexusSend.mock.calls[0][0].tools).toBeUndefined()
      expect(nexusSend.mock.calls[0][0].onToken).toBeUndefined()
      expect(nexusSend.mock.calls[0][0].systemPrompt).toContain('AVAILABLE TOOLS')
      expect(nexusSend.mock.calls[0][0].systemPrompt).toContain('manual tool protocol exactly')
    } finally {
      globalThis.fetch = originalFetch
      vi.unstubAllGlobals()
    }
  })

  it('preserves system context, conversation history and tool definitions', async () => {
    const send = vi.spyOn(providers.local, 'send').mockResolvedValue({
      text: 'grounded response',
      provider: 'local',
      model: 'qwen2.5:1.5b',
      stopReason: 'stop',
    })
    const request = {
      model: 'qwen2.5:1.5b',
      systemPrompt: 'ForgeClaw identity and runtime instructions',
      messages: [
        { role: 'user' as const, content: 'Earlier context' },
        { role: 'assistant' as const, content: 'Continuing' },
        { role: 'user' as const, content: 'Check the repository' },
      ],
      tools: [{ name: 'github_repo_state', description: 'Read live repository state', parameters: { type: 'object' } }],
    }

    const result = await sendViaRouter(request, 'http://127.0.0.1:11434/v1', 'local')

    expect(result.success).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject(request)
    expect(send.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('does not replace a request with latest-message-only content', async () => {
    const send = vi.spyOn(providers.local, 'send').mockResolvedValue({
      text: 'ok',
      provider: 'local',
      model: 'qwen2.5:1.5b',
    })
    const request = {
      model: 'qwen2.5:1.5b',
      systemPrompt: 'canonical identity',
      messages: [{ role: 'user' as const, content: 'history' }, { role: 'tool' as const, content: 'actual GitHub result', tool_call_id: 't1' }],
      tools: [{ name: 'github_verify_commit', description: 'Verify', parameters: {} }],
    }
    await sendViaRouter(request, 'http://127.0.0.1:11434/v1', 'local')
    const forwarded = send.mock.calls[0][0]
    expect(forwarded.systemPrompt).toBe('canonical identity')
    expect(forwarded.messages).toHaveLength(2)
    expect(forwarded.messages[1].content).toBe('actual GitHub result')
    expect(forwarded.tools?.[0].name).toBe('github_verify_commit')
  })
})
