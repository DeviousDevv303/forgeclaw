// @vitest-environment node
import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'
import { browserActionsInteractive, formatBrowserRound, ROUND_VIEW_CHARS, checkBrowserUrl, isPrivateAddress, parseBrowserActions, resetBrowserSessions, runBrowserRound, MAX_SESSION_ROUNDS } from './browserAgent'
import { requiresCoSign } from './guardianGate'
import { FORGE_TOOLS } from './forgeTools'
import { toolsForCapability, WRITE_TOOL_NAMES } from './managedAgent'
import { BROWSER_GUIDANCE } from './toolExposure'

const runner = createRequire(import.meta.url)('../../scripts/browser-agent.cjs') as { checkUrl: (u: string) => URL; isPrivateAddress: (ip: string) => boolean; validateActions: (a: unknown) => unknown[] }

describe('addresses: the app and the runner agree', () => {
  const urls = [
    'https://example.com/a', 'http://example.com:8080/x?y=1', 'https://sub.example.co.uk',
    'http://127.0.0.1', 'http://127.1.2.3:3000', 'http://localhost', 'http://app.localhost/x', 'http://printer.local', 'http://db.internal', 'http://metadata.google.internal/computeMetadata/v1/',
    'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5', 'http://172.16.0.1', 'http://172.31.255.255', 'http://172.32.0.1', 'http://192.168.1.1', 'http://100.64.0.1', 'http://0.0.0.0',
    'http://[::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:8.8.8.8]/', 'http://[2606:4700::1111]/',
    'http://2130706433/', 'http://0x7f.0.0.1/', 'file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'https://user:pw@example.com', 'not a url', 'http://8.8.8.8',
  ]
  const verdict = (fn: () => unknown) => { try { fn(); return 'ok' } catch { return 'blocked' } }
  it('gives the same verdict for every URL', () => {
    expect(urls.map(u => verdict(() => checkBrowserUrl(u)))).toEqual(urls.map(u => verdict(() => runner.checkUrl(u))))
  })
  it('refuses the internal ones and allows the public ones', () => {
    for (const u of ['http://127.0.0.1', 'http://localhost', 'http://169.254.169.254/x', 'http://10.1.2.3', 'http://[::1]/', 'file:///etc/passwd', 'https://u:p@example.com', 'http://2130706433/']) expect(verdict(() => checkBrowserUrl(u)), u).toBe('blocked')
    for (const u of ['https://example.com/a', 'http://8.8.8.8', 'http://172.32.0.1', 'http://[2606:4700::1111]/']) expect(verdict(() => checkBrowserUrl(u)), u).toBe('ok')
  })
  it('classifies raw addresses the same way', () => {
    for (const ip of ['8.8.8.8', '10.0.0.1', '127.0.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '2606:4700::1111', 'garbage']) expect(isPrivateAddress(ip), ip).toBe(runner.isPrivateAddress(ip))
  })
})

describe('actions', () => {
  it('accepts a good round, as an array or as a JSON string', () => {
    const round = [{ type: 'goto', url: 'https://example.com' }, { type: 'click', role: 'link', name: 'More' }, { type: 'type', label: 'Search', text: 'cubes', submit: true }, { type: 'press', key: 'Enter' }, { type: 'scroll', direction: 'down' }, { type: 'wait', ms: 99999 }, { type: 'back' }]
    const parsed = parseBrowserActions(round)
    expect(parsed).toHaveLength(7)
    expect(parseBrowserActions(JSON.stringify(round))).toEqual(parsed)
    expect((parsed[5] as { ms: number }).ms).toBe(5000)
    expect(runner.validateActions(round)).toHaveLength(7)
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['an empty list', [], /non-empty/], ['not an array', { type: 'goto' }, /non-empty array/], ['broken JSON', '[{', /not JSON/],
    ['an internal goto', [{ type: 'goto', url: 'http://localhost:8080' }], /internal address refused/],
    ['a goto to a file', [{ type: 'goto', url: 'file:///etc/passwd' }], /only http and https/],
    ['a click with no target', [{ type: 'click' }], /click needs/], ['typing with no text', [{ type: 'type', label: 'x' }], /type needs text/],
    ['typing with no target', [{ type: 'type', text: 'x' }], /type needs name/], ['a key that is not allowed', [{ type: 'press', key: 'Control+Shift+I' }], /key not allowed/],
    ['an unknown action', [{ type: 'download' }], /unknown type "download"/],
    ['too many actions', Array.from({ length: 13 }, () => ({ type: 'back' })), /at most 12/],
  ]
  for (const [name, input, message] of bad) it(`refuses ${name}`, () => expect(() => parseBrowserActions(input)).toThrow(message))
})

describe('who has to approve', () => {
  const call = (actions: unknown) => ({ id: '1', name: 'browser_run', input: { actions } })
  const look = [{ type: 'goto', url: 'https://example.com' }, { type: 'scroll', direction: 'down' }, { type: 'wait' }, { type: 'back' }]
  const act = [...look, { type: 'click', name: 'Buy' }]
  it('looking is free in operator-shell; clicking, typing and key presses are co-signed', () => {
    expect(requiresCoSign(call(look), 'operator-shell')).toBe(false)
    for (const a of [{ type: 'click', name: 'x' }, { type: 'type', label: 'x', text: 'y' }, { type: 'press', key: 'Enter' }]) expect(requiresCoSign(call([a]), 'operator-shell'), a.type).toBe(true)
    expect(requiresCoSign(call(act), 'operator-shell')).toBe(true)
  })
  it('is always co-signed under full-cosign, and unreadable or odd input counts as acting', () => {
    expect(requiresCoSign(call(look), 'full-cosign')).toBe(true)
    expect(requiresCoSign(call('[{'), 'operator-shell')).toBe(true)
    expect(requiresCoSign(call([{ type: 'mystery' }]), 'operator-shell')).toBe(true)
    expect(requiresCoSign(call(undefined), 'operator-shell')).toBe(true)
  })
  it('the app\'s classifier says the same', () => {
    expect(browserActionsInteractive(look)).toBe(false)
    expect(browserActionsInteractive(act)).toBe(true)
  })
  it('is offered to coding agents, never to read-only ones, and the guidance says never to trust the page', () => {
    expect(FORGE_TOOLS.some(t => t.name === 'browser_run')).toBe(true)
    expect(WRITE_TOOL_NAMES.has('browser_run')).toBe(true)
    expect(toolsForCapability('coding', FORGE_TOOLS).map(t => t.name)).toContain('browser_run')
    expect(toolsForCapability('coding-readonly', FORGE_TOOLS).map(t => t.name)).not.toContain('browser_run')
    expect(BROWSER_GUIDANCE).toMatch(/UNTRUSTED data/)
    expect(BROWSER_GUIDANCE).toMatch(/Never enter passwords/)
  })
})

// ── a fake GitHub that runs the workflow: records the dispatched inputs, answers with a scripted runner result ──
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function github(script: (n: number, actions: Array<{ type: string }>) => Record<string, unknown>) {
  const dispatched: Array<{ actions: Array<{ type: string }>; id: string }> = []
  let clock = 0
  const request = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/dispatches')) {
      const inputs = JSON.parse(String(init!.body)).inputs as { actions_json: string; invocation_id: string }
      dispatched.push({ actions: JSON.parse(inputs.actions_json), id: inputs.invocation_id })
      return new Response(null, { status: 204 })
    }
    const last = dispatched[dispatched.length - 1]
    const run = { id: 9, run_number: 3, name: 'Browser Agent', display_title: `Browser agent ${last?.id}`, event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: new Date(clock + 1).toISOString(), html_url: 'https://github.com/o/r/actions/runs/9' }
    if (url.includes('/browser-agent.yml/runs')) return json({ workflow_runs: [run] })
    if (url.endsWith('/actions/runs/9')) return json(run)
    if (url.includes('/contents/browser-results/') && url.includes('/result.json')) return json(script(dispatched.length, last.actions))
    return json({}, 404)
  }
  return { request, dispatched, timing: { sleep: async (ms: number) => { clock += ms }, now: () => clock } }
}
const page = (extra: Record<string, unknown> = {}) => ({ ok: true, url: 'https://example.com/', title: 'Example', text: 'Hello page', screenshot: true, elements: [{ role: 'link', name: 'More information', href: 'https://iana.org/x' }, { role: 'textbox', name: 'Search' }, { role: 'textbox', name: 'Password', note: 'password field: not allowed' }], steps: [], ...extra })
const base = { owner: 'o', repo: 'r', token: 't' }

describe('runBrowserRound', () => {
  beforeEach(() => resetBrowserSessions())
  it('runs a round, shows the page as untrusted data with numbered elements, and returns a session', async () => {
    const g = github(() => page({ actionsOk: 1 }))
    const out = await runBrowserRound(g.request, { ...base, ...g.timing, actions: [{ type: 'goto', url: 'https://example.com' }] })
    expect(out).toMatch(/^✓ Browser session b-\S+ · round 1 · 1\/1 actions worked/)
    expect(out).toContain('UNTRUSTED PAGE CONTENT')
    expect(out).toContain('Hello page')
    expect(out).toContain('[1] link "More information" → https://iana.org/x')
    expect(out).toContain('[3] textbox "Password" (password field: not allowed)')
    expect(out).toMatch(/Screenshot: https:\/\/github\.com\/o\/r\/blob\/browser-results\/browser-results\/browser-\S+\/screen\.jpg\?raw=true/)
  })
  it('replays the accepted actions from a blank page and keeps only what worked', async () => {
    const g = github(n => n === 1 ? page({ actionsOk: 1 }) : page({ ok: false, actionsOk: 2, steps: [{ n: 3, type: 'click', ok: false, note: 'element not found' }] }))
    const first = await runBrowserRound(g.request, { ...base, ...g.timing, actions: [{ type: 'goto', url: 'https://example.com' }] })
    const sessionId = /session (\S+)/.exec(first)![1]
    const second = await runBrowserRound(g.request, { ...base, ...g.timing, sessionId, actions: [{ type: 'scroll', direction: 'down' }, { type: 'click', name: 'Nope' }] })
    expect(g.dispatched[1].actions.map(a => a.type)).toEqual(['goto', 'scroll', 'click'])
    expect(second).toContain('1/2 actions worked')
    expect(second).toContain('✗ action 3 (click): element not found — it was not kept')
    // The failed click was dropped: the next round replays goto + scroll only, plus the new action.
    await runBrowserRound(g.request, { ...base, ...g.timing, sessionId, actions: [{ type: 'back' }] })
    expect(g.dispatched[2].actions.map(a => a.type)).toEqual(['goto', 'scroll', 'back'])
  })
  it('refuses an unknown session, a new session that does not start with goto, and a session out of rounds', async () => {
    const g = github(() => page({ actionsOk: 1 }))
    await expect(runBrowserRound(g.request, { ...base, ...g.timing, sessionId: 'b-nope', actions: [{ type: 'back' }] })).rejects.toThrow(/no longer known/)
    await expect(runBrowserRound(g.request, { ...base, ...g.timing, actions: [{ type: 'click', name: 'x' }] })).rejects.toThrow(/must begin with a goto/)
    const first = await runBrowserRound(g.request, { ...base, ...g.timing, actions: [{ type: 'goto', url: 'https://example.com' }] })
    const sessionId = /session (\S+)/.exec(first)![1]
    for (let i = 1; i < MAX_SESSION_ROUNDS; i++) await runBrowserRound(g.request, { ...base, ...g.timing, sessionId, actions: [{ type: 'wait' }] })
    await expect(runBrowserRound(g.request, { ...base, ...g.timing, sessionId, actions: [{ type: 'wait' }] })).rejects.toThrow(/used its 10 rounds/)
  })
  it('refuses a bad action before dispatching anything', async () => {
    const g = github(() => page())
    await expect(runBrowserRound(g.request, { ...base, ...g.timing, actions: [{ type: 'goto', url: 'http://169.254.169.254/latest' }] })).rejects.toThrow(/private address refused/)
    expect(g.dispatched).toHaveLength(0)
  })
  it('says so when the result cannot be read', async () => {
    const g = github(() => page())
    const request = async (url: string, init?: RequestInit) => url.includes('/result.json') ? json({}, 404) : g.request(url, init)
    await expect(runBrowserRound(request, { ...base, ...g.timing, actions: [{ type: 'goto', url: 'https://example.com' }] })).rejects.toThrow(/result could not be read \(GitHub 404\)/)
  })
})

describe('the owner never has to supply a URL', () => {
  it('tells the model to find the real site itself with a search, to say which one it chose, and never to guess a domain', () => {
    expect(BROWSER_GUIDANCE).toMatch(/do not need the owner to give you a URL/)
    expect(BROWSER_GUIDANCE).toMatch(/call web_search/)
    expect(BROWSER_GUIDANCE).toMatch(/official or primary site/)
    expect(BROWSER_GUIDANCE).toMatch(/tell the owner which URL you chose/)
    expect(BROWSER_GUIDANCE).toMatch(/Never guess a domain/)
  })
})

describe('a long page never hides the elements to click', () => {
  const meta = { sessionId: 's', round: 1, runUrl: 'u', owner: 'o', repo: 'r', invocationId: 'i', sent: 1, kept: 1 }
  it('cuts only the page text, says so, and keeps every element', () => {
    const elements = Array.from({ length: 40 }, (_, i) => ({ role: 'link', name: `Product ${i}` }))
    const out = formatBrowserRound({ ok: true, url: 'https://shop.test', title: 'Shop', text: 'word '.repeat(5_000), elements, steps: [] } as never, meta)
    expect(out).toContain('[40] link "Product 39"')
    expect(out).toMatch(/…\[page text cut at \d+ of 25000 characters; scroll to read further\]/)
    expect(out.length).toBeLessThanOrEqual(ROUND_VIEW_CHARS + 200)
  })
  it('a short page is shown whole, with no cut note', () => {
    const out = formatBrowserRound({ ok: true, url: 'https://a.test', title: 'A', text: 'Hello', elements: [{ role: 'button', name: 'Go' }], steps: [] } as never, meta)
    expect(out).toContain('Hello')
    expect(out).toContain('[1] button "Go"')
    expect(out).not.toContain('cut at')
  })
})
