// Spiderlings end-to-end check: the PRODUCTION build (vite preview on :4173 or BASE_URL) in real Chromium, desktop AND phone.
// GitHub is a local stand-in that serves the REAL result files a runner wrote (nexus-llm/eval/diagnostics/qwen-path), can hold a run
// IN FLIGHT and then release it as success or failure; so the spiders here are driven by the app's real TOOL_START / TOOL_SUCCESS /
// TOOL_FAILURE events from a real chat turn. The demo scenario (?spiders=demo) is scripted and must be flagged DEMO on screen.
// The canvas exposes what it drew per frame (data-spiders-drawn, data-spider-phases); every drawn spider is compared with the ledger.
// Usage: node e2e.cjs OUT_DIR   (VIEWPORTS="1100x900,443x853" by default; ONLY=L1,L2 to run a subset)
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const OUT = process.argv[2] || __dirname
const BASE = process.env.BASE_URL || 'http://localhost:4173/'
const REAL = path.join(__dirname, '../../../nexus-llm/eval/diagnostics/qwen-path')
const resultTxt = fs.readFileSync(path.join(REAL, 'result.txt'), 'utf8'), resultMeta = fs.readFileSync(path.join(REAL, 'result_meta.txt'), 'utf8')
const only = (process.env.ONLY || 'L0,L1,L2,L3,D1,A1,A2,A3,X1').split(',')
const viewports = (process.env.VIEWPORTS || '1100x900,443x853').split(',')
const report = { base: BASE, scenarios: [] }
const ok = (vp, name, pass, detail = {}) => { report.scenarios.push({ viewport: vp, name, pass, ...detail }); console.log(pass ? 'PASS' : 'FAIL', `[${vp}]`, name, JSON.stringify(detail).slice(0, 200)) }

async function standIn(ctx, state) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(), url = req.url()
    if (req.method() === 'POST' && /\/actions\/workflows\/([^/]+)\/dispatches/.test(url)) { state.id = JSON.parse(req.postData() || '{}').inputs.invocation_id; return route.fulfill({ status: 204, body: '' }) }
    const status = () => ({ status: state.hold ? 'in_progress' : 'completed', conclusion: state.hold ? null : state.mode === 'fail' ? 'failure' : 'success' })
    if (/\/actions\/workflows\/qwen3-8b\.yml\/runs/.test(url)) {
      const runs = state.id ? [{ id: 4242, event: 'workflow_dispatch', head_branch: 'main', name: `Qwen/Qwen3-8B ${state.id}`, display_title: `Qwen/Qwen3-8B ${state.id}`, created_at: new Date().toISOString(), run_number: 1, html_url: 'x', ...status() }] : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_runs: runs }) })
    }
    if (/\/actions\/runs\/4242$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 4242, run_number: 1, html_url: 'x', ...status() }) })
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await ctx.route('https://raw.githubusercontent.com/**', async route => {
    const url = route.request().url()
    if (state.hold || state.mode === 'fail' || !state.id || !url.includes(`/qwen-results/qwen-results/${state.id}`)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/plain', body: url.endsWith('.meta.txt') ? resultMeta.replace(/invocation_id=.*/, `invocation_id=${state.id}`) : resultTxt })
  })
}
const num = (page, id) => page.$eval(`[data-testid=${id}]`, e => Number(e.textContent))
const counters = async page => ({ inflight: await num(page, 'spider-inflight'), returned: await num(page, 'spider-returned'), flagged: await num(page, 'spider-flagged'), unknown: await num(page, 'spider-unknown') })
const drawn = page => page.$eval('canvas[aria-hidden=true]', c => ({ n: Number(c.dataset.spidersDrawn || 0), phases: JSON.parse(c.dataset.spiderPhases || '{}'), ambient: Number(c.dataset.ambientDrawn || 0), sig: c.dataset.ambientSig || '' }))
const lines = async page => { if ((await page.getAttribute('[data-testid=spider-toggle]', 'aria-expanded')) !== 'true') await page.click('[data-testid=spider-toggle]'); return page.$$eval('[data-testid=spider-lines] li', ls => ls.map(l => l.textContent)) }
const until = async (page, fn, arg, ms = 60000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 80 }); return true } catch { return false } }
const ask = async (page, text) => { const box = page.getByRole('textbox').first(); await box.fill(text); await box.press('Enter') }
const canvasHas = (phase) => ([p]) => { const c = document.querySelector('canvas[aria-hidden=true]'); return !!c && p in JSON.parse(c.dataset.spiderPhases || '{}') }

;(async () => {
  const browser = await chromium.launch()
  for (const vp of viewports) {
    const [vw, vh] = vp.split('x').map(Number), tag = vw < 600 ? 'phone' : 'desktop'
    const open = async (query, state) => {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600 })
      await ctx.addInitScript(() => { localStorage.setItem('gh_token', 'test-token') }); if (state) await standIn(ctx, state)
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
      await page.goto(BASE + query, { waitUntil: 'load' }); return { ctx, page, errs }
    }
    const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) })

    // L0: without ?rig=1 the app is untouched: no spider panel, no rig canvas
    if (only.includes('L0')) { const { ctx, page, errs } = await open(''); await page.waitForTimeout(1500)
      ok(tag, 'L0 without ?rig=1 there is no spider panel and no rig canvas', (await page.$('[data-testid=spider-panel]')) === null && (await page.$('canvas[aria-hidden=true][data-spiders-drawn]')) === null && !errs.length, { pageErrors: errs }); await ctx.close() }

    // L1: idle live rig: every surface reads idle, nothing drawn, not flagged as demo
    if (only.includes('L1')) { const { ctx, page, errs } = await open('?rig=1'); await page.waitForSelector('[data-testid=spider-panel]'); await page.waitForTimeout(1200)
      const c = await counters(page), d = await drawn(page), l = await lines(page), demo = await page.$('[data-testid=spider-demo-flag]'), src = await page.getAttribute('[data-testid=spider-panel]', 'data-source')
      const note = await page.$eval('[data-testid=spider-ambient]', e => e.textContent).catch(() => null)
      ok(tag, 'L1 idle: counters 0, no event spider drawn, empty ledger, source live, no DEMO flag; ambient life is drawn and labelled not counted', c.inflight + c.returned + c.flagged + c.unknown === 0 && d.n === 0 && d.ambient >= 1 && /not tool events, not counted/.test(note || '') && l.length === 1 && /nothing is out of the throne/.test(l[0]) && demo === null && src === 'live' && !errs.length, { counters: c, drawn: d, lines: l, source: src, ambientNote: note })
      await shot(page, '1-idle'); await ctx.close() }

    // L2: live success through a real chat turn (stand-in GitHub holds the run in flight, then releases it)
    if (only.includes('L2')) { const state = { hold: true, mode: 'ok' }, { ctx, page, errs } = await open('?rig=1', state); await page.waitForSelector('[data-testid=spider-panel]')
      await ask(page, 'What is 17 times 23? Answer in one short sentence.')
      const flying = await until(page, () => Number(document.querySelector('[data-testid=spider-inflight]').textContent) === 1)
      await page.waitForTimeout(4000) // past the 3.6 s stalk out (bursts and freezes): the spider is at its node, working
      const mid = await counters(page), dMid = await drawn(page)
      ok(tag, 'L2 a real tool start puts exactly one spider in flight, drawn at its node, and the ledger line says so', flying && mid.inflight === 1 && dMid.n === 1 && 'working' in dMid.phases && (await lines(page)).some(x => /out of the throne → network · (qwen_reason|ask_qwen)/.test(x)), { counters: mid, drawn: dMid })
      await shot(page, '2-in-flight')
      state.hold = false // the run finishes: TOOL_SUCCESS
      const back = await until(page, canvasHas('back'), ['back'], 90000)
      await page.waitForTimeout(700); await shot(page, '3-returning')
      const docked = await until(page, canvasHas('dock'), ['dock'], 20000); await shot(page, '4-docked')
      const gone = await until(page, () => Number(document.querySelector('canvas[aria-hidden=true]').dataset.spidersDrawn) === 0, [], 20000)
      const end = await counters(page), ls = await lines(page)
      ok(tag, 'L2 on TOOL_SUCCESS the spider climbs back, docks at the chest, and is gone; returned = 1, in flight = 0, traced to two ledger lines', back && docked && gone && end.returned === 1 && end.inflight === 0 && end.flagged === 0 && ls.some(x => /returned from network/.test(x)) && ls.some(x => /out of the throne/.test(x)) && !errs.length, { counters: end, lines: ls, pageErrors: errs })
      await ctx.close() }

    // L3: live failure: the spider comes back flagged, red
    if (only.includes('L3')) { const state = { hold: true, mode: 'fail' }, { ctx, page, errs } = await open('?rig=1', state); await page.waitForSelector('[data-testid=spider-panel]')
      await ask(page, 'What is 17 times 23? Answer in one short sentence.')
      await until(page, () => Number(document.querySelector('[data-testid=spider-inflight]').textContent) === 1); await page.waitForTimeout(4000)
      state.hold = false
      const flagged = await until(page, () => Number(document.querySelector('[data-testid=spider-flagged]').textContent) === 1, [], 120000)
      const back = await until(page, canvasHas('back'), ['back'], 10000).then(r => r || until(page, canvasHas('dock'), ['dock'], 10000)); await page.waitForTimeout(500); await shot(page, '5-flagged')
      await until(page, () => Number(document.querySelector('canvas[aria-hidden=true]').dataset.spidersDrawn) === 0, [], 20000)
      const end = await counters(page), ls = await lines(page)
      ok(tag, 'L3 on TOOL_FAILURE the spider returns flagged: flagged = 1, returned = 0, in flight = 0, and the line names the failure', flagged && end.flagged === 1 && end.returned === 0 && end.inflight === 0 && ls.some(x => /flagged at network/.test(x)), { counters: end, lines: ls, sawReturn: back, pageErrors: errs })
      await ctx.close() }

    // D1: the scripted demo: flagged DEMO on screen, cannot be mistaken for live; shows all three channels, a flagged return and an UNKNOWN (stale) spider
    if (only.includes('D1')) { const { ctx, page, errs } = await open('?rig=1&spiders=demo'); await page.waitForSelector('[data-testid=spider-demo-flag]')
      const flag = await page.innerText('[data-testid=spider-demo-flag]'), src = await page.getAttribute('[data-testid=spider-panel]', 'data-source')
      ok(tag, 'D1 the demo says DEMO · simulated events · not live on the panel and carries data-source=demo', /DEMO · simulated events · not live/.test(flag) && src === 'demo', { flag, source: src })
      await until(page, () => Number(document.querySelector('[data-testid=spider-inflight]').textContent) === 3, [], 15000); await page.waitForTimeout(4000)
      const three = await counters(page), dd = await drawn(page); await shot(page, '6-demo-three-channels')
      ok(tag, 'D1 three spiders out at once (browser, sandbox, network) plus one UNKNOWN past its timeout; the canvas draws all four', three.inflight === 3 && three.unknown === 1 && dd.n === 4 && dd.phases.unknown === 1, { counters: three, drawn: dd })
      await until(page, () => Number(document.querySelector('[data-testid=spider-flagged]').textContent) === 1, [], 30000); await page.waitForTimeout(600); await shot(page, '7-demo-flagged-return')
      await until(page, () => Number(document.querySelector('[data-testid=spider-returned]').textContent) === 2, [], 30000)
      await until(page, () => { const c = document.querySelector('canvas[aria-hidden=true]'); return Number(c.dataset.spidersDrawn) === 1 }, [], 20000)
      const fin = await counters(page), ls = await lines(page); await shot(page, '8-demo-final')
      ok(tag, 'D1 end state: returned 2, flagged 1, unknown 1, in flight 0; only the UNKNOWN spider is left; the ledger lists 4 out lines, the returns, and the unknown line (all traceable)', fin.returned === 2 && fin.flagged === 1 && fin.unknown === 1 && fin.inflight === 0 && ls.filter(x => /out of the throne/.test(x)).length === 4 && ls.filter(x => /returned from|flagged at/.test(x)).length === 3 && ls.some(x => /unknown at sandbox · shell_patch · no end event since/.test(x)) && !errs.length, { counters: fin, lines: ls, pageErrors: errs })
      await ctx.close() }
    // A1: ambient is seeded: a named (seed, frozen time) gives the same scene on every load; another seed gives another; counters never move
    if (only.includes('A1')) {
      const frames = [[11, 2500], [11, 11000], [11, 19500], [12, 11000]], sigs = {}
      let countersStill = true, eventSpiders = 0
      for (const [seed, t] of frames) {
        const runs = []
        for (let k = 0; k < 2; k++) { const { ctx, page } = await open(`?rig=1&spiderSeed=${seed}&spiderFreeze=${t}`); await page.waitForSelector('[data-testid=spider-panel]'); await page.waitForTimeout(700)
          const d = await drawn(page), c = await counters(page); runs.push(d.sig); eventSpiders += d.n; if (c.inflight + c.returned + c.flagged + c.unknown) countersStill = false
          if (k === 0) await shot(page, `9-ambient-seed${seed}-t${t}`); await ctx.close() }
        sigs[`${seed}@${t}`] = runs
      }
      const same = Object.values(sigs).every(([a, b]) => a && a === b)
      ok(tag, 'A1 ambient is reproducible: each named seed+time gives the same scene on two loads; seed 12 differs from seed 11 at the same time; no event spider and no counter moves', same && sigs['11@11000'][0] !== sigs['12@11000'][0] && countersStill && eventSpiders === 0, { signatures: Object.fromEntries(Object.entries(sigs).map(([k, v]) => [k, v[0]])) })
    }
    // A2: prefers-reduced-motion turns ambient off (event spiders are information, they stay)
    if (only.includes('A2')) { const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600, reducedMotion: 'reduce' })
      const page = await ctx.newPage(); await page.goto(BASE + '?rig=1', { waitUntil: 'load' }); await page.waitForSelector('[data-testid=spider-panel]'); await page.waitForTimeout(800)
      const d = await drawn(page), note = await page.$('[data-testid=spider-ambient]')
      ok(tag, 'A2 prefers-reduced-motion: no ambient spiders and no ambient note', d.ambient === 0 && note === null, { drawn: d }); await ctx.close() }
    // A3: ?ambient=0 switches ambient off
    if (only.includes('A3')) { const { ctx, page } = await open('?rig=1&ambient=0'); await page.waitForSelector('[data-testid=spider-panel]'); await page.waitForTimeout(800)
      const d = await drawn(page); ok(tag, 'A3 ?ambient=0: no ambient spiders', d.ambient === 0, { drawn: d }); await ctx.close() }
    // X1: the look, close up (3x), after the owner's reference (Phidippus carneus): seed 11 at 2.5 s, a hopper mid-jump and the wall spider
    if (only.includes('X1') && tag === 'desktop') {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 3 }); await ctx.addInitScript(() => { localStorage.setItem('gh_token', 'test-token') })
      const page = await ctx.newPage(); await page.goto(BASE + '?rig=1&spiderSeed=11&spiderFreeze=2500', { waitUntil: 'load' }); await page.waitForSelector('[data-testid=spider-panel]'); await page.waitForTimeout(800)
      const k = Math.max(vw / 1536, vh / 1024), ox = (vw - 1536 * k) / 2, oy = (vh - 1024 * k) / 2, sig = (await drawn(page)).sig
      const at = id => { const m = sig.match(new RegExp(`${id}:[a-z]+@(\\d+),(\\d+)\\^(\\d+)`)); return m ? { x: ox + Number(m[1]) * k, y: oy + (Number(m[2]) - Number(m[3])) * k } : null }
      for (const [id, name] of [['hopper-2', '10-anatomy-hopper'], ['climber', '11-anatomy-wall'], ['hopper-1', '12-anatomy-face']]) { const p = at(id); if (p) await page.screenshot({ path: path.join(OUT, `${name}-desktop.png`), clip: { x: Math.max(0, p.x - 70), y: Math.max(0, p.y - (id === 'hopper-1' ? 80 : 60)), width: 140, height: 120 } }) }
      ok(tag, 'X1 close-ups captured at seed 11, t 2.5 s (3x): a hopper mid-jump (from above), the wall spider, and a resting spider facing the viewer', !!at('hopper-2') && !!at('climber') && /hopper-1:idle/.test(sig), { sig }); await ctx.close()
    }
  }
  await browser.close(); fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(report, null, 2))
  const failed = report.scenarios.filter(s => !s.pass).length; console.log(`\n${report.scenarios.length - failed} of ${report.scenarios.length} checks pass`); process.exit(failed ? 1 : 0)
})()
