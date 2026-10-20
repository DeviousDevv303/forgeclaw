// @vitest-environment node
// relay/worker.js holds a token that can dispatch the model workflow. These tests pin what it may do:
// only the allowed origins, only deepseek-16b.yml with learning and the mirror branch off, bounded
// input, per-IP and concurrency limits, and results read from the run's own artifact.
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { readZipEntries, sanitizeErrorEntries } from '../../relay/worker.js'

const ORIGIN = 'https://deviousdevv303.github.io'
const API = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'

class MemoryKV {
  store = new Map<string, string>()
  async get(k: string) { return this.store.get(k) ?? null }
  async put(k: string, v: string) { this.store.set(k, v) }
  async delete(k: string) { this.store.delete(k) }
  async list({ prefix }: { prefix: string }) { return { keys: [...this.store.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true } }
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

  it('dispatches deepseek-16b.yml with learning and the public mirror off', async () => {
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

  it('passes gathered evidence as a separate, bounded context', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return url.includes('/runs?status=') ? Response.json({ workflow_runs: [] }) : new Response(null, { status: 204 })
    }))
    const post = (context: string) => worker.fetch(req('/v1/reason', { method: 'POST', body: JSON.stringify({ task: 'Answer with [n] citations', context }) }), env({ MAX_PER_HOUR: '10' }))
    expect((await post('x'.repeat(16001))).status).toBe(413)
    expect((await post('[1] Example source\nhttps://example.com\nevidence')).status).toBe(202)
    expect((calls.find(c => c.url.endsWith('/dispatches'))!.body!.inputs as Record<string, string>).context).toBe('[1] Example source\nhttps://example.com\nevidence')
  })

  it('runs live web research only through deep-research.yml, bounded and without the mirror branch', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    let inProgress: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return url.includes('/runs?status=') ? Response.json({ workflow_runs: inProgress }) : new Response(null, { status: 204 })
    }))
    const e = env()
    const post = (question: string) => worker.fetch(req('/v1/research', { method: 'POST', body: JSON.stringify({ question }) }), e)
    expect((await post('')).status).toBe(400)
    expect((await post('x'.repeat(501))).status).toBe(413)
    inProgress = [{ display_title: 'Deep research public-abc-123' }]
    expect((await post('latest in tech')).status).toBe(503)
    expect(calls.some(c => c.url.includes('/workflows/deep-research.yml/runs?status='))).toBe(true)
    inProgress = []
    const res = await post('latest in tech')
    expect(res.status).toBe(202)
    const { invocation_id } = await res.json() as { invocation_id: string }
    const dispatch = calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.url).toBe(`${API}/actions/workflows/deep-research.yml/dispatches`)
    expect(dispatch.body).toEqual({ ref: 'main', inputs: { question: 'latest in tech', queries: '', max_sources: '6', invocation_id, mirror: 'false' } })
    expect((await post('again')).status).toBe(429)  // MAX_PER_HOUR=2, its own bucket; the busy attempt counted too
    expect((await worker.fetch(req('/v1/research', { method: 'POST', body: '{}' }), env({ GITHUB_TOKEN: '' }))).status).toBe(503)
  })

  it('reads the research report from the run artifact, also from a run that found nothing', async () => {
    const id = 'public-mabc123-0123456789'
    const report = { question: 'latest in tech', queries: ['latest in tech'], sources: [{ id: 1, url: 'https://example.com/a', domain: 'example.com', title: 'A', date: '2026-10-19', excerpt: 'news' }], failures: [], elapsed_seconds: 5 }
    const zip = new JSZip()
    zip.file('research.json', JSON.stringify(report))
    const archive = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    let run: Record<string, unknown> = { id: 8, display_title: `Deep research ${id}`, status: 'in_progress', conclusion: null, html_url: 'https://github.com/run/8' }
    let artifacts = [{ id: 98, name: `research-${id}`, expired: false }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/workflows/deep-research.yml/runs?event=')) return Response.json({ workflow_runs: [run] })
      if (url.endsWith('/actions/runs/8/artifacts?per_page=20')) return Response.json({ artifacts })
      if (url.endsWith('/actions/artifacts/98/zip')) return new Response(archive)
      return new Response('{}', { status: 404 })
    }))
    expect(await (await worker.fetch(req(`/v1/research/${id}`), env())).json()).toEqual({ status: 'in_progress' })
    run = { ...run, status: 'completed', conclusion: 'failure' }
    expect(await (await worker.fetch(req(`/v1/research/${id}`), env())).json()).toEqual({ status: 'done', report, run_url: 'https://github.com/run/8' })
    artifacts = []
    expect(await (await worker.fetch(req(`/v1/research/${id}`), env())).json()).toEqual({ status: 'failed', conclusion: 'failure', run_url: 'https://github.com/run/8' })
    expect((await worker.fetch(req('/v1/research/owner-run'), env())).status).toBe(404)
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

  it('stores each visitor conversation once for the owner to import into NEXUS', async () => {
    const LEARN = new MemoryKV()
    const e = env({ LEARN, OWNER_KEY: 'owner-secret' })
    let id = ''
    const zip = new JSZip()
    zip.file('result.txt', 'An answer.')
    zip.file('result_meta.txt', 'model=Qwen/Qwen3-8B')
    const archive = await zip.generateAsync({ type: 'arraybuffer' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/runs?status=')) return Response.json({ workflow_runs: [] })
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 })
      if (url.includes('/runs?event=')) return Response.json({ workflow_runs: [{ id: 7, display_title: `DeepSeek 16B ${id}`, status: 'completed', conclusion: 'success' }] })
      if (url.endsWith('/actions/runs/7/artifacts?per_page=20')) return Response.json({ artifacts: [{ id: 99, name: `deepseek-${id}`, expired: false }] })
      if (url.endsWith('/actions/artifacts/99/zip')) return new Response(archive.slice(0))
      return new Response('{}', { status: 404 })
    }))
    id = ((await (await worker.fetch(req('/v1/reason', { method: 'POST', body: JSON.stringify({ task: 'What is NEXUS?' }) }), e)).json()) as { invocation_id: string }).invocation_id
    await worker.fetch(req(`/v1/reason/${id}`), e)
    await worker.fetch(req(`/v1/reason/${id}`), e)  // polled again: still one record
    const unauth = await worker.fetch(req('/v1/learning'), e)
    expect(unauth.status).toBe(401)
    const exported = await (await worker.fetch(req('/v1/learning', { headers: { Authorization: 'Bearer owner-secret' } }), e)).json() as { records: Array<Record<string, string>> }
    expect(exported.records).toEqual([expect.objectContaining({ id, task: 'What is NEXUS?', result: 'An answer.', model: 'Qwen/Qwen3-8B' })])
  })

  it('takes error reports from any user, strips secrets, stores them and emails the owner', async () => {
    const LEARN = new MemoryKV()
    const sent: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.resend.com/emails') { sent.push(JSON.parse(String(init!.body))); return Response.json({ id: 'e1' }) }
      return new Response('{}', { status: 404 })
    }))
    const e = env({ LEARN, OWNER_KEY: 'k', RESEND_API_KEY: 're_test', REPORT_EMAIL: 'owner@example.com', GITHUB_TOKEN: '' })
    const res = await worker.fetch(req('/v1/errors', { method: 'POST', body: JSON.stringify({ mode: 'visitor', app: '1.0', entries: [{ timestamp: 1, level: 'error', source: 'tool', message: 'GitHub 401 for token ghp_abcdefghijklmnopqrstuvwxyz0123456789', details: 'x'.repeat(2000) }] }) }), e)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ stored: true, email: 'sent' })
    expect(sent[0]).toMatchObject({ to: ['owner@example.com'], subject: 'ForgeClaw: 1 error(s) from a visitor session' })
    expect(String(sent[0].text)).toContain('GitHub 401 for token [redacted]')
    expect(String(sent[0].text)).not.toContain('ghp_')
    const stored = await (await worker.fetch(req('/v1/errors', { headers: { Authorization: 'Bearer k' } }), e)).json() as { records: Array<{ entries: Array<{ details: string }> }> }
    expect(stored.records[0].entries[0].details).toHaveLength(600)
  })

  it('sanitizes and bounds error entries', () => {
    const out = sanitizeErrorEntries(Array.from({ length: 50 }, (_, i) => ({ level: 'nope', message: `m${i} sk-ant-${'a'.repeat(30)}` })))
    expect(out).toHaveLength(30)
    expect(out[0]).toMatchObject({ level: 'error', message: 'm20 [redacted]' })
    expect(sanitizeErrorEntries('not a list')).toEqual([])
  })
})

