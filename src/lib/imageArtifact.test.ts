import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_DISCOVERY_PAGE_SIZE, registerGeneratedImage, takeGeneratedImage, waitForImageRun } from './imageArtifact'
import type { ToolContext } from './forgeTools'

describe('generated image registry side-channel', () => {
  it('stores and one-shot-retrieves a data URL by invocation id', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

    registerGeneratedImage('sd-1234-abcd', dataUrl)

    expect(takeGeneratedImage('sd-1234-abcd')).toBe(dataUrl)
    expect(takeGeneratedImage('sd-1234-abcd')).toBeUndefined()
  })

  it('returns undefined for unknown invocation ids', () => {
    expect(takeGeneratedImage('sd-unknown-zzzz')).toBeUndefined()
  })

  it('keeps entries independent across invocations', () => {
    registerGeneratedImage('sd-1111-aaaa', 'data:image/png;base64,AAA')
    registerGeneratedImage('sd-2222-bbbb', 'data:image/png;base64,BBB')

    expect(takeGeneratedImage('sd-1111-aaaa')).toBe('data:image/png;base64,AAA')
    expect(takeGeneratedImage('sd-2222-bbbb')).toBe('data:image/png;base64,BBB')
  })
})

describe('generate_image tool output contract', () => {
  it('recognizes the invocation id format used by App.tsx', () => {
    const invocationId = 'sd-1791080000000-xyz123'

    const toolOutput = [
      '✓ Image generated (512x512, 340 KB) via run #42.',
      `Invocation: ${invocationId}`,
      'Enhanced prompt: "a red fox, artistic style, high quality, detailed"',
      'Run: https://github.com/DeviousDevv303/forgeclaw/actions/runs/123',
    ].join('\n')

    const match = toolOutput.match(/Invocation:\s*(sd-[A-Za-z0-9-]+)/)

    expect(match?.[1]).toBe(invocationId)
    expect(toolOutput).not.toContain('base64')
  })
})

describe('image discovery resilience', () => {
  it('exports a reduced page size (not 100)', async () => {
    const { IMAGE_DISCOVERY_PAGE_SIZE } = await import('./imageArtifact')
    expect(IMAGE_DISCOVERY_PAGE_SIZE).toBeLessThanOrEqual(20)
    expect(IMAGE_DISCOVERY_PAGE_SIZE).toBeGreaterThan(0)
  })
})

describe('image run discovery and status polling', () => {
  const ctx = { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' } as ToolContext
  const imageRun = (status: string) => ({
    id: 7, name: 'Generate image img-1', display_title: 'Generate image img-1', event: 'workflow_dispatch', status,
    conclusion: status === 'completed' ? 'success' : null, created_at: new Date().toISOString(), head_branch: 'main',
    html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/7', run_number: 7,
  })
  const listed = (status = 'completed') => Response.json({ workflow_runs: [imageRun(status)] })
  const isList = (input: RequestInfo | URL) => String(input).includes('/generate-image.yml/runs?')
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  /** Settle a promise under fake timers, advancing in 1s steps up to maxMs. */
  async function settle<T>(pending: Promise<T>, maxMs: number): Promise<{ value?: T; error?: string; pending?: true }> {
    let out: { value?: T; error?: string; pending?: true } = { pending: true }
    pending.then(value => { out = { value } }, error => { out = { error: String(error instanceof Error ? error.message : error) } })
    for (let t = 0; t < maxMs && out.pending; t += 1000) await vi.advanceTimersByTimeAsync(1000)
    return out
  }

  it('(a) a discovery read that never answers is timed out and retried, then reported as unreadable', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 160_000)
    expect(out.error).toContain('could not be read to find run "img-1" within 120s')
    expect(out.error).toContain('image-run-discovery')
    expect(out.error).toContain('timed out')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('(b) recovers from failed reads, finds the run, and lists only small pages', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!isList(input)) return Response.json(imageRun('completed'))
      urls.push(String(input))
      calls += 1
      if (calls <= 3) throw new TypeError('Failed to fetch')
      return listed()
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 10_000)
    expect(out.value).toMatchObject({ id: 7, status: 'completed' })
    expect(urls.every(url => url.includes(`per_page=${IMAGE_DISCOVERY_PAGE_SIZE}`))).toBe(true)
  })

  it('(c) reports run-not-found, not unreadable, when reads recovered but the run never appeared', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls <= 3) throw new TypeError('Failed to fetch')
      return Response.json({ workflow_runs: [] })
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 130_000)
    expect(out.error).toBe('Image generation dispatched but correlated run "img-1" was not found within 120s.')
  })

  it('(c2) takes one last look at the deadline: a run that is first listed exactly then is found, not lost', async () => {
    vi.useFakeTimers()
    const deadline = Date.now() + 120_000
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!isList(input)) return Response.json(imageRun('completed'))
      return Date.now() >= deadline ? listed() : Response.json({ workflow_runs: [] })
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 130_000)
    expect(out.error).toBeUndefined()
    expect(out.value).toMatchObject({ id: 7 })
  })

  it('(d) a refused credential during discovery fails at once, not after 120s of polling', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 5_000)
    expect(out.error).toContain('image-run-discovery GET /actions/workflows/generate-image.yml/runs: GitHub HTTP 403')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('(e) one failed status read does not end the wait', async () => {
    vi.useFakeTimers()
    let statusCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) return listed('in_progress')
      statusCalls += 1
      if (statusCalls === 1) throw new TypeError('Failed to fetch')
      return Response.json(imageRun('completed'))
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 30_000)
    expect(out.value).toMatchObject({ status: 'completed', conclusion: 'success' })
  })

  it('(f) a credential revoked mid-run fails at once instead of looping for the 46-minute wait', async () => {
    vi.useFakeTimers()
    let statusCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) return listed('in_progress')
      statusCalls += 1
      return new Response('Bad credentials', { status: 401, statusText: 'Unauthorized' })
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 60_000)
    expect(out.error).toContain('image-run-poll GET /actions/runs/{run_id}: GitHub HTTP 401')
    expect(statusCalls).toBe(1)
  })

  it('(g) a status read that never answers is timed out instead of hanging the tool', async () => {
    vi.useFakeTimers()
    let statusCalls = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (isList(input)) return Promise.resolve(listed('in_progress'))
      statusCalls += 1
      if (statusCalls > 1) return Promise.resolve(Response.json(imageRun('completed')))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }))
    const out = await settle(waitForImageRun(ctx, 'DeviousDevv303', 'forgeclaw', 'img-1', Date.now()), 120_000)
    expect(out.value).toMatchObject({ status: 'completed' })
  })
})

describe('image result download', () => {
  const ctx = { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' } as unknown as import('./forgeTools').ToolContext
  const invocationId = 'test-invocation-123'
  const runId = 7
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  /** Settle a promise under fake timers, advancing in 1s steps up to maxMs. */
  async function settle<T>(pending: Promise<T>, maxMs: number): Promise<{ value?: T; error?: string; pending?: true }> {
    let out: { value?: T; error?: string; pending?: true } = { pending: true }
    pending.then(value => { out = { value } }, error => { out = { error: String(error instanceof Error ? error.message : error) } })
    for (let t = 0; t < maxMs && out.pending; t += 1000) await vi.advanceTimersByTimeAsync(1000)
    return out
  }

  const hungFetch = () => vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))

  const isMirror = (input: RequestInfo | URL) => String(input).includes('raw.githubusercontent.com')
  const isArtifactList = (input: RequestInfo | URL) => String(input).includes('/artifacts?')

  it('(a) mirror hangs → falls back to artifact path', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (isMirror(input)) return hungFetch()(input, init)
      if (isArtifactList(input)) return Promise.resolve(Response.json({ artifacts: [] }))
      return Promise.reject(new Error('Unexpected fetch: ' + String(input)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadImagePng } = await import('./imageArtifact')
    const out = await settle(downloadImagePng(ctx, 'DeviousDevv303', 'forgeclaw', runId, invocationId), 30_000)
    expect(out.error).toContain(`Artifact "generated-image-${invocationId}" was not found on run ${runId}`)
  })

  it('(b) artifact list hangs → bounded failure with stage label', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (isMirror(input)) return Promise.resolve(new Response(null, { status: 404 }))
      if (isArtifactList(input)) return hungFetch()(input, init)
      return Promise.reject(new Error('Unexpected fetch: ' + String(input)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadImagePng } = await import('./imageArtifact')
    const out = await settle(downloadImagePng(ctx, 'DeviousDevv303', 'forgeclaw', runId, invocationId), 120_000)
    expect(out.error).toContain('image-artifact-list')
    expect(out.error).toMatch(/timed out|timeout/i)
  })

  it('(c) ZIP download hangs → bounded failure with stage label', async () => {
    vi.useFakeTimers()
    const artifact = { id: 1, name: `generated-image-${invocationId}`, size_in_bytes: 100, archive_download_url: 'https://api.github.com/zip', expired: false }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (isMirror(input)) return Promise.resolve(new Response(null, { status: 404 }))
      if (isArtifactList(input)) return Promise.resolve(Response.json({ artifacts: [artifact] }))
      return hungFetch()(input, init) // ZIP download hangs
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadImagePng } = await import('./imageArtifact')
    const out = await settle(downloadImagePng(ctx, 'DeviousDevv303', 'forgeclaw', runId, invocationId), 200_000)
    expect(out.error).toContain('image-artifact-download')
    expect(out.error).toMatch(/timed out|timeout/i)
  })

  it('(d) happy path: mirror PNG returns data URL, no api.github.com fetch', async () => {
    vi.useFakeTimers()
    // Minimal 1x1 PNG (valid header for dimension parsing)
    const pngBytes = new Uint8Array([137,80,78,71,13,10,26,10, 0,0,0,13,73,72,68,82, 0,0,0,1,0,0,0,1,8,2,0,0,0, 144,119,83,222])
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (isMirror(input)) return Promise.resolve(new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } }))
      return Promise.reject(new Error('Unexpected fetch: ' + String(input)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { downloadImagePng } = await import('./imageArtifact')
    const out = await settle(downloadImagePng(ctx, 'DeviousDevv303', 'forgeclaw', runId, invocationId), 10_000)
    expect(out.value?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const apiCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('api.github.com'))
    expect(apiCalls.length).toBe(0)
  })
})
