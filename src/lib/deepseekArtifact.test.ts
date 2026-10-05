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

function ctx(): ToolContext {
  return { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' }
}

async function resultZip(text: string): Promise<ArrayBuffer> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('result.txt', text)
  return zip.generateAsync({ type: 'arraybuffer' })
}

afterEach(() => vi.unstubAllGlobals())

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
          name: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
          display_title: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
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
          name: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
          display_title: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
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
  })
})

describe('DeepSeek stage-specific failures', () => {
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
          name: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
          display_title: `DeepSeek 16B ${payload?.inputs.invocation_id}`,
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
