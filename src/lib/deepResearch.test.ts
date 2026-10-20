import { describe, expect, it } from 'vitest'
import { formatResearchResult, normalizeQueries, RESEARCH_RESULT_MAX_CHARS, runDeepResearch, type ResearchReport } from './deepResearch'
import type { GithubRequest } from './githubPublish'

const WF = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'
const report: ResearchReport = {
  question: 'Is Qwen3.5 9B good on CPU?', queries: ['qwen3.5 9b cpu', 'qwen3.5 benchmark'], elapsed_seconds: 41.2,
  sources: [
    { id: 1, url: 'https://a.example/qwen', domain: 'a.example', title: 'Qwen on CPU', date: '2026-09-01', excerpt: 'Runs at 4 tok/s on 4 cores.' },
    { id: 2, url: 'https://b.example/bench', domain: 'b.example', title: '', date: '', excerpt: 'Beats 7B chat models.' },
  ],
  failures: [{ url: 'https://c.example', error: 'TimeoutError' }],
}

function fake(conclusion = 'success', mirror: ResearchReport | null = report) {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
  let clock = 5_000_000
  let polls = 0
  const run = (status: string) => ({ id: 9, run_number: 3, name: 'Deep Research', display_title: 'Deep research inv-r', event: 'workflow_dispatch', head_branch: 'main', status, conclusion: status === 'completed' ? conclusion : null, created_at: new Date(clock).toISOString(), html_url: 'https://github.com/x/actions/runs/9' })
  const request: GithubRequest = async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/dispatches')) return new Response(null, { status: 204 })
    if (url.includes('/actions/workflows/deep-research.yml/runs')) return Response.json({ workflow_runs: [run('queued')] })
    if (url === `${WF}/actions/runs/9`) { polls++; return Response.json(run(polls > 1 ? 'completed' : 'in_progress')) }
    if (url === `${WF}/contents/research-results/inv-r.json?ref=research-results`) return mirror ? Response.json(mirror) : new Response('{}', { status: 404 })
    return new Response('{}', { status: 500 })
  }
  return { request, calls, base: { owner: 'DeviousDevv303', repo: 'forgeclaw', token: 't', invocationId: 'inv-r', sleep: async (ms: number) => { clock += ms }, now: () => clock } }
}

describe('runDeepResearch', () => {
  it('dispatches with bounded inputs and reads the mirrored evidence', async () => {
    const f = fake()
    const out = await runDeepResearch(f.request, { ...f.base, question: '  Is Qwen3.5 9B\n good on CPU? ', queries: ['a', ' b ', '', 'c', 'd', 'e', 'f', 'g'], maxSources: 40 })
    expect(out.report.sources).toHaveLength(2)
    expect(f.calls[0].body).toEqual({ ref: 'main', inputs: { question: 'Is Qwen3.5 9B good on CPU?', queries: 'a\nb\nc\nd\ne\nf', max_sources: '15', invocation_id: 'inv-r' } })
  })
  it('still reads the evidence of a run that found nothing, so the failures can be shown', async () => {
    const f = fake('failure', { ...report, sources: [] })
    const out = await runDeepResearch(f.request, { ...f.base, question: 'q' })
    expect(formatResearchResult(out.report, out.runUrl)).toMatch(/^\[TOOL ERROR\] deep_research found no readable sources/)
  })
  it('reports a run whose evidence is missing', async () => {
    const f = fake('failure', null)
    await expect(runDeepResearch(f.request, { ...f.base, question: 'q' })).rejects.toThrow(/concluded "failure" and its evidence could not be read/)
  })
  it('rejects an empty question before dispatching', async () => {
    const f = fake()
    await expect(runDeepResearch(f.request, { ...f.base, question: '   ' })).rejects.toThrow(/question is required/)
    expect(f.calls).toEqual([])
  })
})

describe('formatResearchResult', () => {
  it('accepts research output exactly at the 40,000-character limit', () => {
    const base = { ...report, question: 'q', queries: [], sources: [{ id: 1, url: 'https://a.example', domain: 'a.example', title: 't', date: '', excerpt: '' }], failures: [] }
    const runUrl = 'https://run'
    const header = `✓ Deep research: 1 source(s) for "${base.question}" (${base.queries.length} queries, ${base.elapsed_seconds}s)\n` +
      'Write the answer only from these sources and cite them as [n]. Say plainly what they do not cover; never cite a source that is not listed.\nrun: https://run\n'
    const entryPrefix = `\n[1] ${base.sources[0].title} (${base.sources[0].domain})\n${base.sources[0].url}\n`
    const excerptLength = RESEARCH_RESULT_MAX_CHARS - header.length - entryPrefix.length - 1
    const exactReport = { ...base, sources: [{ ...base.sources[0], excerpt: 'x'.repeat(excerptLength) }] }

    const result = formatResearchResult(exactReport, runUrl)

    expect(result).toHaveLength(RESEARCH_RESULT_MAX_CHARS)
    expect(result).toContain('x'.repeat(excerptLength))
    expect(result).not.toContain('more source(s) omitted for length')
  })

  it('numbers sources for citation and states the citation rule', () => {
    const text = formatResearchResult(report, 'https://run')
    expect(text).toMatch(/^✓ Deep research: 2 source\(s\)/)
    expect(text).toContain('cite them as [n]')
    expect(text).toContain('[1] Qwen on CPU (a.example, 2026-09-01)\nhttps://a.example/qwen\nRuns at 4 tok/s')
    expect(text).toContain('[2] https://b.example/bench (b.example)')
    expect(text).toContain('Not used: 1 page(s)')
  })
  it('accepts queries as an array or a newline/semicolon string', () => {
    expect(normalizeQueries('a; b\nc')).toEqual(['a', 'b', 'c'])
    expect(normalizeQueries(undefined)).toEqual([])
  })
})
