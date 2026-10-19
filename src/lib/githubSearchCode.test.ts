// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, loadToolContext } from './forgeTools'

const searchCall = {
  id: 'github-search-regression',
  name: 'github_search_code',
  input: { query: 'two words' },
}

const context = (ghToken: string) => ({
  ...loadToolContext(),
  ghToken,
  guardianPosture: 'autonomous' as const,
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('github_search_code', () => {
  it('returns paths from a successful GitHub code-search response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/search/code')
      expect(url.searchParams.get('q')).toBe('two words repo:DeviousDevv303/forgeclaw')
      expect(url.searchParams.get('per_page')).toBe('10')
      expect((init?.headers as Record<string, string>).Authorization).toBe('token test-token')
      return new Response(JSON.stringify({
        total_count: 2,
        items: [{ path: 'src/first.ts' }, { path: 'src/second.ts' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeTool(searchCall, context('test-token'))

    expect(result).toBe('Found 2 matches for "two words":\n• src/first.ts\n• src/second.ts')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the HTTP status and only GitHub’s safe message for a 403 response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: 'Resource not accessible by integration',
      documentation_url: 'https://docs.github.com/rest',
      private_debug_field: 'must not be exposed',
    }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeTool(searchCall, context('test-token'))

    expect(result).toContain('[TOOL ERROR]')
    expect(result).toContain('HTTP 403 Forbidden')
    expect(result).toContain('Resource not accessible by integration')
    expect(result).not.toContain('private_debug_field')
    expect(result).not.toContain('must not be exposed')
  })

  it('fails before making a request when the GitHub token is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeTool(searchCall, context(''))

    expect(result).toContain('[TOOL ERROR]')
    expect(result).toContain('GitHub code search requires authentication')
    expect(result).toContain('Settings')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distinguishes browser transport failures from HTTP responses', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetchMock)

    const pending = executeTool(searchCall, context('test-token'))
    await vi.runAllTimersAsync()
    const result = await pending

    // The search request and the tree fallback each use the shared three-attempt
    // transport retry policy.
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(result).toContain('[TOOL ERROR] GitHub code search: browser network/CORS failure')
    expect(result).toContain('request produced no HTTP response')
    expect(result).not.toContain('HTTP 0')
  })
})
