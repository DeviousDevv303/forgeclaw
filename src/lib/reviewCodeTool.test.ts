// review_code used to answer "Code review dispatched … check artifacts" and nobody saw the review.
// The dispatcher now returns the review itself.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('review_code tool', () => {
  it('returns the review text, not "dispatched"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let id = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/actions/workflows/code-review.yml/dispatches')) { id = JSON.parse(String(init!.body)).inputs.invocation_id; return new Response(null, { status: 204 }) }
      if (url.includes('/actions/workflows/code-review.yml/runs')) return Response.json({ workflow_runs: [{ id: 5, event: 'workflow_dispatch', head_branch: 'main', display_title: `Code Review ${id}`, created_at: new Date().toISOString(), status: 'in_progress', run_number: 4, html_url: 'https://github.com/run/5' }] })
      if (url.endsWith('/actions/runs/5')) return Response.json({ id: 5, status: 'completed', conclusion: 'success', run_number: 4, html_url: 'https://github.com/run/5' })
      if (url.includes(`/contents/review-results/${id}.txt`)) return new Response('Bug: add() subtracts its arguments.')
      if (url.includes(`/contents/review-results/${id}.meta.txt`)) return new Response('model=deepseek-coder-6.7b-instruct\n')
      return new Response('{}', { status: 404 })
    }))
    const ctx = { ghToken: 'test-token', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw' } as ToolContext
    const pending = executeTool({ id: 'r1', name: 'review_code', input: { code: 'function add(a,b){return a-b}', language: 'javascript' } }, ctx)
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(10_000)
    const out = await pending
    expect(out).toContain('Bug: add() subtracts its arguments.')
    expect(out).not.toMatch(/dispatched/i)
  })
})
