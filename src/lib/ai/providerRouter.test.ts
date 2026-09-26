// @vitest-environment node
// MANUS acceptance coverage: the router must transport the runtime request as-is.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { providers, sendViaRouter } from './providerRouter'

afterEach(() => vi.restoreAllMocks())

describe('provider router runtime passthrough', () => {
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
    expect(send.mock.calls[0][0]).toEqual(request)
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
