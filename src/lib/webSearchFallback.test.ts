// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool } from './forgeTools'
import { isToolFailureOutput } from './toolOutcome'

// web_search without a GitHub token cannot run live search at all:
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
    expect(out).toContain('Instant Answers has no entry')
    expect(out).not.toContain('did not produce')
    expect(out).not.toContain('Brave Search API key in Settings')
    expect(out).not.toMatch(/^No results for/)
    expect(isToolFailureOutput(out)).toBe(false)
  })
})

describe('web_search when the workflow search fails', () => {
  const ghCtx = { ghOwner: 'o', ghRepo: 'r', ghToken: 't', actor: 'operator', requestGuardianApproval: async () => true } as never
  const ghCall = (name: string, input: Record<string, unknown>) => executeTool({ id: '1', name, input }, ghCtx)

  function stubWorkflowDownInstantAnswers(payload: unknown) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) throw new TypeError('Failed to fetch')
      if (String(url).includes('api.duckduckgo.com')) {
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))
  }

  // The 2026-10-31 incident: the workflow run had completed with results while the app's
  // reads wedged. The empty-everything outcome was reported as "live search did not produce
  // any" plus a Settings prescription for a deleted key — a read failure misreported as an empty search,
  // and the turn closed COMPLETE. It must be a marked tool failure with neither claim.
  it('marks the empty-everything outcome as a tool failure stating the read failure class', async () => {
    stubWorkflowDownInstantAnswers({ AbstractText: '', RelatedTopics: [] })
    const out = await ghCall('web_search', { query: 'any fights this weekend', count: 5 })
    expect(isToolFailureOutput(out)).toBe(true)
    // No key context exists any more (the Brave branch was deleted 2026-10-31): with a
    // GitHub token, web_search goes straight to the DuckDuckGo workflow path.
    expect(out).toContain('workflow search failed: DuckDuckGo workflow dispatch failed')
    expect(out).toContain('could not be read back')
    expect(out).toContain('unavailable right now')
    expect(out).not.toContain('did not produce')
    expect(out).not.toContain('Brave')
  })

  it('still returns labelled Instant Answers (not a failure) when the fallback has content', async () => {
    stubWorkflowDownInstantAnswers({ AbstractText: 'A lighthouse is a tower with a light.', RelatedTopics: [] })
    const out = await ghCall('web_search', { query: 'what is a lighthouse', count: 5 })
    expect(isToolFailureOutput(out)).toBe(false)
    expect(out).toContain('DuckDuckGo workflow search failed')
    expect(out).toContain('static reference data, not live search results')
    expect(out).toContain('A lighthouse is a tower with a light.')
  })
})
