import { describe, expect, it } from 'vitest'
import { formatCodeReview, runCodeReview } from './codeReview'

const API = 'https://api.github.com/repos/o/r'

function github(opts: { conclusion?: string; review?: string } = {}) {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
  let id = ''
  const request = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, body })
    if (url.endsWith('/actions/workflows/code-review.yml/dispatches')) { id = String((body!.inputs as Record<string, string>).invocation_id); return new Response(null, { status: 204 }) }
    if (url.includes('/actions/workflows/code-review.yml/runs')) return Response.json({ workflow_runs: [{ id: 5, event: 'workflow_dispatch', head_branch: 'main', display_title: `Code Review ${id}`, created_at: new Date().toISOString(), status: 'in_progress', run_number: 4, html_url: 'https://github.com/o/r/actions/runs/5' }] })
    if (url === `${API}/actions/runs/5`) return Response.json({ id: 5, status: 'completed', conclusion: opts.conclusion ?? 'success', run_number: 4, html_url: 'https://github.com/o/r/actions/runs/5' })
    if (url.endsWith(`/contents/review-results/${id}.txt?ref=review-results`)) return new Response(opts.review ?? 'Bug: add() subtracts its arguments.')
    if (url.endsWith(`/contents/review-results/${id}.meta.txt?ref=review-results`)) return new Response('model=deepseek-coder-6.7b-instruct\n')
    return new Response('{}', { status: 404 })
  }
  return { request, calls, id: () => id }
}
const fast = { sleep: async () => {}, now: Date.now }

describe('code review on GitHub Actions', () => {
  it('dispatches the review, waits for it, and returns the review text', async () => {
    const gh = github()
    const result = await runCodeReview(gh.request, { owner: 'o', repo: 'r', token: 't', code: 'function add(a,b){return a-b}', language: 'javascript', ...fast })
    expect(result.review).toBe('Bug: add() subtracts its arguments.')
    expect(gh.calls.find(c => c.url.endsWith('/dispatches'))!.body!.inputs).toEqual({ code_content: 'function add(a,b){return a-b}', language: 'javascript', invocation_id: gh.id() })
    expect(formatCodeReview(result)).toBe('✓ Code review by deepseek-coder-6.7b-instruct · run https://github.com/o/r/actions/runs/5\nBug: add() subtracts its arguments.')
  })

  it('reports a failed review as a failure, never as a review', async () => {
    await expect(runCodeReview(github({ conclusion: 'failure', review: 'REVIEW FAILED (failure); see the run log.' }).request, { owner: 'o', repo: 'r', token: 't', code: 'x = 1', ...fast }))
      .rejects.toThrow(/code review run #4 failed \(failure\)/)
  })

  it('refuses empty or oversized code before dispatching anything', async () => {
    const gh = github()
    await expect(runCodeReview(gh.request, { owner: 'o', repo: 'r', token: 't', code: '   ', ...fast })).rejects.toThrow(/needs the code/)
    await expect(runCodeReview(gh.request, { owner: 'o', repo: 'r', token: 't', code: 'x'.repeat(12_001), ...fast })).rejects.toThrow(/at most 12000 characters/)
    expect(gh.calls).toHaveLength(0)
  })
})
