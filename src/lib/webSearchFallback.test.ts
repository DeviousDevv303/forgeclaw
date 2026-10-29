// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool } from './forgeTools'

// web_search without a Brave key and without a GitHub token cannot run live search at all:
// the DuckDuckGo workflow needs the token, so only Instant Answers remain. That fallback is
// static reference data and its output must say so — before this, it posed as search results
// with no note at all (the workflow-failure path had a note; the no-token path did not).
const ctx = { ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never
const call = (name: string, input: Record<string, unknown>) => executeTool({ id: '1', name, input }, ctx)

function stubInstantAnswers(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!String(url).includes('api.duckduckgo.com')) throw new Error(`unexpected fetch: ${url}`)
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('web_search with no live search route configured', () => {
  it('labels Instant Answers as static reference data, not live results', async () => {
    stubInstantAnswers({ AbstractText: 'A lighthouse is a tower with a light.', RelatedTopics: [] })
    const out = await call('web_search', { query: 'what is a lighthouse', count: 5 })
    expect(out).toContain('Live web search did not run')
    expect(out).toContain('NOT live search results')
    expect(out).toContain('DuckDuckGo Instant Answers')
    expect(out).toContain('A lighthouse is a tower with a light.')
  })

  it('says plainly when neither live search nor Instant Answers produced anything', async () => {
    stubInstantAnswers({ AbstractText: '', RelatedTopics: [] })
    const out = await call('web_search', { query: 'obscure query with no entry', count: 5 })
    expect(out).toContain('Live web search did not run')
    expect(out).toContain('live search did not produce any')
    expect(out).not.toMatch(/^No results for/)
  })
})
