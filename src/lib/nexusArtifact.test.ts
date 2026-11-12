// ForgeClaw — Nexus browser-to-Actions result bridge regressions.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'
import { NEXUS_CHECKPOINT_SHA256 } from './ai/nexusIntelligenceContext'

const RUN_URL = 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/431'

function ctx(): ToolContext {
  return { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' }
}

function installNexusFetch(options: { conclusion: string; result: string; metadata: string }) {
  let invocationId = ''
  let mirrorHeadCalls = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/nexus-intelligence.yml/dispatches')) {
      const body = JSON.parse(String(init?.body)) as { inputs: { invocation_id: string } }
      invocationId = body.inputs.invocation_id
      return new Response(null, { status: 204 })
    }
    if (url.includes('/nexus-intelligence.yml/runs?')) {
      return Response.json({ workflow_runs: [{
        id: 431,
        name: `Nexus Intelligence ${invocationId}`,
        display_title: `Nexus Intelligence ${invocationId}`,
        event: 'workflow_dispatch',
        status: 'in_progress',
        conclusion: null,
        created_at: new Date().toISOString(),
        head_branch: 'main',
        html_url: RUN_URL,
        run_number: 25,
      }] })
    }
    if (url.endsWith('/actions/runs/431')) {
      return Response.json({
        id: 431,
        status: 'completed',
        conclusion: options.conclusion,
        created_at: new Date().toISOString(),
        head_branch: 'main',
        html_url: RUN_URL,
        run_number: 25,
        name: `Nexus Intelligence ${invocationId}`,
        display_title: `Nexus Intelligence ${invocationId}`,
        event: 'workflow_dispatch',
      })
    }
    if (url.includes('raw.githubusercontent.com')) {
      if (init?.method === 'HEAD') {
        mirrorHeadCalls += 1
        // A stale/early mirror must not override the actual Actions conclusion.
        return new Response(null, { status: 200 })
      }
      if (url.endsWith('.meta.txt')) return new Response(options.metadata, { status: 200 })
      if (url.endsWith('.txt')) return new Response(options.result, { status: 200 })
    }
    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, get mirrorHeadCalls() { return mirrorHeadCalls } }
}

async function runNexus(task = 'say exactly: hello', ref?: string): Promise<string> {
  return executeTool({
    id: 'nexus-audit-test',
    name: 'nexus_reason',
    input: { task, ...(ref ? { ref } : {}) },
  }, ctx())
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Nexus Actions result integrity', () => {
  it('returns a successful segment only when the runner attests the pinned Run 25 SHA', async () => {
    installNexusFetch({
      conclusion: 'success',
      result: '<|ev:verified|><|answer|>The Nexus workflow completed.<|/answer|><|end|>',
      metadata: `model=Nexus Intelligence (Run 25 checkpoint)\ncheckpoint_sha256=${NEXUS_CHECKPOINT_SHA256}\n`,
    })

    const output = await runNexus()

    expect(output).toContain('checkpoint=nexus-run25-sha256-c41852fb0ac1')
    expect(output).toContain('The Nexus workflow completed.')
  })

  it.each([
    ['missing', 'model=Nexus Intelligence (Run 25 checkpoint)\n'],
    ['mismatched', 'checkpoint_sha256=deadbeef\n'],
  ])('withholds a result when checkpoint metadata is %s', async (_kind, metadata) => {
    installNexusFetch({
      conclusion: 'success',
      result: '<|ev:verified|><|answer|>Unverified answer.<|/answer|><|end|>',
      metadata,
    })

    const output = await runNexus()

    expect(output).toContain('[TOOL ERROR]')
    expect(output).toContain('did not verify the Run 25 checkpoint')
    expect(output).not.toContain('Unverified answer.')
  })

  it('surfaces a runner-written failure diagnostic after a failed Actions conclusion, without trusting mirror HEAD', async () => {
    const fetch = installNexusFetch({
      conclusion: 'failure',
      result: '[NEXUS RUN FAILED] checkpoint mismatch in runner',
      metadata: `checkpoint_sha256=${NEXUS_CHECKPOINT_SHA256}\nrun_failed=true\n`,
    })

    const output = await runNexus()

    expect(output).toContain('failed on the runner: checkpoint mismatch in runner')
    expect(fetch.mirrorHeadCalls).toBe(0)
  })

  it('does not return a mirrored model segment as success when later workflow steps fail', async () => {
    installNexusFetch({
      conclusion: 'failure',
      result: '<|ev:verified|><|answer|>Do not return this partial answer.<|/answer|><|end|>',
      metadata: `checkpoint_sha256=${NEXUS_CHECKPOINT_SHA256}\n`,
    })

    const output = await runNexus()

    expect(output).toContain('[TOOL ERROR]')
    expect(output).toContain('GitHub Actions run did not succeed')
    expect(output).not.toContain('Do not return this partial answer.')
  })

  it('rejects an unsupported ref before dispatch instead of timing out during run discovery', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const output = await runNexus('say hello', 'feature/nexus')

    expect(output).toContain('supports only the main workflow ref')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
