// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS } from './forgeTools'
import { requiresCoSign } from './guardianGate'
import { takeGeneratedImage } from './imageArtifact'
import { buildSimDispatchInputs, formatSimResult, reportExcerpt, SIM_MAX_SVG_BYTES, SIM_WORLD_MARKER_RE, svgDataUrl, waitForSimRun, type SimRecord } from './mirofishSim'

afterEach(() => { vi.unstubAllGlobals() })

const ctx = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true } as never
const PACKET = `# Seed\n\n${'Public pre-fight facts about both fighters. '.repeat(10)}`
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><title>MiroFish swarm: Petr Yan vs Merab Dvalishvili</title><text>3 / 1</text></svg>'
const REPORT = '# UFC 333: A Future Predictive Report\n\n> The simulation predicts a third and decisive clash.\n\n## The Trilogy Materializes\n\nThe event crystallizes around a five-round title fight.'

// The shape of the first completed live record (2026-10-25, run 40241533761), trimmed to what the chat reads.
const record = (over: Partial<SimRecord> = {}): SimRecord => ({
  attempt: 2, status: 'completed', reason: '', invocation_id: 'spike2-20261025-2', sides: ['Petr Yan', 'Merab Dvalishvili'], yes_side: 'Petr Yan',
  key: { card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN' },
  config: { agents_prepared: 4, rounds_run: 12, active_rounds_run: 4, simulated_actions: 6 },
  extraction: { n: 4, picks: { A: 3, B: 1 }, median_p_a: 53.5, iqr_p_a: 9.8, unparsed: 0 }, lean_for_yes_side: 53.5,
  baseline_direct: { pick: 'A', p_a: 55, parsed: true }, usage: { cost_usd: 0.298718, calls: 58, ceiling_usd: 0.4, ceiling_hit: false },
  zep: { deleted: true }, nexus: { emitted: false, reason: 'not emitted: the tiny preset does not count toward the 10-sim bar, and intake would count it' },
  artifacts: { run_url: 'https://github.com/o/r/actions/runs/40241533761', world_svg: 'KXUFCFIGHT-26OCT24YANDVA-YAN.2.world.svg', report: 'KXUFCFIGHT-26OCT24YANDVA-YAN.2.report.md' },
  ...over,
})

/** A scripted GitHub: the dispatch, the run list, one run, and the sim-results branch. Records every request. */
function fakeGithub(opts: { status?: string; conclusion?: string; records?: Record<number, SimRecord | null>; ticker?: string; invocation?: string } = {}) {
  const seen: Array<{ url: string; method: string; body?: string }> = []
  let invocation = opts.invocation ?? ''
  const ticker = opts.ticker ?? 'KXUFCFIGHT-26OCT24YANDVA-YAN'
  const records = opts.records ?? { 1: record({ attempt: 1, status: 'failed', invocation_id: 'old' }), 2: null }
  const run = () => ({ id: 77, name: 'MiroFish Sim', display_title: `MiroFish sim ${invocation}`, event: 'workflow_dispatch', head_branch: 'main',
    created_at: new Date().toISOString(), status: opts.status ?? 'completed', conclusion: opts.conclusion ?? 'success', html_url: 'https://github.com/o/r/actions/runs/77', run_number: 9 })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    seen.push({ url: u, method, body: typeof init?.body === 'string' ? init.body : undefined })
    if (u.endsWith('/actions/workflows/mirofish-sim.yml/dispatches')) {
      invocation = JSON.parse(String(init?.body)).inputs.invocation_id
      return new Response(null, { status: 204 })
    }
    if (u.includes('/actions/workflows/mirofish-sim.yml/runs')) return Response.json({ workflow_runs: [run()] })
    if (u.endsWith('/actions/runs/77')) return Response.json(run())
    const content = u.match(/\/contents\/(.+)\?ref=sim-results$/)
    if (content) {
      const path = decodeURIComponent(content[1])
      if (path === 'SPIKE2-UFC333') {
        return Response.json(Object.keys(records).flatMap(n => [`${ticker}.${n}.run-record.json`, `${ticker}.${n}.world.svg`, `${ticker}.${n}.report.md`]).map(name => ({ name, type: 'file' })))
      }
      const rec = path.match(/^SPIKE2-UFC333\/.+\.(\d+)\.run-record\.json$/)
      if (rec) {
        const r = records[Number(rec[1])]
        // null: this attempt is the one the dispatch creates, so it exists only once the dispatch has happened.
        if (r === null && !invocation) return new Response('', { status: 404 })
        const shaped = r === null ? record({ invocation_id: invocation, attempt: Number(rec[1]) }) : r
        return shaped ? new Response(JSON.stringify(shaped)) : new Response('', { status: 404 })
      }
      if (path.endsWith('.world.svg')) return new Response(SVG)
      if (path.endsWith('.report.md')) return new Response(REPORT)
      return new Response('', { status: 404 })
    }
    return new Response('', { status: 404 })
  }))
  return { seen, invocation: () => invocation }
}

const simCall = (input: Record<string, unknown>) => executeTool({ id: '1', name: 'mirofish_sim', input }, ctx)
const baseInput = { card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN', sides: 'Petr Yan|Merab Dvalishvili', packet: PACKET }

describe('mirofish_sim tools are registered', () => {
  it('mirofish_sim needs the key, the sides and a packet, and says where it runs and what it may spend', () => {
    const def = FORGE_TOOLS.find(t => t.name === 'mirofish_sim')!
    expect(def.parameters.required).toEqual(['card_id', 'market_ticker', 'sides', 'packet'])
    expect(def.description).toMatch(/repository's Moonshot \(Kimi K2\) and Zep secrets, never a key from this browser/)
    expect(def.description).toMatch(/hard maximum \$1\.00/)
    expect(def.description).toMatch(/never evidence of the outcome/)
  })

  it('mirofish_sim_result is the read-only viewer', () => {
    const def = FORGE_TOOLS.find(t => t.name === 'mirofish_sim_result')!
    expect(def.parameters.required).toEqual(['card_id', 'market_ticker'])
    expect(def.description).toMatch(/read-only/)
  })
})

describe('the workflow\'s input rules are checked before anything is dispatched', () => {
  it('fills the workflow defaults', () => {
    const inputs = buildSimDispatchInputs(baseInput, 'sim-1')
    expect(inputs).toMatchObject({ invocation_id: 'sim-1', preset: 'tiny', model: 'kimi-k2.6', thinking: 'disabled', ceiling_usd: '0.40', provenance: '{}', yes_side: '' })
  })

  it.each([
    [{ sides: 'Petr Yan' }, /sides must be exactly/],
    [{ sides: 'A|B|C' }, /sides must be exactly/],
    [{ yes_side: 'Someone Else' }, /yes_side must be one of the two sides/],
    [{ ceiling_usd: '1.50' }, /at most 1\.00/],
    [{ ceiling_usd: '0' }, /above 0/],
    [{ preset: 'huge' }, /preset must be tiny, small or mid/],
    [{ packet: 'too short' }, /under 200 characters/],
    [{ card_id: 'has space' }, /card_id must be/],
    [{ provenance: 'not json' }, /provenance must be JSON/],
  ])('refuses %o', (over, message) => {
    expect(() => buildSimDispatchInputs({ ...baseInput, ...over }, 'sim-1')).toThrow(message)
  })

  it('a refused input dispatches nothing', async () => {
    const gh = fakeGithub()
    const out = await simCall({ ...baseInput, ceiling_usd: '5.00' })
    expect(out).toMatch(/TOOL ERROR/)
    expect(out).toMatch(/at most 1\.00/)
    expect(gh.seen).toEqual([])
  })
})

describe('mirofish_sim from the chat, end to end against a scripted GitHub', () => {
  it('dispatches on main with the invocation ID, finds that run, and shows the record and the world', async () => {
    const gh = fakeGithub()
    const out = await simCall({ ...baseInput, yes_side: 'Petr Yan', preset: 'tiny', ceiling_usd: '0.40' })
    const dispatch = gh.seen.find(r => r.method === 'POST')!
    const body = JSON.parse(dispatch.body!)
    expect(body.ref).toBe('main')
    expect(body.inputs).toMatchObject({ card_id: 'SPIKE2-UFC333', sides: 'Petr Yan|Merab Dvalishvili', yes_side: 'Petr Yan', packet: PACKET })
    expect(body.inputs.invocation_id).toMatch(/^sim-\d+-[a-z0-9]+$/)
    expect(out).toContain('attempt 2: completed')
    expect(out).toContain('Final poll: 4 answered · Petr Yan 3 / Merab Dvalishvili 1 · median P(Petr Yan) 53.5')
    expect(out).toContain('Lean for the YES side (Petr Yan): 53.5')
    expect(out).toContain('Cost: $0.2987 upper bound, 58 model calls')
    expect(out).toContain('The simulation predicts a third and decisive clash.')
    // It picked the attempt carrying this run's invocation ID, not the older failed one.
    expect(gh.seen.some(r => r.url.includes('KXUFCFIGHT-26OCT24YANDVA-YAN.2.world.svg'))).toBe(true)
    const marker = out.match(SIM_WORLD_MARKER_RE)
    expect(marker?.[1]).toMatch(/^sim-/)
    const dataUrl = takeGeneratedImage(marker![1])!
    expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8')).toBe(SVG)
    // The model reads the summary only: never the picture.
    expect(out).not.toContain('<svg')
    expect(out).not.toContain('base64')
  })

  it('a run that published no record says so and points at its log', async () => {
    fakeGithub({ conclusion: 'failure', records: { 1: record({ attempt: 1, status: 'failed', invocation_id: 'someone-else' }) } })
    const out = await simCall(baseInput)
    expect(out).toMatch(/finished as "failure" but published no record/)
    expect(out).toContain('github_get_run_logs run_id="77"')
    expect(out).not.toMatch(SIM_WORLD_MARKER_RE)
  })

  it('a run still going at the deadline is handed off, never reported as failed', async () => {
    const gh = fakeGithub({ status: 'in_progress', conclusion: '', invocation: 'sim-x' })
    let clock = 0
    const result = await waitForSimRun(ctx, 'o', 'r', 'sim-x', Date.now(), 60_000, { now: () => clock, sleep: async ms => { clock += ms } })
    expect(gh.seen.filter(r => r.url.endsWith('/actions/runs/77')).length).toBeGreaterThan(1)
    expect(result.finished).toBe(false)
    expect(result.run.status).toBe('in_progress')
  })
})

describe('never a second run by accident', () => {
  it('a sim already running is pointed to, and nothing is dispatched', async () => {
    const gh = fakeGithub({ status: 'in_progress', conclusion: '', invocation: 'sim-123-abc' })
    const out = await simCall(baseInput)
    expect(out).toMatch(/already running \(run #9, in_progress\), so no new one was started/)
    expect(out).toContain('invocation_id "sim-123-abc"')
    expect(gh.seen.some(r => r.method === 'POST')).toBe(false)
  })

  it('a key with a completed sim is not run again, unless the owner named a reason', async () => {
    const gh = fakeGithub({ records: { 1: record({ attempt: 1 }) } })
    const out = await simCall(baseInput)
    expect(out).toMatch(/already has a completed sim \(attempt 1\), so none was started/)
    expect(gh.seen.some(r => r.method === 'POST')).toBe(false)
    await simCall({ ...baseInput, rerun_reason: 'owner: rerun with the new packet' })
    expect(gh.seen.some(r => r.method === 'POST')).toBe(true)
  })

  it('the tool tells the model never to start a sim on its own', () => {
    expect(FORGE_TOOLS.find(t => t.name === 'mirofish_sim')!.description).toMatch(/only when the owner asks for a sim; never on your own initiative/)
  })
})

describe('mirofish_sim_result', () => {
  const resultCall = (input: Record<string, unknown>) => executeTool({ id: '1', name: 'mirofish_sim_result', input }, ctx)

  it('shows the latest attempt by default, with its world', async () => {
    fakeGithub({ records: { 1: record({ attempt: 1, status: 'failed', reason: '[report] 409' }), 2: record() } })
    const out = await resultCall({ card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN' })
    expect(out).toContain('attempt 2: completed')
    expect(takeGeneratedImage(out.match(SIM_WORLD_MARKER_RE)![1])).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('a given attempt is the one shown', async () => {
    fakeGithub({ records: { 1: record({ attempt: 1, status: 'failed', reason: '[report] 409' }), 2: record() } })
    const out = await resultCall({ card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN', attempt: 1 })
    expect(out).toContain('attempt 1: failed ([report] 409)')
  })

  it('a key with no record says so plainly', async () => {
    fakeGithub({ records: {} })
    expect(await resultCall({ card_id: 'SPIKE2-UFC333', market_ticker: 'KXUFCFIGHT-26OCT24YANDVA-YAN' })).toMatch(/No MiroFish sim record found/)
  })
})

describe('the world image', () => {
  it('only a plain, small SVG becomes a picture', () => {
    expect(svgDataUrl(SVG)).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(svgDataUrl('<html><script>alert(1)</script></html>')).toBeNull()
    expect(svgDataUrl(`<svg>${'x'.repeat(SIM_MAX_SVG_BYTES)}</svg>`)).toBeNull()
  })

  it('non-ASCII agent text survives the encoding', () => {
    const svg = '<svg><text>Brasília — São Paulo</text></svg>'
    expect(Buffer.from(svgDataUrl(svg)!.split(',')[1], 'base64').toString('utf8')).toBe(svg)
  })

  it('the report excerpt drops the title and stops at a word', () => {
    const excerpt = reportExcerpt(REPORT, 40)
    expect(excerpt.startsWith('> The simulation')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('a completed record with no world says so instead of a marker', () => {
    const out = formatSimResult({ record: record(), recordPath: 'SPIKE2-UFC333/x.2.run-record.json' }, 'o', 'r')
    expect(out).toMatch(/could not be shown/)
    expect(out).not.toMatch(SIM_WORLD_MARKER_RE)
  })
})

describe('Guardian', () => {
  const call = (name: string) => ({ id: '1', name, input: {} })

  it('a paid sim is co-signed in the stricter postures and runs freely under the autonomous default', () => {
    expect(requiresCoSign(call('mirofish_sim'), 'full-cosign')).toBe(true)
    expect(requiresCoSign(call('mirofish_sim'), 'operator-shell')).toBe(true)
    expect(requiresCoSign(call('mirofish_sim'), 'autonomous')).toBe(false)
  })

  it('the viewer never needs a co-sign', () => {
    expect(requiresCoSign(call('mirofish_sim_result'), 'full-cosign')).toBe(false)
  })
})
