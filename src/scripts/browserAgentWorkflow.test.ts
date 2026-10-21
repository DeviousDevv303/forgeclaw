// @vitest-environment node
// The cloud browser runs untrusted websites. These tests pin the properties that keep that safe: the job that runs the
// browser is read-only and holds no credential, the job that can write runs no browser, the runner refuses internal
// addresses (also for sub-requests), password fields and downloads, and the mirror publishes only bounded files.
// The runner is exercised for real in Chromium against a local page when a browser is installed.
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')
const wf = read('.github/workflows/browser-agent.yml')
const run = promisify(execFile)

describe('browser-agent.yml', () => {
  const browse = wf.slice(wf.indexOf('\n  browse:\n'), wf.indexOf('\n  mirror:\n'))
  const mirror = wf.slice(wf.indexOf('\n  mirror:\n'))
  it('runs the browser in a read-only job that keeps no credential, and passes the actions through env', () => {
    expect(wf).toMatch(/permissions:\n {2}contents: read/)
    expect(browse).not.toContain('contents: write')
    expect(browse).toContain('persist-credentials: false')
    expect(browse).toContain('ACTIONS_JSON: ${{ inputs.actions_json }}')
    expect(browse).not.toMatch(/GH_TOKEN|github\.token|secrets\./)
    expect(wf).toContain('runs-on: ubuntu-24.04')
  })
  it('pins Playwright exactly and caches Chromium', () => {
    expect(browse).toMatch(/npm install --no-audit --no-fund playwright@\d+\.\d+\.\d+\b/)
    expect(browse).toContain('uses: actions/cache@v4')
  })
  it('publishes from a separate job that writes but runs no browser and no page content', () => {
    expect(mirror).toMatch(/permissions:\n {6}contents: write/)
    for (const forbidden of ['playwright', 'browser-agent.cjs', 'setup-node', 'npm ']) expect(mirror).not.toContain(forbidden)
    expect(mirror).toContain('bash .github/scripts/browser_mirror.sh')
    expect(mirror.indexOf('actions/checkout')).toBeLessThan(mirror.indexOf('actions/download-artifact'))
  })
  it('never sets the runner\'s test-only switches', () => {
    expect(wf).not.toContain('BROWSER_AGENT_TEST')
    expect(wf).not.toContain('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
  })
})

describe('browser_mirror.sh', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'bm-'))
    const bare = join(dir, 'remote.git')
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    const result = join(dir, 'result'); mkdirSync(result)
    const mirror = (id: string, outcome = 'success') => spawnSync('bash', ['.github/scripts/browser_mirror.sh', `file://${bare}`, id, result, outcome], { encoding: 'utf8' })
    const show = (id: string, file: string) => spawnSync('git', ['--git-dir', bare, 'show', `browser-results:browser-results/${id}/${file}`], { encoding: 'utf8' })
    const exists = (id: string, file: string) => spawnSync('git', ['--git-dir', bare, 'cat-file', '-e', `browser-results:browser-results/${id}/${file}`]).status === 0
    return { dir, result, mirror, show, exists }
  }
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)])
  it('publishes the result and the screenshot under the invocation id', () => {
    const w = setup()
    try {
      writeFileSync(join(w.result, 'result.json'), JSON.stringify({ ok: true, url: 'https://example.com/' }))
      writeFileSync(join(w.result, 'screen.jpg'), JPEG)
      const r = w.mirror('browser-1')
      expect(r.status, r.stderr).toBe(0)
      expect(JSON.parse(w.show('browser-1', 'result.json').stdout).url).toBe('https://example.com/')
      expect(w.exists('browser-1', 'screen.jpg')).toBe(true)
    } finally { rmSync(w.dir, { recursive: true, force: true }) }
  })
  it('publishes a failure line when the browse job produced nothing, so the app stops waiting', () => {
    const w = setup()
    try {
      expect(w.mirror('browser-2', 'failure').status).toBe(0)
      const published = JSON.parse(w.show('browser-2', 'result.json').stdout)
      expect(published.ok).toBe(false)
      expect(published.error).toContain('failure')
      expect(w.exists('browser-2', 'screen.jpg')).toBe(false)
    } finally { rmSync(w.dir, { recursive: true, force: true }) }
  })
  it('does not publish invalid JSON, an oversize or non-JPEG screenshot, or a bad id', () => {
    const w = setup()
    try {
      writeFileSync(join(w.result, 'result.json'), '{not json')
      writeFileSync(join(w.result, 'screen.jpg'), Buffer.from('<html>not an image</html>'))
      expect(w.mirror('browser-3').status).toBe(0)
      expect(JSON.parse(w.show('browser-3', 'result.json').stdout).ok).toBe(false)
      expect(w.exists('browser-3', 'screen.jpg')).toBe(false)
      writeFileSync(join(w.result, 'screen.jpg'), Buffer.concat([JPEG, Buffer.alloc(700_000, 2)]))
      expect(w.mirror('browser-4').status).toBe(0)
      expect(w.exists('browser-4', 'screen.jpg')).toBe(false)
      expect(w.mirror('../escape').status).not.toBe(0)
    } finally { rmSync(w.dir, { recursive: true, force: true }) }
  })
})

// ── the runner, for real ──────────────────────────────────────────────────────────────────────
const CHROMIUM = '/opt/pw-browsers/chromium'
const PW_PATH = '/opt/node-tools/node_modules'
const haveBrowser = existsSync(CHROMIUM) && existsSync(PW_PATH)

interface RunnerOut { ok: boolean; url: string; title: string; text: string; screenshot?: boolean; actionsOk: number; error?: string; elements: Array<{ role: string; name: string; note?: string }>; steps: Array<{ n: number; type: string; ok: boolean; note?: string }> }

describe.skipIf(!haveBrowser)('browser-agent.cjs in a real Chromium', () => {
  const PAGE1 = (port: number) => `<!doctype html><title>Home</title><h1>Welcome</h1>
    <a href="/next">Go to next page</a> <button onclick="document.getElementById('o').textContent='clicked!'">Press me</button><p id="o">idle</p>
    <label>Search <input name="q" placeholder="query"></label> <label>Secret <input type="password" name="pw"></label>
    <script>fetch('http://127.0.0.1:${port}/secret').then(r => r.text()).then(t => { document.title = 'leak:' + t }).catch(() => { document.title = 'blocked' })</script>`
  async function withSite<T>(fn: (port: number, go: (actions: unknown[]) => Promise<RunnerOut>) => Promise<T>): Promise<T> {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      // CORS is open on purpose: without the runner's own blocking, the page WOULD read this.
      if (req.url === '/secret') { res.setHeader('access-control-allow-origin', '*'); res.end('TOP-SECRET') }
      else if (req.url === '/next') res.end('<title>Next</title><h1>Second page</h1>')
      else res.end(PAGE1((server.address() as AddressInfo).port))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const go = async (actions: unknown[]) => {
      const cwd = mkdtempSync(join(tmpdir(), 'ba-'))
      try {
        await run('node', [join(process.cwd(), 'scripts/browser-agent.cjs')], {
          cwd, timeout: 90_000,
          env: { ...process.env, NODE_PATH: PW_PATH, PLAYWRIGHT_CHROMIUM_EXECUTABLE: CHROMIUM, ACTIONS_JSON: JSON.stringify(actions),
            BROWSER_AGENT_TEST_LOOKUP: '1', BROWSER_AGENT_TEST_ARGS: JSON.stringify(['--host-resolver-rules=MAP site.test 127.0.0.1']) },
        }).catch(() => undefined) // a failed round exits 1 on purpose; the result file is what matters
        return JSON.parse(readFileSync(join(cwd, 'agent-out/result.json'), 'utf8')) as RunnerOut
      } finally { rmSync(cwd, { recursive: true, force: true }) }
    }
    try { return await fn(port, go) } finally { server.close() }
  }
  const home = (port: number) => ({ type: 'goto', url: `http://site.test:${port}/` })

  it('browses, clicks, follows a link and types, and reports the page', async () => {
    await withSite(async (port, go) => {
      const r = await go([home(port), { type: 'click', role: 'button', name: 'Press me' }, { type: 'type', label: 'Search', text: 'cubes' }])
      expect(r.ok, JSON.stringify(r.steps)).toBe(true)
      expect(r.text).toContain('clicked!')
      expect(r.elements.map(e => e.name)).toEqual(expect.arrayContaining(['Go to next page', 'Press me']))
      expect(r.screenshot).toBe(true)
      const second = await go([home(port), { type: 'click', role: 'link', name: 'Go to next page' }])
      expect(second.ok).toBe(true)
      expect(second.title).toBe('Next')
      expect(second.text).toContain('Second page')
    })
  }, 120_000)
  it('refuses to type into a password field, and says which action failed', async () => {
    await withSite(async (port, go) => {
      const r = await go([home(port), { type: 'type', label: 'Secret', text: 'hunter2' }, { type: 'click', name: 'Press me' }])
      expect(r.ok).toBe(false)
      expect(r.actionsOk).toBe(1)
      expect(r.steps[1]).toMatchObject({ n: 2, type: 'type', ok: false })
      expect(r.steps[1].note).toMatch(/password field/)
      expect(r.elements.some(e => e.note === 'password field: not allowed')).toBe(true)
    })
  }, 120_000)
  it('refuses private addresses, and blocks a page that reaches for an internal address', async () => {
    await withSite(async (port, go) => {
      const direct = await go([{ type: 'goto', url: `http://127.0.0.1:${port}/secret` }])
      expect(direct.ok).toBe(false)
      expect(JSON.stringify(direct)).not.toContain('TOP-SECRET')
      const viaPage = await go([home(port), { type: 'wait', ms: 1500 }])
      expect(viaPage.ok).toBe(true)
      expect(viaPage.title).toBe('blocked')
      expect(JSON.stringify(viaPage)).not.toContain('TOP-SECRET')
    })
  }, 120_000)
  it('writes a result with the reason when the actions are invalid', async () => {
    await withSite(async (_port, go) => {
      const r = await go([{ type: 'goto', url: 'file:///etc/passwd' }])
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/only http and https/)
    })
  }, 60_000)
})
