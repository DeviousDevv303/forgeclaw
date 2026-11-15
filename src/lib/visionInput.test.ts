import { describe, expect, it } from 'vitest'
import { formatImageAnalysis, runImageAnalysis, uploadVisionInput } from './visionInput'

const API = 'https://api.github.com/repos/o/r'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

function github(opts: { branchExists?: boolean; conflictOnce?: boolean; conclusion?: string; answer?: string } = {}) {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  let conflicts = opts.conflictOnce ? 1 : 0
  let invocationId = ''
  const request = async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, method, body })
    if (url === `${API}/git/ref/heads/vision-inputs`) return opts.branchExists ? Response.json({ object: { sha: 'tip' } }) : new Response('{}', { status: 404 })
    if (url === `${API}/git/commits/tip`) return Response.json({ tree: { sha: 'tiptree' } })
    if (url === `${API}/git/blobs`) return Response.json({ sha: 'blob1' })
    if (url === `${API}/git/trees`) return Response.json({ sha: 'tree1' })
    if (url === `${API}/git/commits`) return Response.json({ sha: 'commit1' })
    if (url === `${API}/git/refs/heads/vision-inputs` || url === `${API}/git/refs`) {
      if (conflicts-- > 0) return new Response('{}', { status: 422 })
      return Response.json({})
    }
    if (url.endsWith('/actions/workflows/image-analyze.yml/dispatches')) { invocationId = String((body!.inputs as Record<string, string>).invocation_id); return new Response(null, { status: 204 }) }
    if (url.includes('/actions/workflows/image-analyze.yml/runs')) return Response.json({ workflow_runs: [{ id: 5, event: 'workflow_dispatch', head_branch: 'main', display_title: `Analyze Image ${invocationId}`, created_at: new Date().toISOString(), status: 'in_progress', run_number: 3, html_url: 'https://github.com/o/r/actions/runs/5' }] })
    if (url === `${API}/actions/runs/5`) return Response.json({ id: 5, status: 'completed', conclusion: opts.conclusion ?? 'success', run_number: 3, html_url: 'https://github.com/o/r/actions/runs/5' })
    if (url.endsWith(`/contents/vision-results/${invocationId}.txt?ref=vision-results`)) return new Response(opts.answer ?? 'A particle detector at CERN.')
    if (url.endsWith(`/contents/vision-results/${invocationId}.meta.txt?ref=vision-results`)) return new Response('model=Qwen/Qwen2-VL-2B-Instruct\n')
    return new Response('{}', { status: 404 })
  }
  return { request, calls, id: () => invocationId }
}
const fast = { sleep: async () => {}, now: Date.now }

describe('picture analysis on GitHub Actions', () => {
  it('uploads an attached picture, runs the workflow on it, and returns the vision answer', async () => {
    const gh = github()
    const result = await runImageAnalysis(gh.request, { owner: 'o', repo: 'r', token: 't', prompt: 'what is this?', image: PNG, ...fast })
    expect(result.answer).toBe('A particle detector at CERN.')
    expect(result.model).toBe('Qwen/Qwen2-VL-2B-Instruct')
    // First upload creates the branch as an orphan holding only the picture.
    expect(gh.calls.find(c => c.url === `${API}/git/blobs`)!.body).toEqual({ content: 'iVBORw0KGgo=', encoding: 'base64' })
    expect(gh.calls.find(c => c.url === `${API}/git/commits` && c.method === 'POST')!.body!.parents).toEqual([])
    expect(gh.calls.find(c => c.url === `${API}/git/refs`)!.body).toEqual({ ref: 'refs/heads/vision-inputs', sha: 'commit1' })
    const dispatch = gh.calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.body!.inputs).toEqual({ image_url: '', image_ref: `vision-inputs/${gh.id()}.png`, prompt: 'what is this?', invocation_id: gh.id() })
    expect(formatImageAnalysis(result)).toBe('✓ Image analysis by Qwen/Qwen2-VL-2B-Instruct · run https://github.com/o/r/actions/runs/5\nA particle detector at CERN.')
  })

  it('adds to an existing branch and retries when another upload moved it', async () => {
    const gh = github({ branchExists: true, conflictOnce: true })
    expect(await uploadVisionInput(gh.request, { owner: 'o', repo: 'r', token: 't', invocationId: 'vision-1', dataUrl: PNG })).toBe('vision-inputs/vision-1.png')
    expect(gh.calls.filter(c => c.url === `${API}/git/refs/heads/vision-inputs` && c.method === 'PATCH')).toHaveLength(2)
    expect(gh.calls.find(c => c.url === `${API}/git/trees`)!.body!.base_tree).toBe('tiptree')
  })

  it('passes a public https URL through without uploading anything', async () => {
    const gh = github()
    await runImageAnalysis(gh.request, { owner: 'o', repo: 'r', token: 't', prompt: '', image: 'https://example.com/a.jpg', ...fast })
    expect(gh.calls.some(c => c.url.includes('/git/'))).toBe(false)
    expect(gh.calls.find(c => c.url.endsWith('/dispatches'))!.body!.inputs).toMatchObject({ image_url: 'https://example.com/a.jpg', image_ref: '', prompt: 'Describe this image in detail.' })
  })

  it('reports a failed analysis as a failure, never as an answer', async () => {
    await expect(runImageAnalysis(github({ conclusion: 'failure', answer: 'ANALYSIS FAILED (failure); see the run log.' }).request, { owner: 'o', repo: 'r', token: 't', prompt: 'x', image: PNG, ...fast }))
      .rejects.toThrow(/image analysis run #3 failed \(failure\)/)
    await expect(runImageAnalysis(github().request, { owner: 'o', repo: 'r', token: 't', prompt: 'x', image: 'http://insecure/a.jpg', ...fast })).rejects.toThrow(/attached picture or a public https/)
  })
})
