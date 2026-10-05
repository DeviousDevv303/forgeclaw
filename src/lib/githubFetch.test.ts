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
  it('bounds a GitHub API read at its stage deadline without retrying a timed-out GET', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(hangingFetch)
    vi.stubGlobal('fetch', fetchMock)
    const pending = toolFetch({ timeoutMs: 25 }, 'https://api.github.com/repos/acme/app')
    const assertion = expect(pending).rejects.toThrow('GitHub read timed out after 25ms')
    await vi.advanceTimersByTimeAsync(26)
    await assertion
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.cache).toBe('no-store')
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
