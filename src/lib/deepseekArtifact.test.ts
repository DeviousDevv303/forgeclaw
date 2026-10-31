// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// DeepSeek result-retrieval contract:
//   • the raw.githubusercontent.com mirror is tried first (browser-safe);
//   • the workflow artifact is the fallback for runs published before the mirror;
//   • every failing stage identifies itself instead of collapsing into the
//     browser's opaque "Failed to fetch".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'
import { describeGithubTransportFailure, isBrowserNetworkFailure } from './githubFetch'
import { DEEPSEEK_DISCOVERY_PAGE_SIZE, DEEPSEEK_EMPTY_RESPONSE_PLACEHOLDER, DEEPSEEK_MAX_WAIT_MS, isEmptyDeepSeekResponse, normalizeDeepSeekOutput, waitForDeepSeekRun } from './deepseekArtifact'

function ctx(): ToolContext {
  return { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' }
}

async function resultZip(text: string): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('result.txt', text)
  zip.file('result_meta.txt', 'model=deepseek-ai/deepseek-coder-1.3b-instruct\nrole=fallback checkpoint after primary failure: OOM\nelapsed_seconds=12.3\n')
  return zip.generateAsync({ type: 'arraybuffer' })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DeepSeek output normalization', () => {
  it('decodes a leaked ByteLevel token stream and removes its name placeholder', () => {
    const leaked = 'Dear Ġ[USER_NAME],ĊĊAs ĠForgeClaw, Ġthis Ġis Ġa Ġreadable Ġsentence.ĊĊFirst, Ġa Ġpoint.'
    const normalized = normalizeDeepSeekOutput(leaked)

    expect(normalized).toBe('As ForgeClaw, this is a readable sentence.\n\nFirst, a point.')
    expect(normalized).not.toMatch(/[ĠĊ]|\[USER_NAME\]/)
  })

  it('leaves ordinary prose unchanged apart from trimming whitespace', () => {
    expect(normalizeDeepSeekOutput('  A normal answer.  ')).toBe('A normal answer.')
  })

  it('rejects word-level repetitive loops from greedy decoding', () => {
    const looped = Array(30).fill('the answer is the answer is').join(' ')
    expect(() => normalizeDeepSeekOutput(looped)).toThrow('repetitive word loop')
  })

  it('preserves legitimate repeated phrases in normal prose', () => {
    const prose = 'The repository state shows the main branch at the expected commit. The branch is clean and the working tree matches.'
    expect(normalizeDeepSeekOutput(prose)).toBe(prose)
  })
})

describe('DeepSeek result retrieval', () => {
  it('prefers the browser-readable mirror and never lists artifacts', async () => {
    let artifactListCalls = 0
    let payload: { inputs: { invocation_id: string } } | undefined

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/deepseek-16b.yml/dispatches')) {
        payload = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }
      if (url.includes('/deepseek-16b.yml/runs?')) {
        return Response.json({ workflow_runs: [{
          id: 84,
          name: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          display_title: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84',
          run_number: 84,
        }] })
      }
      if (url.endsWith('/actions/runs/84')) {
        return Response.json({ id: 84, status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84, name: 'DeepSeek 16B', display_title: 'DeepSeek 16B', event: 'workflow_dispatch' })
      }
      if (url.includes('raw.githubusercontent.com') && url.endsWith('.meta.txt')) return new Response('model=deepseek-ai/deepseek-coder-6.7b-instruct\nrole=primary checkpoint\nelapsed_seconds=8.2\n', { status: 200 })
      if (url.includes('raw.githubusercontent.com')) return new Response('Mirror answer from the workflow.', { status: 200 })
      if (url.includes('/artifacts?')) { artifactListCalls += 1; return Response.json({ artifacts: [] }) }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch)

    const output = await executeTool({
      id: 'deepseek-mirror',
      name: 'ask_deepseek',
      input: { question: 'Explain the reasoning flow.' },
    }, ctx())

    expect(output).toContain('Mirror answer from the workflow.')
    expect(output).toContain('checkpoint=deepseek-ai/deepseek-coder-6.7b-instruct')
    expect(artifactListCalls).toBe(0)
  })

  it('falls back to the workflow artifact when the mirror is absent', async () => {
    let payload: { inputs: { invocation_id: string } } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/deepseek-16b.yml/dispatches')) {
        payload = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }
      if (url.includes('/deepseek-16b.yml/runs?')) {
        return Response.json({ workflow_runs: [{
          id: 91,
          name: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          display_title: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/91',
          run_number: 91,
        }] })
      }
      if (url.endsWith('/actions/runs/91')) {
        return Response.json({ id: 91, status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/91', run_number: 91, name: 'DeepSeek 16B', display_title: 'DeepSeek 16B', event: 'workflow_dispatch' })
      }
      if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 404 })
      if (url.includes('/artifacts?')) {
        return Response.json({ artifacts: [{ name: `deepseek-${payload?.inputs.invocation_id}`, archive_download_url: 'https://example.test/deepseek.zip', expired: false }] })
      }
      if (url === 'https://example.test/deepseek.zip') return new Response(await resultZip('Artifact answer from the runner.'), { status: 200 })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch)

    const output = await executeTool({
      id: 'deepseek-artifact',
      name: 'ask_deepseek',
      input: { question: 'Explain the reasoning flow.' },
    }, ctx())

    expect(output).toContain('Artifact answer from the runner.')
    expect(output).toContain('checkpoint=deepseek-ai/deepseek-coder-1.3b-instruct')
  })
})

describe('DeepSeek stage-specific failures', () => {
  it('keeps looking for the run after a discovery read times out, then names the stage and the read error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = waitForDeepSeekRun(ctx(), 'DeviousDevv303', 'forgeclaw', 'deepseek-timeout-discovery', Date.now())
    const assertion = expect(pending).rejects.toThrow('deepseek-run-discovery: DeepSeek dispatched, but GitHub could not be read to find run "deepseek-timeout-discovery" within 120s. Last read error: deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs: GitHub read timed out after 30000ms')
    await vi.advanceTimersByTimeAsync(121_000)
    await assertion
    // One hung read is not the end of discovery: the dispatched run may already be executing.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('finds the run when one discovery read fails and the next succeeds', async () => {
    vi.useFakeTimers()
    const invocationId = 'deepseek-flaky-discovery'
    const run = {
      id: 91, name: `Qwen/Qwen3-8B ${invocationId}`, display_title: `Qwen/Qwen3-8B ${invocationId}`,
      event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(),
      head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/91', run_number: 91,
    }
    let listCalls = 0
    const listUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/deepseek-16b.yml/runs?')) {
        listUrls.push(url)
        listCalls += 1
        // A network failure on every retry of the first poll, then a normal list.
        if (listCalls <= 3) throw new TypeError('Failed to fetch')
        return Response.json({ workflow_runs: [run] })
      }
      if (url.includes('raw.githubusercontent.com')) return new Response('ok', { status: 200 })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch)

    const pending = waitForDeepSeekRun(ctx(), 'DeviousDevv303', 'forgeclaw', invocationId, Date.now())
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toMatchObject({ id: 91, status: 'completed', conclusion: 'success' })
    expect(listCalls).toBeGreaterThan(3)
    // Small pages: 100 runs is ~1.6 MB per poll on the real repository.
    expect(listUrls.every(url => url.includes(`per_page=${DEEPSEEK_DISCOVERY_PAGE_SIZE}`))).toBe(true)
    expect(DEEPSEEK_DISCOVERY_PAGE_SIZE).toBeLessThanOrEqual(20)
  })

  it('reports run-not-found, not unreadable, when reads recovered but the run never appeared', async () => {
    vi.useFakeTimers()
    let listCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/deepseek-16b.yml/runs?')) throw new Error(`Unexpected fetch URL: ${String(input)}`)
      listCalls += 1
      if (listCalls <= 3) throw new TypeError('Failed to fetch')
      return Response.json({ workflow_runs: [] })
    }) as unknown as typeof fetch)
    const pending = waitForDeepSeekRun(ctx(), 'DeviousDevv303', 'forgeclaw', 'deepseek-never-registered', Date.now())
    const assertion = expect(pending).rejects.toThrow('deepseek-run-discovery: DeepSeek dispatched but correlated run "deepseek-never-registered" was not found within 120s.')
    await vi.advanceTimersByTimeAsync(121_000)
    await assertion
  })

  it('takes one last look at the deadline: a run first listed exactly then is found, not lost', async () => {
    vi.useFakeTimers()
    const invocationId = 'deepseek-at-deadline'
    const deadline = Date.now() + 120_000
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('raw.githubusercontent.com')) return new Response('ok', { status: 200 })
      if (!String(input).includes('/deepseek-16b.yml/runs?')) throw new Error(`Unexpected fetch URL: ${String(input)}`)
      if (Date.now() < deadline) return Response.json({ workflow_runs: [] })
      return Response.json({ workflow_runs: [{
        id: 77, name: `Qwen/Qwen3-8B ${invocationId}`, display_title: `Qwen/Qwen3-8B ${invocationId}`, event: 'workflow_dispatch',
        status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main',
        html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/77', run_number: 77,
      }] })
    }) as unknown as typeof fetch)
    const pending = waitForDeepSeekRun(ctx(), 'DeviousDevv303', 'forgeclaw', invocationId, Date.now())
    const settled = pending.then(v => ({ v }), e => ({ e: String(e) }))
    await vi.advanceTimersByTimeAsync(125_000)
    expect(await settled).toMatchObject({ v: { id: 77 } })
  })

  it('tolerates transient poll failures and times out after max wait', async () => {
    vi.useFakeTimers()
    const invocationId = 'deepseek-timeout-poll'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void init
      const url = String(input)
      if (url.includes('/deepseek-16b.yml/runs?')) {
        return Response.json({ workflow_runs: [{
          id: 88,
          name: `Qwen/Qwen3-8B ${invocationId}`,
          display_title: `Qwen/Qwen3-8B ${invocationId}`,
          event: 'workflow_dispatch',
          status: 'in_progress',
          conclusion: null,
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/88',
          run_number: 88,
        }] })
      }
      // Mirror check: return 404 so it falls through to GitHub API poll
      if (url.includes('raw.githubusercontent.com')) {
        return new Response('Not Found', { status: 404 })
      }
      // Simulate transient network failure: reject immediately
      throw new Error('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = waitForDeepSeekRun(ctx(), 'DeviousDevv303', 'forgeclaw', invocationId, Date.now())
    const assertion = expect(pending).rejects.toThrow('deepseek-run-poll: DeepSeek timed out after 31m')
    // Advance past the max wait time; transient failures should not abort early
    await vi.advanceTimersByTimeAsync(DEEPSEEK_MAX_WAIT_MS + 60000)
    await assertion
    // Multiple poll attempts were made (not just one)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3)
  })

  it('labels a browser network/CORS dispatch failure as deepseek-dispatch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)

    const output = await executeTool({
      id: 'deepseek-dispatch-fail',
      name: 'ask_deepseek',
      input: { question: 'anything' },
    }, ctx())

    expect(output.startsWith('[TOOL ERROR]')).toBe(true)
    expect(output).toContain('deepseek-dispatch')
    expect(output).toContain('browser network/CORS failure')
    // The old, useless generic message must be gone.
    expect(output).not.toBe('[TOOL ERROR] Failed to fetch')
  })

  it('labels a run-discovery HTTP failure as deepseek-run-discovery', async () => {
    let payload: { inputs: { invocation_id: string } } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/deepseek-16b.yml/dispatches')) {
        payload = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }
      if (url.includes('/deepseek-16b.yml/runs?')) return new Response('forbidden', { status: 403 })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch)

    const output = await executeTool({
      id: 'deepseek-discovery-fail',
      name: 'ask_deepseek',
      input: { question: 'anything' },
    }, ctx())

    expect(payload?.inputs.invocation_id).toMatch(/^deepseek-/)
    expect(output).toContain('deepseek-run-discovery')
    expect(output).toContain('HTTP 403')
  })

  it('labels a missing artifact as deepseek-artifact-list', async () => {
    let payload: { inputs: { invocation_id: string } } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/deepseek-16b.yml/dispatches')) {
        payload = JSON.parse(String(init?.body))
        return new Response(null, { status: 204 })
      }
      if (url.includes('/deepseek-16b.yml/runs?')) {
        return Response.json({ workflow_runs: [{
          id: 77,
          name: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          display_title: `Qwen/Qwen3-8B ${payload?.inputs.invocation_id}`,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          created_at: new Date().toISOString(),
          head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/77',
          run_number: 77,
        }] })
      }
      if (url.endsWith('/actions/runs/77')) {
        return Response.json({ id: 77, status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/77', run_number: 77, name: 'DeepSeek 16B', display_title: 'DeepSeek 16B', event: 'workflow_dispatch' })
      }
      if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 404 })
      if (url.includes('/artifacts?')) return Response.json({ artifacts: [] })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch)

    const output = await executeTool({
      id: 'deepseek-artifact-missing',
      name: 'ask_deepseek',
      input: { question: 'anything' },
    }, ctx())

    expect(output).toContain('deepseek-artifact-list')
    expect(output).toContain('was not found on run 77')
  })
})

describe('github transport classification', () => {
  it('recognises the opaque browser network error', () => {
    expect(isBrowserNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isBrowserNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isBrowserNetworkFailure(new Error('GitHub HTTP 403'))).toBe(false)
  })

  it('never reports a raw "Failed to fetch" without a stage', () => {
    const message = describeGithubTransportFailure('deepseek-artifact-download', new TypeError('Failed to fetch'))
    expect(message).toContain('deepseek-artifact-download')
    expect(message).toContain('browser network/CORS failure')
  })

  it('preserves an abort as an abort', () => {
    const message = describeGithubTransportFailure('deepseek-run-poll', new DOMException('x', 'AbortError'))
    expect(message).toContain('aborted')
  })
})

describe('DeepSeek empty response and wait budget', () => {
  it('treats the workflow placeholder and blank text as failures, not answers', () => {
    expect(isEmptyDeepSeekResponse(DEEPSEEK_EMPTY_RESPONSE_PLACEHOLDER)).toBe(true)
    expect(isEmptyDeepSeekResponse(`  ${DEEPSEEK_EMPTY_RESPONSE_PLACEHOLDER}\n`)).toBe(true)
    expect(isEmptyDeepSeekResponse('   ')).toBe(true)
    expect(isEmptyDeepSeekResponse('A real answer that mentions an empty response.')).toBe(false)
  })

  it('waits only slightly longer than the workflow job timeout (30 min)', () => {
    expect(DEEPSEEK_MAX_WAIT_MS).toBeGreaterThan(30 * 60 * 1000)
    expect(DEEPSEEK_MAX_WAIT_MS).toBeLessThanOrEqual(32 * 60 * 1000)
  })
})
