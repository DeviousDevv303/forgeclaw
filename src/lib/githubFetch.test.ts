// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toolFetch } from './githubFetch'

function hangingFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared GitHub fetch boundary', () => {
  it('bounds a GitHub API read at its stage deadline, retrying a timed-out GET exactly once', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(hangingFetch)
    vi.stubGlobal('fetch', fetchMock)
    const pending = toolFetch({ timeoutMs: 25 }, 'https://api.github.com/repos/acme/app')
    const assertion = expect(pending).rejects.toThrow('GitHub read timed out after 25ms')
    await vi.advanceTimersByTimeAsync(200)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.cache).toBe('no-store')
  })

  it('returns the response when a timed-out GitHub GET succeeds on its one retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockImplementationOnce(hangingFetch)
      .mockResolvedValueOnce(new Response('ready', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = toolFetch({ timeoutMs: 25 }, 'https://api.github.com/repos/acme/app')
    await vi.advanceTimersByTimeAsync(200)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds a workflow-dispatch POST but never retries a non-idempotent write', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(hangingFetch)
    vi.stubGlobal('fetch', fetchMock)
    const pending = toolFetch({ timeoutMs: 40 }, 'https://api.github.com/repos/acme/app/actions/workflows/flow.yml/dispatches', { method: 'POST' })
    const assertion = expect(pending).rejects.toThrow('GitHub post timed out after 40ms')
    await vi.advanceTimersByTimeAsync(41)
    await assertion
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('retries transient GitHub read responses and returns the first non-transient response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('ready', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = toolFetch({}, 'https://api.github.com/repos/acme/app')
    await vi.advanceTimersByTimeAsync(350)
    const response = await pending
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(call => call[1]?.cache === 'no-store')).toBe(true)
  })
})

describe('family mode transport rewrite', () => {
  const ctx = { familyCode: 'lighthouse7', familyRelayUrl: 'https://relay.example/' }

  it('reroutes Actions API calls to the relay family tier with the code as Bearer', async () => {
    const { familyActionsRewrite } = await import('./githubFetch')
    const out = familyActionsRewrite(
      'https://api.github.com/repos/DeviousDevv303/forgeclaw/actions/workflows/generate-image.yml/runs?event=workflow_dispatch&per_page=50',
      { headers: { Authorization: 'token ' } }, ctx)
    expect(out?.input).toBe('https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/actions/workflows/generate-image.yml/runs?event=workflow_dispatch&per_page=50')
    expect(new Headers(out?.init.headers).get('Authorization')).toBe('Bearer lighthouse7')
  })

  it('leaves non-Actions GitHub calls and non-GitHub calls untouched', async () => {
    const { familyActionsRewrite } = await import('./githubFetch')
    expect(familyActionsRewrite('https://api.github.com/repos/DeviousDevv303/forgeclaw/contents/src/App.tsx', {}, ctx)).toBeNull()
    expect(familyActionsRewrite('https://example.com/actions/workflows/x.yml/runs', {}, ctx)).toBeNull()
  })

  it('rewrites the repo-scoped shapes for the app repository once the repo is known (full parity)', async () => {
    const { familyActionsRewrite } = await import('./githubFetch')
    const repoCtx = { ...ctx, ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' }
    const cases: Array<[string, string]> = [
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/contents/src/App.tsx', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/contents/src/App.tsx'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/git/blobs', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/git/blobs'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/git/refs/heads/audio-inputs', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/git/refs/heads/audio-inputs'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/contents/audio-results/audio-x.txt?ref=audio-results', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/contents/audio-results/audio-x.txt?ref=audio-results'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/pulls/12/merge', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/pulls/12/merge'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw/issues/235/comments?per_page=100&page=1', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/issues/235/comments?per_page=100&page=1'],
      ['https://api.github.com/repos/DeviousDevv303/forgeclaw', 'https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw'],
    ]
    for (const [input, expected] of cases) {
      const out = familyActionsRewrite(input, { headers: { Authorization: 'token ' } }, repoCtx)
      expect(out?.input).toBe(expected)
      expect(new Headers(out?.init.headers).get('Authorization')).toBe('Bearer lighthouse7')
    }
    // The same shapes for a DIFFERENT repository pass through untouched: the relay is pinned
    // to the app repo, and public reads of other repos keep working unauthenticated.
    expect(familyActionsRewrite('https://api.github.com/repos/SomeoneElse/other/contents/src/App.tsx', {}, repoCtx)).toBeNull()
    expect(familyActionsRewrite('https://api.github.com/repos/SomeoneElse/other/git/blobs', { method: 'POST' }, repoCtx)).toBeNull()
  })

  it('rewrites code search only when the query pins the app repository', async () => {
    const { familyActionsRewrite } = await import('./githubFetch')
    const repoCtx = { ...ctx, familyRepo: 'DeviousDevv303/forgeclaw' }
    const pinned = `https://api.github.com/search/code?q=${encodeURIComponent('shell repo:DeviousDevv303/forgeclaw')}&per_page=10`
    expect(familyActionsRewrite(pinned, {}, repoCtx)?.input).toBe(`https://relay.example/v1/family/search/code?q=${encodeURIComponent('shell repo:DeviousDevv303/forgeclaw')}&per_page=10`)
    const other = `https://api.github.com/search/code?q=${encodeURIComponent('shell repo:SomeoneElse/other')}&per_page=10`
    expect(familyActionsRewrite(other, {}, repoCtx)).toBeNull()
    // Without a known app repository the search call is left alone.
    expect(familyActionsRewrite(pinned, {}, ctx)).toBeNull()
  })

  it('does nothing without a code or a relay URL', async () => {
    const { familyActionsRewrite } = await import('./githubFetch')
    const url = 'https://api.github.com/repos/o/r/actions/runs/1'
    expect(familyActionsRewrite(url, {}, {})).toBeNull()
    expect(familyActionsRewrite(url, {}, { familyCode: 'x' })).toBeNull()
    expect(familyActionsRewrite(url, {}, { familyRelayUrl: 'https://relay.example' })).toBeNull()
  })

  it('toolFetch sends the rewritten request, not the GitHub one', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ url }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await toolFetch(ctx, 'https://api.github.com/repos/DeviousDevv303/forgeclaw/actions/workflows/qwen3-8b.yml/dispatches', { method: 'POST' })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/actions/workflows/qwen3-8b.yml/dispatches')
  })
})
