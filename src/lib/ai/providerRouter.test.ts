import { describe, expect, it, vi } from 'vitest'
import { detectBestProvider, getBestProvider, providers, sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

describe('DeepSeek-only provider router', () => {
  it('uses DeepSeek 16B as the canonical corpus model without probing localhost', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getBestProvider('')).resolves.toEqual({ providerId: 'corpus', model: 'deepseek-16b', level: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not promote local inference to a hidden fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(detectBestProvider('')).resolves.toMatchObject({ providerId: 'local', level: 2 })
  })

  it('bootstraps the DeepSeek workflow before prose for a complex request', async () => {
    const request: AIRequest = { model: 'deepseek-16b', systemPrompt: '', messages: [{ role: 'user', content: 'Investigate the repository and explain the architecture.' }], tools: [{ name: 'deepseek_reason', description: 'reason', parameters: {} }] }
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result).toMatchObject({ success: true, response: { provider: 'corpus', stopReason: 'deterministic-deepseek-reasoning' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('deepseek_reason')
  })

  it('establishes live repository evidence before DeepSeek when both tools are available', async () => {
    const request: AIRequest = {
      model: 'deepseek-16b', systemPrompt: '',
      messages: [{ role: 'user', content: 'Check the repository HEAD and explain the current build.' }],
      tools: [
        { name: 'github_repo_state', description: 'read repository state', parameters: {} },
        { name: 'deepseek_reason', description: 'reason', parameters: {} },
      ],
    }
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result).toMatchObject({ success: true, response: { provider: 'corpus', stopReason: 'deterministic-repository-evidence' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('github_repo_state')
  })

  it('returns a terminal error instead of invoking a secondary model after a workflow failure', async () => {
    const request: AIRequest = {
      model: 'deepseek-16b', systemPrompt: '',
      messages: [
        { role: 'user', content: 'Investigate this failure.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'deepseek_reason', input: { task: 'Investigate this failure.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '[TOOL ERROR] deepseek-run-poll: GitHub read timed out' },
      ],
      tools: [{ name: 'deepseek_reason', description: 'reason', parameters: {} }],
    }
    const secondary = vi.spyOn(providers.nexus, 'send')
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result.success).toBe(false)
    expect(secondary).not.toHaveBeenCalled()
  })

  it('returns the verified DeepSeek answer and checkpoint metadata', async () => {
    const request: AIRequest = {
      model: 'deepseek-16b', systemPrompt: '',
      messages: [
        { role: 'user', content: 'Answer from the workflow.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'deepseek_reason', input: { task: 'Answer from the workflow.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '✓ DeepSeek-16B completed as run-1; checkpoint=deepseek-16b\n\nVerified answer.' },
      ],
      tools: [{ name: 'deepseek_reason', description: 'reason', parameters: {} }],
    }
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result).toMatchObject({ success: true, response: { provider: 'deepseek', text: 'Verified answer.', model: 'DeepSeek 16B Actions (deepseek-16b)' } })
  })
})
