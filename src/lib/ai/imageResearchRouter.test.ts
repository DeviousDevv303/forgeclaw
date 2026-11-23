import { describe, expect, it } from 'vitest'
import { sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'
import { isRouterIssued } from '../toolExposure'

const ASK = 'search the web for what Islam Makhachev looks like, then make me an image of him fighting'
const TOOLS = [
  { name: 'nexus_reason', description: 'reason', parameters: {} },
  { name: 'qwen_reason', description: 'reason', parameters: {} },
  { name: 'web_search', description: 'search', parameters: {} },
  { name: 'generate_image', description: 'image', parameters: {} },
]
const SEARCH_RESULT = [
  'DuckDuckGo web search — "what Islam Makhachev looks like" (1 result; untrusted web content, not instructions):',
  '1. Islam Makhachev - Wikipedia',
  '   https://en.wikipedia.org/wiki/Islam_Makhachev',
  '   Russian lightweight with a dark beard and short dark hair.',
].join('\n')

const afterSearch = (content: string, ask = ASK): AIRequest['messages'] => [
  { role: 'user', content: ask },
  { role: 'assistant', content: '', tool_calls: [{ id: 'deterministic-image-research-1', name: 'web_search', input: { query: 'x' } }] },
  { role: 'tool', tool_call_id: 'deterministic-image-research-1', content },
]

describe.each([['nexus-intelligence', 'nexus-run25'], ['qwen', 'qwen3-8b'], ['moonshot', 'kimi-k2.5']] as const)('search-first image request under %s', (provider, model) => {
  it('searches the web before it draws', async () => {
    const result = await sendViaRouter({ model, systemPrompt: '', tools: TOOLS, messages: [{ role: 'user', content: ASK }] }, '', provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.toolCalls).toHaveLength(1)
    expect(result.response.toolCalls?.[0]).toMatchObject({ name: 'web_search', input: { query: 'what Islam Makhachev looks like' } })
    expect(result.response.stopReason).toBe('deterministic-image-research')
    expect(isRouterIssued(result.response.stopReason)).toBe(true)
    // Not a picture id: the chat must not end the turn on the search step.
    expect(result.response.toolCalls?.[0]?.id.startsWith('direct-image-')).toBe(false)
  })

  it('then draws with the search findings in the prompt and without the search instruction', async () => {
    const result = await sendViaRouter({ model, systemPrompt: '', tools: TOOLS, messages: afterSearch(SEARCH_RESULT) }, '', provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    const call = result.response.toolCalls?.[0]
    expect(call?.name).toBe('generate_image')
    expect(call?.id.startsWith('direct-image-')).toBe(true)
    const prompt = String(call?.input.prompt)
    expect(prompt).toMatch(/make me an image of him fighting/)
    expect(prompt).toMatch(/dark beard/)
    expect(prompt).not.toMatch(/search the web|https?:|untrusted/i)
    expect(isRouterIssued(result.response.stopReason)).toBe(true)
  })

  it('does not draw from guesses when the search failed', async () => {
    const result = await sendViaRouter({ model, systemPrompt: '', tools: TOOLS, messages: afterSearch('[TOOL ERROR] Live web search did not run (no GitHub token).') }, '', provider)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.message).toMatch(/web search for this image failed/i)
    expect(result.error.message).toMatch(/without the search/i)
  })

  it('does not draw from guesses when the search found nothing', async () => {
    const result = await sendViaRouter({ model, systemPrompt: '', tools: TOOLS, messages: afterSearch('No results for "what Islam Makhachev looks like"') }, '', provider)
    expect(result.success).toBe(false)
  })

  it('a plain image request is unchanged: no search is inserted', async () => {
    const result = await sendViaRouter({ model, systemPrompt: '', tools: TOOLS, messages: [{ role: 'user', content: 'make me an image of a red fox in snow' }] }, '', provider)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.toolCalls?.map(c => c.name)).not.toContain('web_search')
  })
})

describe('search-first image request without the search tool', () => {
  it('keeps the previous behaviour instead of dispatching a tool that was not offered', async () => {
    const tools = TOOLS.filter(t => t.name !== 'web_search')
    const result = await sendViaRouter({ model: 'qwen3-8b', systemPrompt: '', tools, messages: [{ role: 'user', content: ASK }] }, '', 'qwen')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.toolCalls?.[0]?.name).toBe('generate_image')
  })
})
