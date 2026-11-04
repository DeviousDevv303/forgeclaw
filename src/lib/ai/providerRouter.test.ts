import { describe, expect, it, vi } from 'vitest'
import { detectBestProvider, getBestProvider, providers, sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'
import { buildRuntimeRequestContext } from '../codingAgentRuntime'

describe('provider router', () => {
  it('uses Qwen/Qwen3-8B (provider id qwen) as the default without probing localhost', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getBestProvider('')).resolves.toEqual({ providerId: 'qwen', model: 'qwen3-8b', level: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not promote local inference to a hidden fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(detectBestProvider('')).resolves.toMatchObject({ providerId: 'local', level: 2 })
  })

  it('carries the selected UI language into the Qwen task, which never sees the system prompt', async () => {
    const base: AIRequest = { model: 'qwen3-8b', systemPrompt: 'Respond in Spanish', messages: [{ role: 'user', content: 'Explain the architecture of the repository.' }], tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }] }
    const taskFor = async (responseLanguage?: string) => {
      const result = await sendViaRouter({ ...base, responseLanguage }, '', 'corpus')
      if (!result.success) throw new Error('router failed')
      return String(result.response.toolCalls?.[0]?.input.task)
    }
    expect(await taskFor('es')).toMatch(/\n\nReply language: Respond in Spanish \(Latin American/)
    expect(await taskFor('zh')).toMatch(/Reply language: Respond in Chinese/)
    // English adds no language line; every task carries today's date (currentInfo.ts).
    for (const lang of ['en', undefined]) {
      const task = await taskFor(lang)
      expect(task).toMatch(/^Explain the architecture of the repository\.\n\nToday's date is /)
      expect(task).not.toContain('Reply language')
    }
  })

  it('bootstraps the Qwen workflow before prose for a complex request', async () => {
    const request: AIRequest = { model: 'qwen3-8b', systemPrompt: '', messages: [{ role: 'user', content: 'Investigate the repository and explain the architecture.' }], tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }] }
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result).toMatchObject({ success: true, response: { provider: 'corpus', stopReason: 'deterministic-qwen-reasoning' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('qwen_reason')
  })

  it('establishes live repository evidence before Qwen when both tools are available', async () => {
    const request: AIRequest = {
      model: 'qwen3-8b', systemPrompt: '',
      messages: [{ role: 'user', content: 'Check the repository HEAD and explain the current build.' }],
      tools: [
        { name: 'github_repo_state', description: 'read repository state', parameters: {} },
        { name: 'qwen_reason', description: 'reason', parameters: {} },
      ],
    }
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result).toMatchObject({ success: true, response: { provider: 'corpus', stopReason: 'deterministic-repository-evidence' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('github_repo_state')
  })

  it('returns a terminal error instead of invoking a secondary model after a workflow failure', async () => {
    const request: AIRequest = {
      model: 'qwen3-8b', systemPrompt: '',
      messages: [
        { role: 'user', content: 'Investigate this failure.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'qwen_reason', input: { task: 'Investigate this failure.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '[TOOL ERROR] qwen-run-poll: GitHub read timed out' },
      ],
      tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }],
    }
    const secondary = vi.spyOn(providers.nexus, 'send')
    const result = await sendViaRouter(request, '', 'corpus')
    expect(result.success).toBe(false)
    expect(secondary).not.toHaveBeenCalled()
  })

  it('returns the verified Qwen answer and checkpoint metadata', async () => {
    const request: AIRequest = {
      model: 'qwen3-8b', systemPrompt: '',
      messages: [
        { role: 'user', content: 'Answer from the workflow.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'qwen_reason', input: { task: 'Answer from the workflow.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '✓ Qwen/Qwen3-8B completed as run-1; checkpoint=qwen3-8b\n\nVerified answer.' },
      ],
      tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }],
    }
    const result = await sendViaRouter(request, '', 'corpus')
    // D-016: the synthesis return attributes the SELECTED provider id ('corpus' here), not a hardcoded 'qwen'.
    expect(result).toMatchObject({ success: true, response: { provider: 'corpus', text: 'Verified answer.', model: 'Qwen/Qwen3-8B Actions (qwen3-8b)' } })
  })

  it('attributes every path of one selected provider with the same provider id (D-016)', async () => {
    const tools = [{ name: 'qwen_reason', description: 'reason', parameters: {} }]
    const greeting = await sendViaRouter({ model: 'qwen3-8b', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }], tools }, '', 'corpus')
    const synthesis = await sendViaRouter({
      model: 'qwen3-8b', systemPrompt: '', tools,
      messages: [
        { role: 'user', content: 'Answer from the workflow.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'qwen_reason', input: { task: 'Answer from the workflow.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '✓ Qwen/Qwen3-8B completed as run-1; checkpoint=qwen3-8b\n\nVerified answer.' },
      ],
    }, '', 'corpus')
    if (!greeting.success || !synthesis.success) throw new Error('router failed')
    expect(greeting.response.provider).toBe('corpus')
    expect(synthesis.response.provider).toBe(greeting.response.provider)
    // And a 'qwen'-selected session keeps 'qwen' on the synthesis path too.
    const qwenSynthesis = await sendViaRouter({
      model: 'qwen3-8b', systemPrompt: '', tools,
      messages: [
        { role: 'user', content: 'Answer from the workflow.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'qwen_reason', input: { task: 'Answer from the workflow.' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '✓ Qwen/Qwen3-8B completed as run-1; checkpoint=qwen3-8b\n\nVerified answer.' },
      ],
    }, '', 'qwen')
    if (!qwenSynthesis.success) throw new Error('router failed')
    expect(qwenSynthesis.response.provider).toBe('qwen')
  })

  it('says Qwen was not dispatched, not that GitHub is unreachable, when the request carries no qwen_reason tool', async () => {
    const request: AIRequest = {
      model: 'qwen3-8b', systemPrompt: '',
      messages: [{ role: 'user', content: 'What causes rainbows to form after rain?' }],
    }
    const result = await sendViaRouter(request, '', 'qwen')
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.message).toMatch(/^qwen-not-dispatched:/)
    expect(result.error.message).not.toMatch(/unreachable|temporarily unavailable/i)
  })

  // App.tsx appends this envelope to every user message before routing (effectivePrompt).
  const asSentByApp = (text: string) => `${text}\n\n${buildRuntimeRequestContext({ owner: 'DeviousDevv303', repo: 'forgeclaw', taskStatus: 'idle' })}`

  it('sends a greeting to the model too, with the app runtime envelope attached', async () => {
    for (const text of ['hi', 'hola', 'gracias']) {
      const result = await sendViaRouter({
        model: 'qwen3-8b', systemPrompt: '',
        messages: [{ role: 'user', content: asSentByApp(text) }],
        tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }],
      }, '', 'qwen')
      expect(result, text).toMatchObject({ success: true, response: { stopReason: 'deterministic-qwen-reasoning' } })
      if (result.success) expect(result.response.toolCalls?.[0]?.input, text).toMatchObject({ task: expect.stringContaining(text) })
    }
  })

  it('still dispatches Qwen for a real question carrying the same envelope', async () => {
    const result = await sendViaRouter({
      model: 'qwen3-8b', systemPrompt: '',
      messages: [{ role: 'user', content: asSentByApp('What causes rainbows to form after rain?') }],
      tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }],
    }, '', 'qwen')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-qwen-reasoning' } })
  })
})
