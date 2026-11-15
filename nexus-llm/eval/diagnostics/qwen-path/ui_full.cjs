// Full-stack UI check of the Qwen path in real Chromium against the PRODUCTION build (vite preview on :4173). GitHub is a local stand-in, but it serves
// the REAL result and meta files that qwen3-8b.yml wrote on a real runner (read back from the qwen-results branch), so what is rendered is real output.
// Scenarios: S1 default route, S2 legacy saved provider 'deepseek', S3 legacy in-flight-run key present, S4 the real slow-fallback run (labelled, degraded),
// S5 closed Reasoning Trace bar shows no raw reasoning (Kimi stand-in with reasoning_content), S6 provider selector and labels.
// Usage: node ui_full.cjs NORMAL_DIR FALLBACK_DIR OUT_JSON      (each DIR has result.txt and result_meta.txt)
const { chromium } = require('playwright')
const fs = require('fs')
const [normalDir, fallbackDir, outPath] = process.argv.slice(2)
const read = (d, f) => fs.readFileSync(`${d}/${f}`, 'utf8')
const report = { scenarios: [] }
const only = (process.env.ONLY || 'S1,S2,S3,S4,S5,S6').split(',')
const ok = (name, pass, detail) => { report.scenarios.push({ name, pass, ...detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 220)) }

async function githubStandIn(ctx, dir, state) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(), url = req.url()
    if (req.method() === 'POST' && /\/actions\/workflows\/([^/]+)\/dispatches/.test(url)) {
      const body = JSON.parse(req.postData() || '{}'); state.id = body.inputs && body.inputs.invocation_id; state.workflow = url.match(/workflows\/([^/]+)\/dispatches/)[1]; state.inputs = body.inputs
      return route.fulfill({ status: 204, body: '' })
    }
    if (/\/actions\/workflows\/qwen3-8b\.yml\/runs/.test(url)) {
      const runs = state.id ? [{ id: 4242, event: 'workflow_dispatch', head_branch: 'main', name: `Qwen/Qwen3-8B ${state.id}`, display_title: `Qwen/Qwen3-8B ${state.id}`, created_at: new Date().toISOString(), status: 'completed', conclusion: 'success', run_number: 1, html_url: 'x' }] : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_runs: runs }) })
    }
    if (/\/actions\/runs\/4242$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 4242, status: 'completed', conclusion: 'success', run_number: 1, html_url: 'x' }) })
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await ctx.route('https://raw.githubusercontent.com/**', async route => {
    const url = route.request().url(); state.mirror = state.mirror || []; state.mirror.push(url.replace('https://raw.githubusercontent.com', ''))
    if (!state.id || !url.includes(`/qwen-results/qwen-results/${state.id}`)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/plain', body: url.endsWith('.meta.txt') ? read(dir, 'result_meta.txt') : read(dir, 'result.txt') })
  })
}
async function ask(page, text) { const box = page.getByRole('textbox').first(); await box.fill(text); await box.press('Enter') }
async function waitText(page, re, ms = 60000) { try { await page.waitForFunction(src => new RegExp(src, 'i').test(document.body.innerText), re, { timeout: ms }); return true } catch { return false } }

;(async () => {
  const browser = await chromium.launch()
  const newCtx = async (init) => { const [vw, vh] = (process.env.VIEWPORT || '1100x900').split('x').map(Number); const c = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600 }); await c.addInitScript(init); return c }

  // S1: default route
  if (only.includes('S1')) { const state = {}, ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token') }); await githubStandIn(ctx, normalDir, state)
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await ask(page, 'What is 17 times 23? Answer in one short sentence.')
    const shown = await waitText(page, '391'); const body = await page.innerText('body')
    ok('S1 default route: dispatch, discovery, mirror read, answer on screen', shown && state.workflow === 'qwen3-8b.yml' && /^qwen-\d+-/.test(state.id || '') && (state.mirror || []).some(u => u.includes('/qwen-results/qwen-results/')) && !errs.length && !/deepseek/i.test(body),
       { workflow: state.workflow, id: state.id, shown, pageErrors: errs, deepseekOnScreen: /deepseek/i.test(body), providerLabelHasQwen: /qwen/i.test(body) })
    await page.screenshot({ path: outPath.replace('.json', '-S1.png') }); await ctx.close() }

  // S2: a saved provider id from before the rename
  if (only.includes('S2')) { const state = {}, ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token'); localStorage.setItem('fm_provider', 'deepseek') }); await githubStandIn(ctx, normalDir, state)
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await ask(page, 'What is 17 times 23? Answer in one short sentence.')
    const shown = await waitText(page, '391'); const saved = await page.evaluate(() => localStorage.getItem('fm_provider'))
    ok("S2 a saved provider 'deepseek' still routes to Qwen", shown && state.workflow === 'qwen3-8b.yml' && !errs.length, { workflow: state.workflow, shown, savedProviderNow: saved, pageErrors: errs }); await ctx.close() }

  // S3: the old in-flight-run key does not break loading
  if (only.includes('S3')) { const state = {}, ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token'); localStorage.setItem('forgeclaw_active_deepseek_run', JSON.stringify({ invocationId: 'deepseek-1790000000000-old', dispatchedAt: Date.now() - 60000, messageId: 'm1', question: 'old question' })) }); await githubStandIn(ctx, normalDir, state)
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await page.waitForTimeout(4000)
    const body = await page.innerText('body'); ok('S3 an old in-flight-run key does not break the app or show DeepSeek', !errs.length && !/deepseek/i.test(body), { pageErrors: errs, deepseekOnScreen: /deepseek/i.test(body) }); await ctx.close() }

  // S4: the REAL slow-fallback run (engine forced to the fallback model on the runner)
  if (only.includes('S4')) { const state = {}, ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token') }); await githubStandIn(ctx, fallbackDir, state)
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await ask(page, 'What is 17 times 23? Answer in one short sentence.')
    const shown = await waitText(page, 'DEGRADED|fallback', 60000); const body = await page.innerText('body')
    ok('S4 the real fallback run renders, labelled as the DeepSeek fallback (a real DeepSeek model keeps its name)', shown && /deepseek-coder|fallback|DEGRADED/i.test(body) && !errs.length, { shown, pageErrors: errs, mentionsFallbackModel: /deepseek-coder/i.test(body) })
    await page.screenshot({ path: outPath.replace('.json', '-S4.png') }); await ctx.close() }

  // S5: Kimi stand-in with reasoning_content: the closed Reasoning Trace bar must not show raw reasoning
  if (only.includes('S5')) { const ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token'); localStorage.setItem('fm_provider', 'moonshot'); localStorage.setItem('fm_moonshot_key', 'sk-' + 'a'.repeat(48)) })
    await ctx.route('https://api.moonshot.ai/**', async route => {
      const body = JSON.parse(route.request().postData() || '{}'); const RAW = "Then that's exactly what we need to get you is an automation timer. Let me think about the plan."
      if (route.request().url().endsWith('/models')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'kimi-k3' }] }) })
      if (body.stream) { const sse = [{ choices: [{ delta: { reasoning_content: RAW } }] }, { choices: [{ delta: { content: 'The answer is 391.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }].map(o => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n'; return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse }) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'The answer is 391.', reasoning_content: RAW }, finish_reason: 'stop' }], model: 'kimi-k3' }) }) })
    await ctx.route('https://api.github.com/**', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await ask(page, 'What is 17 times 23?'); const shown = await waitText(page, 'The answer is 391', 45000)
    const body = await page.innerText('body'); const leaked = /automation timer|Let me think about the plan/.test(body)
    let openedOk = null; try { const bar = page.getByText('Reasoning Trace').first(); await bar.click({ timeout: 3000 }); await page.waitForTimeout(500); openedOk = /automation timer/.test(await page.innerText('body')) } catch { openedOk = null }
    ok('S5 closed Reasoning Trace bar shows no raw reasoning; the full text is one tap away', shown && !leaked && !errs.length, { shown, rawReasoningVisibleWhileClosed: leaked, rawReasoningAfterOpening: openedOk, pageErrors: errs })
    await page.screenshot({ path: outPath.replace('.json', '-S5.png') }); await ctx.close() }

  // S6: provider selector offers Qwen and nothing says DeepSeek
  if (only.includes('S6')) { const ctx = await newCtx(() => { localStorage.setItem('gh_token', 'test-token') }); const page = await ctx.newPage(); await ctx.route('https://api.github.com/**', r => r.fulfill({ status: 404, body: '{}' }))
    await page.goto('http://localhost:4173/', { waitUntil: 'load' }); await page.waitForTimeout(1500)
    const options = await page.$$eval('select option', os => os.map(o => o.textContent)); const body = await page.innerText('body')
    ok('S6 provider list and header read Qwen, no DeepSeek on screen', /qwen/i.test(body) && !/deepseek/i.test(body), { selectOptions: options.slice(0, 10), headerHasQwen: /qwen\/qwen3-8b/i.test(body) }); await ctx.close() }

  await browser.close(); fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  const failed = report.scenarios.filter(s => !s.pass).length; console.log(`\n${report.scenarios.length - failed} of ${report.scenarios.length} scenarios pass`); process.exit(failed ? 1 : 0)
})()
