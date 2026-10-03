// @vitest-environment node
// MANUS acceptance coverage: the router must transport the runtime request as-is.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectBestProvider, getBestProvider, providers, sendViaRouter } from './providerRouter'
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
