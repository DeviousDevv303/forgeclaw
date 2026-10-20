// @vitest-environment node
// relay/worker.js holds a token that can dispatch the model workflow. These tests pin what it may do:
// only the allowed origins, only deepseek-16b.yml with learning and the mirror branch off, bounded
// input, per-IP and concurrency limits, and results read from the run's own artifact.
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { readZipEntries } from '../../relay/worker.js'

const ORIGIN = 'https://deviousdevv303.github.io'
const API = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'

class MemoryKV {
  store = new Map<string, string>()
  async get(k: string) { return this.store.get(k) ?? null }
  async put(k: string, v: string) { this.store.set(k, v) }
}

function env(extra: Record<string, unknown> = {}) {
  return { GITHUB_TOKEN: 'gh-test', ALLOWED_ORIGINS: ORIGIN, RATE: new MemoryKV(), MAX_PER_HOUR: '2', MAX_CONCURRENT: '1', ...extra }
}
const req = (path: string, init: RequestInit & { origin?: string } = {}) =>
  new Request(`https://relay.example${path}`, { ...init, headers: { Origin: init.origin ?? ORIGIN, 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json', ...(init.headers || {}) } })

afterEach(() => vi.unstubAllGlobals())

describe('relay worker', () => {
  it('refuses other origins and answers CORS preflight only for the allowed one', async () => {
    expect((await worker.fetch(req('/v1/reason', { method: 'POST', origin: 'https://evil.example' }), env())).status).toBe(403)
    const pre = await worker.fetch(req('/v1/reason', { method: 'OPTIONS' }), env())
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('dispatches only deepseek-16b.yml, with learning and the public mirror off', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.includes('/runs?status=')) return Response.json({ workflow_runs: [] })
      return new Response(null, { status: 204 })
    }))
    const res = await worker.fetch(req('/v1/reason', { method: 'POST', body: JSON.stringify({ task: 'Explain recursion simply' }) }), env())
    expect(res.status).toBe(202)
    const { invocation_id } = await res.json() as { invocation_id: string }
    expect(invocation_id).toMatch(/^public-[a-z0-9]+-[a-z0-9]{10}$/)
    const dispatch = calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.url).toBe(`${API}/actions/workflows/deepseek-16b.yml/dispatches`)
    expect(dispatch.body).toEqual({ ref: 'main', inputs: { task: 'Explain recursion simply', context: '', nexus_learning: 'false', invocation_id, mirror: 'false' } })
    expect(calls.filter(c => c.url.endsWith('/dispatches'))).toHaveLength(1)
  })

  it('bounds the task, the per-IP rate and the number of concurrent public runs', async () => {
    let inProgress: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/runs?status=') ? Response.json({ workflow_runs: inProgress }) : new Response(null, { status: 204 })))
    const e = env()
    const post = (task: string) => worker.fetch(req('/v1/reason', { method: 'POST', body: JSON.stringify({ task }) }), e)
    expect((await post('')).status).toBe(400)
    expect((await post('x'.repeat(4001))).status).toBe(413)
    inProgress = [{ display_title: 'DeepSeek 16B public-abc-123' }]
    expect((await post('hi')).status).toBe(503)  // one public run already in progress (limit 1)
    inProgress = []
    expect((await post('hi')).status).toBe(202)
    expect((await post('hi')).status).toBe(429)  // MAX_PER_HOUR=2 counts every accepted attempt
  })

  it('reads the result from the run artifact and reports run states honestly', async () => {
    const id = 'public-mabc123-0123456789'
    const zip = new JSZip()
    zip.file('result.txt', 'Recursion is a function calling itself.')
    zip.file('result_meta.txt', 'model=Qwen/Qwen3-8B\nengine=llama.cpp')
    const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    let state = 'in_progress'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/runs?event=')) return Response.json({ workflow_runs: [{ id: 7, display_title: `DeepSeek 16B ${id}`, status: state, conclusion: state === 'completed' ? 'success' : null }] })
      if (url.endsWith('/actions/runs/7/artifacts?per_page=20')) return Response.json({ artifacts: [{ id: 99, name: `deepseek-${id}`, expired: false }] })
      if (url.endsWith('/actions/artifacts/99/zip')) return new Response(archive)
      return new Response('{}', { status: 404 })
    }))
    expect(await (await worker.fetch(req(`/v1/reason/${id}`), env())).json()).toEqual({ status: 'in_progress' })
    state = 'completed'
    expect(await (await worker.fetch(req(`/v1/reason/${id}`), env())).json()).toEqual({ status: 'done', result: 'Recursion is a function calling itself.', model: 'Qwen/Qwen3-8B' })
    expect((await worker.fetch(req('/v1/reason/../../etc'), env())).status).toBe(404)
    expect((await worker.fetch(req('/v1/reason/deepseek-owner-run'), env())).status).toBe(404)  // only public ids
  })

  it('unzips stored and deflated entries', async () => {
    const zip = new JSZip()
    zip.file('a/result.txt', 'stored text', { compression: 'STORE' })
    zip.file('result_meta.txt', 'deflated '.repeat(50), { compression: 'DEFLATE' })
    const files = await readZipEntries(await zip.generateAsync({ type: 'arraybuffer' }), ['result.txt', 'result_meta.txt'])
    expect(files['result.txt']).toBe('stored text')
    expect(files['result_meta.txt']).toBe('deflated '.repeat(50))
  })

  it('refuses to run without a token', async () => {
    expect((await worker.fetch(req('/v1/reason', { method: 'POST', body: '{}' }), env({ GITHUB_TOKEN: '' }))).status).toBe(503)
  })
})
