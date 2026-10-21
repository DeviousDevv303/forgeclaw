// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browserPlaybook, browserPlaybooksForPrompt, BROWSER_PLAYBOOK_SOURCE, describeAction, recordBrowserLearning } from './browserLearning'
import { resetBrowserSessions, runBrowserRound, type BrowserAction } from './browserAgent'
import { nexusGuidanceForDeepSeek } from './nexusGuidance'
import { failurePattern, summarizeLearning } from './nexusLearning'
import { corpusRepository, type CorpusRecord } from './corpus'

beforeEach(() => { localStorage.clear(); resetBrowserSessions() })
afterEach(() => localStorage.clear())

const steps: BrowserAction[] = [
  { type: 'goto', url: 'https://www.example.com/shop' },
  { type: 'type', label: 'Search', text: 'my home address 12 Elm St', submit: true },
  { type: 'click', role: 'link', name: 'First result' },
]
const ok = { goal: 'find the first search result', accepted: steps, finalUrl: 'https://www.example.com/item/1', title: 'Item one', ok: true }

describe('what NEXUS keeps from a browse', () => {
  it('describes actions without the typed text', () => {
    expect(describeAction(steps[1])).toBe('type into "Search" (text not stored) then submit')
    expect(describeAction(steps[2])).toBe('click link "First result"')
    expect(browserPlaybook(ok)).not.toContain('Elm St')
  })
  it('writes a playbook of what worked: the site, the goal, the ordered steps', () => {
    const text = browserPlaybook(ok)
    expect(text).toContain('Browser playbook for example.com — goal: find the first search result')
    expect(text).toContain('1. goto www.example.com/shop')
    expect(text).toContain('3. click link "First result"')
  })
  it('keeps nothing for a bare page load, and names the failed step first when a browse failed', () => {
    expect(browserPlaybook({ ...ok, accepted: [steps[0]] })).toBe('')
    const failed = browserPlaybook({ ...ok, ok: false, accepted: steps.slice(0, 2), failedStep: { type: 'click', note: 'element not found' } })
    expect(failed.split('\n')[0]).toBe('Browser example.com: click failed (element not found)')
    expect(failed).toContain('Goal: find the first search result')
  })
  it('counts the same failure on the same site as one recurring lesson, whatever the goal', () => {
    const a = failurePattern(browserPlaybook({ ...ok, ok: false, goal: 'buy a thing', failedStep: { type: 'click', note: 'element not found' } }))
    const b = failurePattern(browserPlaybook({ ...ok, ok: false, goal: 'compare prices', failedStep: { type: 'click', note: 'element not found' } }))
    expect(a).toBe(b)
  })
  it('a playbook that worked converges into knowledge by itself (Extension); a failed one stays a candidate', async () => {
    expect(await recordBrowserLearning(ok, { runtime: 'browser-agent', model: 'chromium' })).toBe(true)
    const candidates = corpusRepository.listCandidates(10)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].admissionStatus).toBe('approved')
    expect(candidates[0].content).toContain('Browser playbook for example.com')
    expect(JSON.stringify(candidates[0])).not.toContain('Elm St')
    const known = corpusRepository.retrieve('example.com first search result', 5)
    expect(known).toHaveLength(1)
    expect(known[0].metadata).toMatchObject({ admittedBy: 'nexus-convergence', phase: 'extension' })
    expect(corpusRepository.checkNexusKnowledge('example.com first search result')).toBeNull() // never served verbatim
    const failed = await recordBrowserLearning({ ...ok, ok: false, failedStep: { type: 'click', note: 'element not found' } }, { runtime: 'browser-agent', model: 'chromium' })
    expect(failed).toBe(true)
    expect(summarizeLearning(corpusRepository.listCandidates(10)).byOutcome.failed).toBe(1)
  })
})

describe('what it teaches', () => {
  const approved = (content: string, source = BROWSER_PLAYBOOK_SOURCE): CorpusRecord => ({ id: 'r', corpusId: 'c', source, content, timestamp: '2026-01-01T00:00:00Z', version: 1, recordType: 'interaction' as never, integrity: 'i', admissionStatus: 'approved', metadata: {} })
  const playbook = browserPlaybook(ok)
  it('the browsing agent gets approved playbooks that match its request, and only playbooks', () => {
    const text = browserPlaybooksForPrompt('open example.com and find the first search result', () => [approved(playbook), approved('some other knowledge about example.com', 'corpus')])
    expect(text).toContain('NEXUS BROWSING PLAYBOOKS')
    expect(text).toContain('1. goto www.example.com/shop')
    expect(text).not.toContain('some other knowledge')
    expect(browserPlaybooksForPrompt('anything', () => [])).toBe('')
  })
  it('DeepSeek is taught the same approved playbook when its task is about that site', () => {
    const g = nexusGuidanceForDeepSeek('how do I find the first search result on example.com', { decisions: { approved: [], rejected: [] }, candidates: [], retrieve: () => [approved(playbook)] })
    expect(g.records).toBe(1)
    expect(g.text).toContain('Browser playbook for example.com')
    expect(g.text).toContain('click link "First result"')
  })
})

describe('the round feeds NEXUS', () => {
  it('reports the accepted actions, the final page and the failed step once a round has finished', async () => {
    let clock = 0
    const dispatched: string[] = []
    const request = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dispatches')) { dispatched.push(JSON.parse(String(init!.body)).inputs.invocation_id); return new Response(null, { status: 204 }) }
      const run = { id: 9, run_number: 3, name: 'Browser Agent', display_title: `Browser agent ${dispatched[0]}`, event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: new Date(clock + 1).toISOString(), html_url: 'https://github.com/o/r/actions/runs/9' }
      if (url.includes('/browser-agent.yml/runs')) return Response.json({ workflow_runs: [run] })
      if (url.endsWith('/actions/runs/9')) return Response.json(run)
      if (url.includes('/result.json')) return Response.json({ ok: false, url: 'https://example.com/', title: 'Example', text: '', elements: [], steps: [{ n: 2, type: 'click', ok: false, note: 'element not found' }], actionsOk: 1 })
      return Response.json({}, { status: 404 })
    }
    const seen: unknown[] = []
    await runBrowserRound(request, { owner: 'o', repo: 'r', token: 't', goal: 'find pricing', actions: [{ type: 'goto', url: 'https://example.com' }, { type: 'click', name: 'Pricing' }], sleep: async ms => { clock += ms }, now: () => clock, onRound: f => { seen.push(f) } })
    expect(seen).toEqual([{ goal: 'find pricing', accepted: [{ type: 'goto', url: 'https://example.com' }], finalUrl: 'https://example.com/', title: 'Example', ok: false, failedStep: { n: 2, type: 'click', ok: false, note: 'element not found' } }])
  })
  it('a learning failure never fails the browse', async () => {
    let clock = 0
    const id: string[] = []
    const request = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dispatches')) { id.push(JSON.parse(String(init!.body)).inputs.invocation_id); return new Response(null, { status: 204 }) }
      const run = { id: 9, run_number: 3, name: 'Browser Agent', display_title: `Browser agent ${id[0]}`, event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: new Date(clock + 1).toISOString(), html_url: 'u' }
      if (url.includes('/browser-agent.yml/runs')) return Response.json({ workflow_runs: [run] })
      if (url.endsWith('/actions/runs/9')) return Response.json(run)
      if (url.includes('/result.json')) return Response.json({ ok: true, url: 'https://example.com/', title: 'Example', text: 'hi', elements: [], steps: [], actionsOk: 1 })
      return Response.json({}, { status: 404 })
    }
    const out = await runBrowserRound(request, { owner: 'o', repo: 'r', token: 't', actions: [{ type: 'goto', url: 'https://example.com' }], sleep: async ms => { clock += ms }, now: () => clock, onRound: () => { throw new Error('storage full') } })
    expect(out).toContain('✓ Browser session')
  })
})

describe('the browser_run tool teaches NEXUS', () => {
  it('records a playbook from a real tool call, with the goal the model gave, and it converges', async () => {
    const { vi, expect: ex } = await import('vitest')
    const { executeTool } = await import('./forgeTools')
    const ids: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/dispatches')) { ids.push(JSON.parse(String(init!.body)).inputs.invocation_id); return new Response(null, { status: 204 }) }
      const run = { id: 9, run_number: 3, name: 'Browser Agent', display_title: `Browser agent ${ids[0]}`, event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: new Date(Date.now() + 1000).toISOString(), html_url: 'https://github.com/o/r/actions/runs/9' }
      if (u.includes('/browser-agent.yml/runs')) return Response.json({ workflow_runs: [run] })
      if (u.endsWith('/actions/runs/9')) return Response.json(run)
      if (u.includes('/result.json')) return Response.json({ ok: true, url: 'https://example.com/pricing', title: 'Pricing', text: 'Plans', elements: [], steps: [], actionsOk: 2 })
      return Response.json({}, { status: 404 })
    }))
    try {
      const out = await executeTool({ id: '1', name: 'browser_run', input: { goal: 'find the pricing page', actions: [{ type: 'goto', url: 'https://example.com' }, { type: 'click', role: 'link', name: 'Pricing' }] } },
        { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never)
      ex(out).toContain('✓ Browser session')
      await vi.waitFor(() => ex(corpusRepository.listCandidates(10).some(c => c.source === BROWSER_PLAYBOOK_SOURCE && c.content.includes('goal: find the pricing page'))).toBe(true))
      ex(corpusRepository.listCandidates(10).find(c => c.source === BROWSER_PLAYBOOK_SOURCE)?.admissionStatus).toBe('approved')
    } finally { vi.unstubAllGlobals() }
  }, 60_000)
})
