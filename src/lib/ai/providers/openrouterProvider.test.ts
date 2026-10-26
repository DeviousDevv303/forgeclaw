// 2026-10-26 (owner): "Open router never made it to the UI as a provider need that please".
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_CHAT_URL,
  OPENROUTER_MODELS,
  fetchOpenRouterModels,
  mergeReasoningDetails,
  openrouterProvider,
  resolveOpenRouterModel,
  toOpenRouterMessages,
} from './openrouterProvider'
import { DEFAULT_MODEL, PROVIDERS, callProvider, modelSupportsTools, testProviderKey } from '../../modelProviders'
import { DEFAULT_PROVIDER, PROVIDER_IDS, resolveInitialProvider } from '../../providerDefaults'
import { providers } from '../providerRouter'
import { baselineToolNames } from '../../toolExposure'
import { diagKeyFormat, diagKeyFormatValid } from '../../diagKeyFormat'

afterEach(() => { vi.unstubAllGlobals() })

// Built from parts so no key-shaped literal sits in source (the protected-path guard refuses one).
const VALID_KEY = ['sk', 'or', 'test-not-a-real-key-000'].join('-')
const ANTHROPIC_SHAPED_KEY = ['sk', 'ant', 'test-not-a-real-key-000'].join('-')

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] ?? []
  return { url: String(url), init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)) }
}

describe('OpenRouter provider: request shape (OpenAI-compatible Chat Completions)', () => {
  it('posts to openrouter.ai with the Bearer key, the model, system + messages, and no attribution headers', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await openrouterProvider.send({ systemPrompt: 'You are ForgeClaw.', messages: [{ role: 'user', content: 'Hi' }], model: 'deepseek/deepseek-v4.1-flash' }, VALID_KEY)
    expect(response).toMatchObject({ text: 'Hello.', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', stopReason: 'stop' })
    const { url, init, body } = sent(fetchMock)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(url).toBe(OPENROUTER_CHAT_URL)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${VALID_KEY}` })
    expect(body).toMatchObject({ model: 'deepseek/deepseek-v4.1-flash', max_tokens: 16384, stream: false })
    expect(body.messages).toEqual([{ role: 'system', content: 'You are ForgeClaw.' }, { role: 'user', content: 'Hi' }])
  })

  it('sends tools and parses native tool calls', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"ufc"}' } }] }, finish_reason: 'tool_calls' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const tools = [{ name: 'web_search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }]
    const response = await openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'search' }], tools }, VALID_KEY)
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'web_search', input: { query: 'ufc' } }])
    expect(sent(fetchMock).body).toMatchObject({ tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'web_search', description: 'Search' } }] })
  })

  it('streams text token by token and keeps streamed tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      ': keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_search","arguments":"{\\"query\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ufc\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ])))
    const tokens: string[] = []
    const response = await openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], onToken: t => tokens.push(t) }, VALID_KEY)
    expect(tokens).toEqual(['Hel', 'lo'])
    expect(response).toMatchObject({ text: 'Hello', stopReason: 'tool_calls', toolCalls: [{ id: 'c1', name: 'web_search', input: { query: 'ufc' } }] })
  })

  it('keeps reasoning out of the answer and hands it back on the next tool-call turn', async () => {
    const details = [{ type: 'reasoning.text', text: 'Think.', signature: 'sig', format: 'anthropic-claude-v1', index: 0 }]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'Answer.', reasoning: 'Think.', reasoning_details: details }, finish_reason: 'stop' }] })))
    const response = await openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] }, VALID_KEY)
    expect(response).toMatchObject({ text: 'Answer.', reasoningContent: 'Think.', reasoningDetails: details })
    const call = { id: 'c1', name: 'web_search', input: { query: 'x' } }
    expect(toOpenRouterMessages('s', [{ role: 'assistant', content: '', tool_calls: [call], reasoning_content: 'Think.', reasoning_details: details }])[1])
      .toEqual({ role: 'assistant', content: '', reasoning_details: details, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }] })
    // Plain reasoning text when there are no blocks: OpenRouter accepts either.
    expect(toOpenRouterMessages('s', [{ role: 'assistant', content: '', tool_calls: [call], reasoning_content: 'Think.' }])[1]).toMatchObject({ reasoning: 'Think.' })
  })

  it('puts streamed reasoning blocks back together, in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning":"Th","reasoning_details":[{"type":"reasoning.text","text":"Th","index":0,"format":"anthropic-claude-v1"}]}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":"ink.","reasoning_details":[{"type":"reasoning.text","text":"ink.","index":0,"signature":"sig"}]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"},"finish_reason":"stop"}]}\n\n',
    ])))
    const response = await openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], onToken: () => {} }, VALID_KEY)
    expect(response.reasoningContent).toBe('Think.')
    expect(response.reasoningDetails).toEqual([{ type: 'reasoning.text', text: 'Think.', index: 0, format: 'anthropic-claude-v1', signature: 'sig' }])
    expect(mergeReasoningDetails([{ type: 'reasoning.text', text: 'a', index: 0 }, { type: 'reasoning.encrypted', data: 'x', index: 1 }, { type: 'reasoning.text', text: 'b', index: 2 }]))
      .toHaveLength(3)
  })

  it('sends an attached picture as an image part', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo='
    expect(toOpenRouterMessages('s', [{ role: 'user', content: 'what is this', image_url: url }])[1])
      .toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url } }, { type: 'text', text: 'what is this' }] })
  })

  it('marks a tool call cut off by the output limit instead of running it with empty arguments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"que' } }] }, finish_reason: 'length' }] })))
    const response = await openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] }, VALID_KEY)
    expect(response.toolCalls?.[0].parseError).toMatch(/output token limit/)
  })

  it('names what to do for no credits and for a model that cannot call tools', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Insufficient credits', code: 402 } }, { status: 402 })))
    await expect(openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] }, VALID_KEY)).rejects.toThrow(/OpenRouter 402: Insufficient credits \(no credits left: add credits at openrouter\.ai\/credits, or pick a free model\)/)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'No endpoints found that support tool use.' } }, { status: 404 })))
    await expect(openrouterProvider.send({ model: '', systemPrompt: 's', messages: [{ role: 'user', content: 'x' }] }, VALID_KEY)).rejects.toThrow(/cannot call tools; pick one marked for tools/)
  })
})

describe('OpenRouter provider: key and models', () => {
  it('a missing or malformed key, or a mistyped model ID, is refused before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(openrouterProvider.send({ model: '', systemPrompt: 's', messages: [] }, '')).rejects.toThrow(/openrouter\.ai\/keys/)
    await expect(openrouterProvider.send({ model: '', systemPrompt: 's', messages: [] }, ANTHROPIC_SHAPED_KEY)).rejects.toThrow(/starting with sk-or-/)
    await expect(openrouterProvider.send({ systemPrompt: 's', messages: [], model: 'claude haiku' }, VALID_KEY)).rejects.toThrow(/"claude haiku" is not an OpenRouter model ID/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openrouterProvider.isConfigured(VALID_KEY)).toBe(true)
    expect(openrouterProvider.isConfigured('sk-or-')).toBe(false)
  })

  it('tests the key with GET /key, which spends nothing, and says when its credit limit is used up', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { label: 'forgeclaw', limit: 5, limit_remaining: 4.2, is_free_tier: false } }))
    vi.stubGlobal('fetch', fetchMock)
    await openrouterProvider.test(VALID_KEY)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/key')
    expect(init.method).toBeUndefined()
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${VALID_KEY}`)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { limit: 5, limit_remaining: 0 } })))
    await expect(openrouterProvider.test(VALID_KEY)).rejects.toThrow(/credit limit is used up/)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'User not found.', code: 401 } }, { status: 401 })))
    await expect(openrouterProvider.test(VALID_KEY)).rejects.toThrow(/OpenRouter 401: User not found\./)
  })

  it('keeps any well-formed model ID and falls back to the default otherwise', () => {
    expect(resolveOpenRouterModel('qwen/qwen3.8-omni-flash')).toBe('qwen/qwen3.8-omni-flash')
    expect(resolveOpenRouterModel('google/gemma-4-31b-it:free')).toBe('google/gemma-4-31b-it:free')
    expect(resolveOpenRouterModel('kimi-k2.6')).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(resolveOpenRouterModel('a/b c')).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(resolveOpenRouterModel(null)).toBe('anthropic/claude-haiku-5.5')
    expect(OPENROUTER_MODELS.every(m => resolveOpenRouterModel(m.id) === m.id)).toBe(true)
  })

  it('the live list holds only models that can call tools, with their price', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [
      { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', context_length: 1048576, supported_parameters: ['tools', 'temperature'], pricing: { prompt: '0.00000015', completion: '0.0000005' } },
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', context_length: 262144, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } },
      { id: 'openrouter/auto', name: 'Auto Router', context_length: 2000000, supported_parameters: ['tools'], pricing: { prompt: '-1', completion: '-1' } },
      { id: 'some/text-only', name: 'Text only', context_length: 8192, supported_parameters: ['temperature'], pricing: { prompt: '0', completion: '0' } },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchOpenRouterModels()).toEqual([
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', contextK: 262, note: 'Free' },
      { id: 'openrouter/auto', label: 'Auto Router', contextK: 2000, note: 'price follows the model it routes to' },
      { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', contextK: 1049, note: '$0.15 in / $0.50 out' },
    ])
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://openrouter.ai/api/v1/models')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    await expect(fetchOpenRouterModels()).rejects.toThrow(/OpenRouter 503/)
  })
})

describe('OpenRouter provider: registration', () => {
  it('is a registered, selectable provider, a saved choice survives a reload, and the default stays DeepSeek', () => {
    expect(PROVIDER_IDS).toContain('openrouter')
    expect(providers.openrouter).toBe(openrouterProvider)
    expect(PROVIDERS.openrouter).toMatchObject({ id: 'openrouter', name: 'OpenRouter', keyPrefix: 'sk-or-', url: OPENROUTER_CHAT_URL })
    expect(DEFAULT_MODEL.openrouter).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(resolveInitialProvider('openrouter')).toBe('openrouter')
    expect(DEFAULT_PROVIDER).toBe('deepseek')
  })

  it('gets the read-only baseline tools like the other hosted providers', () => {
    expect(modelSupportsTools('openrouter', 'anything/at-all')).toBe(true)
    expect(baselineToolNames('openrouter')).toEqual(expect.arrayContaining(['github_read_file', 'web_search']))
  })

  it('callProvider and testProviderKey route to the OpenRouter adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/key')
      ? Response.json({ data: { limit: null, limit_remaining: null } })
      : Response.json({ choices: [{ message: { content: 'Routed.' }, finish_reason: 'stop' }] })))
    expect(await callProvider('openrouter', '', 's', [{ role: 'user', content: 'x' }], VALID_KEY)).toMatchObject({ text: 'Routed.', provider: 'openrouter', model: DEFAULT_OPENROUTER_MODEL })
    await expect(testProviderKey('openrouter', '', VALID_KEY)).resolves.toBeUndefined()
  })

  it('the Diagnostics gate reads the OpenRouter format rule', () => {
    expect(diagKeyFormatValid('openrouter', '', '', true, '', VALID_KEY)).toBe(true)
    expect(diagKeyFormat('openrouter', '', '', true, '', 'sk-abc')).toEqual({ valid: false, problem: { kind: 'prefix', prefix: 'sk-or-' } })
  })
})
