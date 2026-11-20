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
