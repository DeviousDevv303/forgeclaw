import { describe, expect, it } from 'vitest'
import { formatFighterPostsBlock, formatResearchResult, missingForumLanes, normalizeQueries, normalizeSentimentInput, RESEARCH_RESULT_MAX_CHARS, runDeepResearch, type ResearchReport } from './deepResearch'
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
  it('passes sentiment subjects to the workflow when they are well-formed, and only then', async () => {
    const f = fake()
    await runDeepResearch(f.request, { ...f.base, question: 'q', sentiment: { query: ' UFC 333  Dvalishvili vs Yan ', sides: ['Merab Dvalishvili', 'Petr Yan'] } })
    expect(f.calls[0].body?.inputs).toMatchObject({ sentiment_query: 'UFC 333 Dvalishvili vs Yan', sentiment_sides: 'Merab Dvalishvili|Petr Yan' })
    const g = fake()
    await runDeepResearch(g.request, { ...g.base, question: 'q', sentiment: { query: 'UFC 333', sides: ['Only One'] } })
    expect(g.calls[0].body?.inputs).not.toHaveProperty('sentiment_query')
    expect(g.calls[0].body?.inputs).not.toHaveProperty('sentiment_sides')
  })
})

describe('normalizeSentimentInput', () => {
  it('needs a query and exactly two sides', () => {
    expect(normalizeSentimentInput(' UFC 333 ', ['Merab Dvalishvili', ' Petr Yan '])).toEqual({ query: 'UFC 333', sides: ['Merab Dvalishvili', 'Petr Yan'] })
    expect(normalizeSentimentInput('UFC 333', ['Merab Dvalishvili'])).toBeNull()
    expect(normalizeSentimentInput('UFC 333', ['A', 'B', 'C'])).toBeNull()
    expect(normalizeSentimentInput('', ['A', 'B'])).toBeNull()
    expect(normalizeSentimentInput(undefined, undefined)).toBeNull()
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

const sentimentReport: ResearchReport = {
  ...report,
  sentiment_requested: true,
  lanes: [
    { id: 'web', label: 'Web search', status: 'ran', items: 2, as_of: '2026-10-24T00:00:00Z', reason: '' },
    { id: 'reddit', label: 'Reddit', status: 'ran', items: 5, as_of: '2026-10-24T00:00:00Z', reason: '' },
    { id: 'x', label: 'X', status: 'not_configured', items: 0, as_of: '2026-10-24T00:00:00Z', reason: 'no xAI API key configured (repository secret XAI_API_KEY is not set); the X lane needs it for X search' },
    { id: 'facebook', label: 'Facebook', status: 'failed', items: 0, as_of: '2026-10-24T00:00:00Z', reason: 'Graph API error: Invalid OAuth access token' },
  ],
  sentiment: {
    sides: ['Merab Dvalishvili', 'Petr Yan'],
    items: [
      { lane: 'reddit', kind: 'comment', text: 'Merab by decision, the cardio is unreal', url: 'https://www.reddit.com/r/MMA/comments/p1/x/c1/', score: 9 },
      { lane: 'reddit', kind: 'post', text: 'Yan takes the rematch, bank on it', url: 'https://www.reddit.com/r/MMA/comments/p1/x/', score: 42 },
    ],
    lean: { method: 'exclusive-name-mention-v1', sides: ['Merab Dvalishvili', 'Petr Yan'], pick_bearing: 3, counts: [2, 1], share_pct: [66.7, 33.3] },
  },
}

describe('formatResearchResult lane manifest (non-silence)', () => {
  it('names every missing forum lane with its reason when sentiment was requested', () => {
    const text = formatResearchResult(sentimentReport, 'https://run')
    expect(text).toContain('Source lanes:')
    expect(text).toContain('- Reddit: ran — 5 item(s)')
    expect(text).toContain('forum layer missing: X — no xAI API key configured')
    expect(text).toContain('forum layer missing: Facebook — Graph API error: Invalid OAuth access token')
    expect(text).not.toContain('forum layer missing: Reddit')
    expect(text).toContain('A SENTIMENT SCAN written from this research must name every missing lane above')
  })
  it('renders the counted lean and the scanned items with their URLs', () => {
    const text = formatResearchResult(sentimentReport, 'https://run')
    expect(text).toContain('Community lean (exclusive-name-mention-v1; 3 pick-bearing of 2 item(s)): Merab Dvalishvili: 2 item(s) (66.7%); Petr Yan: 1 item(s) (33.3%)')
    expect(text).toContain('[reddit] Merab by decision, the cardio is unreal — https://www.reddit.com/r/MMA/comments/p1/x/c1/')
    expect(text).toContain('"crowd lean: <n>%" is the share above of the side you propose')
  })
  it('says nothing is missing when every community lane ran', () => {
    const allRan: ResearchReport = {
      ...sentimentReport,
      lanes: sentimentReport.lanes!.map(l => ({ ...l, status: 'ran' as const, items: 3, reason: '' })),
    }
    const text = formatResearchResult(allRan, 'https://run')
    expect(text).toContain('Source lanes:')
    expect(text).not.toContain('forum layer missing')
    expect(missingForumLanes(allRan)).toEqual([])
  })
  it('keeps the missing lanes named even when the web lane found nothing', () => {
    const text = formatResearchResult({ ...sentimentReport, sources: [] }, 'https://run')
    expect(text).toMatch(/^\[TOOL ERROR\] deep_research found no readable sources/)
    expect(text).toContain('forum layer missing: X')
  })
  it('does not cry missing on a run that never asked for the forum layer', () => {
    expect(missingForumLanes(report)).toEqual([])
    expect(missingForumLanes({ ...sentimentReport, sentiment_requested: false })).toEqual([])
    expect(formatResearchResult(report, 'https://run')).not.toContain('Source lanes:')
  })
  it('lists the lanes that did not run on an ordinary run without flagging them missing', () => {
    const ordinary: ResearchReport = {
      ...report, sentiment_requested: false,
      lanes: [
        { id: 'web', label: 'Web search', status: 'ran', items: 2, as_of: '2026-10-24T00:00:00Z', reason: '' },
        { id: 'reddit', label: 'Reddit', status: 'not_configured', items: 0, as_of: '2026-10-24T00:00:00Z', reason: 'no sentiment subjects were supplied for this run' },
      ],
    }
    const text = formatResearchResult(ordinary, 'https://run')
    expect(text).toContain('- Reddit: NOT CONFIGURED — no sentiment subjects were supplied for this run')
    expect(text).not.toContain('forum layer missing')
  })
})

describe('fighter posts block', () => {
  const posts: ResearchReport['fighter_posts'] = {
    method: 'own-account-search-v1', window_days: 60, as_of: '2026-10-24T00:00:00Z',
    fighters: [
      { name: 'Petr Yan', status: 'ran', handles: { instagram: 'petr_yan' }, stale_set_aside: 1,
        items: [{ platform: 'instagram', handle: 'petr_yan', url: 'https://www.instagram.com/p/DeKZJkACIyx/', text: "That's the job", date: '2026-10-06', date_source: 'snippet' }] },
      { name: 'Merab Dvalishvili', status: 'no_handle', handles: {}, items: [], reason: 'no instagram profile found that reads as Merab Dvalishvili\'s' },
    ],
  }
  const withPosts: ResearchReport = { ...sentimentReport, fighter_posts: posts }

  it('shows each fighter\'s own dated posts with links, and names the fighter with none, with the reason', () => {
    const text = formatResearchResult(withPosts, 'https://run')
    expect(text).toContain('Fighter posts (each fighter\'s OWN public posts, last 60 days')
    expect(text).toContain('- Petr Yan (instagram:@petr_yan): 1 post(s)')
    expect(text).toContain("[instagram 2026-10-06] That's the job — https://www.instagram.com/p/DeKZJkACIyx/")
    expect(text).toContain('- Merab Dvalishvili (no verified handle): unavailable — no instagram profile found')
    expect(text).toContain('Never diagnose a fighter\'s mental state')
  })

  it('is not a forum lane: a missing one never reads as "forum layer missing", and the crowd lean is unchanged', () => {
    const text = formatResearchResult(withPosts, 'https://run')
    expect(text).not.toContain('forum layer missing: Fighter')
    expect(missingForumLanes(withPosts).map(l => l.id)).toEqual(['x', 'facebook'])
    expect(text).toContain('Community lean (exclusive-name-mention-v1; 3 pick-bearing of 2 item(s)): Merab Dvalishvili: 2 item(s) (66.7%); Petr Yan: 1 item(s) (33.3%)')
  })

  it('also rides a run that found no readable web source, and is absent on reports without it', () => {
    expect(formatResearchResult({ ...withPosts, sources: [] }, 'https://run')).toContain('Fighter posts (')
    expect(formatFighterPostsBlock(sentimentReport)).toBe('')
    expect(formatResearchResult(sentimentReport, 'https://run')).not.toContain('Fighter posts')
  })

  it('carries a post\'s note, so TikTok text is never presented as the fighter\'s words', () => {
    const note = 'TikTok index text: it can be auto-generated, so it is not quotable as the fighter\'s words'
    const tiktok: ResearchReport = { ...withPosts, fighter_posts: { ...posts, fighters: [{ ...posts.fighters[0], items: [{ platform: 'tiktok', handle: 'x', url: 'https://www.tiktok.com/@x/video/1', text: 'One week until UFC 333', date: '2026-10-17', note }] }] } }
    expect(formatFighterPostsBlock(tiktok)).toContain(`One week until UFC 333 — https://www.tiktok.com/@x/video/1 (${note})`)
  })

  it('an undated post is shown as undated', () => {
    const undated: ResearchReport = { ...withPosts, fighter_posts: { ...posts, fighters: [{ ...posts.fighters[0], items: [{ platform: 'instagram', handle: 'petr_yan', url: 'https://www.instagram.com/p/U1/', text: 'Caption', date: '', undated: true }] }] } }
    expect(formatFighterPostsBlock(undated)).toContain('[instagram undated] Caption')
  })
})
