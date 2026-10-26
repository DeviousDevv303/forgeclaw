import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPENROUTER_MODEL, openrouterProvider, resolveOpenRouterModel, toOpenRouterMessages } from './openrouterProvider'
import { diagKeyFormat } from '../../diagKeyFormat'
import { providers, isDeepSeekProvider } from '../providerRouter'
import { HOSTED_TOOL_PROVIDERS } from '../../toolExposure'

const KEY = 'sk-or-v1-12345678901234567890'

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouter provider', () => {
  it('is registered as a hosted tool provider', () => {
    expect(providers.openrouter).toBe(openrouterProvider)
    expect(isDeepSeekProvider('openrouter')).toBe(false)
    expect(HOSTED_TOOL_PROVIDERS.has('openrouter')).toBe(true)
  })

  it('posts the chosen vendor/model to openrouter.ai with the bearer key', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input; void _init
      return Response.json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const response = await openrouterProvider.send({ systemPrompt: 's', messages: [{ role: 'user', content: 'hello' }], model: 'vendor/some-model' }, ` ${KEY} `)
    expect(response.text).toBe('hi')
    expect(response.provider).toBe('openrouter')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    const init = fetchMock.mock.calls[0]?.[1]
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init?.body as string).model).toBe('vendor/some-model')
  })

  it('flags tool arguments cut off by the token limit instead of running them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 't', arguments: '{"a' } }] }, finish_reason: 'length' }] })))
    const r = await openrouterProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: DEFAULT_OPENROUTER_MODEL }, KEY)
    expect(r.toolCalls?.[0]?.parseError).toMatch(/token limit/)
  })

  it('does not echo reasoning_content back to an arbitrary upstream model', () => {
    const m = toOpenRouterMessages('sys', [{ role: 'user', content: 'go' }, { role: 'assistant', content: '', reasoning_content: 'think', tool_calls: [{ id: 'c1', name: 't', input: {} }] }])
    expect(m[2]).not.toHaveProperty('reasoning_content')
  })

  it('surfaces API errors with the OpenRouter name and status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'No auth credentials found' } }), { status: 401 })))
    await expect(openrouterProvider.send({ systemPrompt: '', messages: [{ role: 'user', content: 'x' }], model: DEFAULT_OPENROUTER_MODEL }, KEY)).rejects.toThrow('OpenRouter 401: No auth credentials found')
  })

  it('rejects a malformed key before any request; keeps only vendor/model IDs', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await expect(openrouterProvider.test('sk-not-openrouter-123456789')).rejects.toThrow(/Invalid OpenRouter key/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveOpenRouterModel('deepseek/deepseek-chat')).toBe('deepseek/deepseek-chat')
    expect(resolveOpenRouterModel('gpt')).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(resolveOpenRouterModel(null)).toBe(DEFAULT_OPENROUTER_MODEL)
  })

  it('Diagnostics reads the same key rule', () => {
    expect(diagKeyFormat('openrouter', '', '', true, '', '', 'abc').valid).toBe(false)
    expect(diagKeyFormat('openrouter', '', '', true, '', '', KEY)).toEqual({ valid: true, problem: null })
  })
})
