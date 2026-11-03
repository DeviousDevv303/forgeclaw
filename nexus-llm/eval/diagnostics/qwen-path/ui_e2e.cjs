// Drives the built app in real Chromium: types a question into the chat, and answers GitHub from a local stand-in that serves the REAL result
// produced by running qwen3-8b.yml's embedded script on the real Qwen3-8B (run_embedded.py). Everything on the app side is the production build;
// only api.github.com and raw.githubusercontent.com are intercepted. Usage: node ui_e2e.js RESULT_DIR SHOT_PNG LOG_JSON
const { chromium } = require('playwright')
const fs = require('fs')
const [resultDir, shot, logPath] = process.argv.slice(2)
const result = fs.readFileSync(`${resultDir}/result.txt`, 'utf8')
const meta = fs.readFileSync(`${resultDir}/result_meta.txt`, 'utf8')
const log = { dispatch: null, runListUrls: [], mirrorUrls: [], otherGithub: [] }
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { localStorage.setItem('gh_token', 'test-token') })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  let invocationId = null
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(); const url = req.url()
    if (req.method() === 'POST' && url.includes('/actions/workflows/qwen3-8b.yml/dispatches')) {
      const body = JSON.parse(req.postData() || '{}'); invocationId = body.inputs && body.inputs.invocation_id
      log.dispatch = { url, ref: body.ref, inputs: Object.fromEntries(Object.entries(body.inputs || {}).map(([k, v]) => [k, String(v).slice(0, 160)])) }
      return route.fulfill({ status: 204, body: '' })
    }
    if (url.includes('/actions/workflows/qwen3-8b.yml/runs')) {
      log.runListUrls.push(url)
      const runs = invocationId ? [{ id: 4242, event: 'workflow_dispatch', head_branch: 'main', name: `Qwen/Qwen3-8B ${invocationId}`, display_title: `Qwen/Qwen3-8B ${invocationId}`, created_at: new Date().toISOString(), status: 'completed', conclusion: 'success', run_number: 1, html_url: 'https://github.com/x/y/actions/runs/4242' }] : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_runs: runs }) })
    }
    if (/\/actions\/runs\/4242$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 4242, status: 'completed', conclusion: 'success', run_number: 1, html_url: 'x' }) })
    log.otherGithub.push(`${req.method()} ${url.replace('https://api.github.com', '')}`)
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await ctx.route('https://raw.githubusercontent.com/**', async route => {
    const url = route.request().url(); log.mirrorUrls.push(`${route.request().method()} ${url.replace('https://raw.githubusercontent.com', '')}`)
    if (!invocationId || !url.includes(`/qwen-results/qwen-results/${invocationId}`)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/plain', body: url.endsWith('.meta.txt') ? meta : result })
  })
  await page.goto('http://localhost:4173/', { waitUntil: 'load' })
  const box = page.getByRole('textbox').first()
  await box.fill('What is 17 times 23? Answer in one short sentence.')
  await box.press('Enter')
  let ok = false
  try { await page.waitForSelector('text=17 times 23 is 391', { timeout: 90000 }); ok = true } catch (e) { /* recorded below */ }
  await page.screenshot({ path: shot })
  log.invocationId = invocationId; log.answerShownInChat = ok; log.pageErrors = errors
  log.visibleProviderLabelHasQwen = (await page.content()).includes('Qwen')
  log.visibleHasDeepSeek = /deepseek/i.test(await page.innerText('body'))
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2))
  console.log(JSON.stringify(log, null, 2))
  await browser.close()
  process.exit(ok ? 0 : 1)
})()
