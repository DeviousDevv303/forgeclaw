// How long after the workflow publishes its result does the chat UI show the answer? Drives the production build in Chromium against a GitHub stand-in
// whose run "finishes" PUBLISH_S seconds after the dispatch. The model and the runner are not involved; this isolates the app's own waiting (its polling).
// Usage: node ui_latency.cjs LABEL PUBLISH_S[,PUBLISH_S...] OUT_JSON
const { chromium } = require('playwright')
const fs = require('fs')
const [label, offsets, outPath] = process.argv.slice(2)
const ANSWER = '17 times 23 is 391.'
async function trial(browser, publishS) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  await ctx.addInitScript(() => { localStorage.setItem('gh_token', 'test-token') })
  const page = await ctx.newPage()
  let id = null, dispatchAt = 0, polls = { api: 0, mirror: 0 }
  const published = () => dispatchAt && Date.now() >= dispatchAt + publishS * 1000
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(); const url = req.url()
    if (req.method() === 'POST' && url.includes('/qwen3-8b.yml/dispatches')) { id = JSON.parse(req.postData() || '{}').inputs.invocation_id; dispatchAt = Date.now(); return route.fulfill({ status: 204, body: '' }) }
    if (url.includes('/qwen3-8b.yml/runs')) { polls.api++; const runs = id ? [{ id: 4242, event: 'workflow_dispatch', head_branch: 'main', name: `Qwen/Qwen3-8B ${id}`, display_title: `Qwen/Qwen3-8B ${id}`, created_at: new Date().toISOString(), status: published() ? 'completed' : 'in_progress', conclusion: published() ? 'success' : null, run_number: 1, html_url: 'x' }] : []; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_runs: runs }) }) }
    if (/\/actions\/runs\/4242$/.test(url)) { polls.api++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 4242, status: published() ? 'completed' : 'in_progress', conclusion: published() ? 'success' : null, run_number: 1, html_url: 'x' }) }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await ctx.route('https://raw.githubusercontent.com/**', async route => {
    const url = route.request().url(); polls.mirror++
    if (!published() || !id || !url.includes(id)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/plain', body: url.endsWith('.meta.txt') ? `invocation_id=${id}\nmodel=Qwen/Qwen3-8B\n` : ANSWER })
  })
  await page.goto('http://localhost:4173/', { waitUntil: 'load' })
  const box = page.getByRole('textbox').first()
  await box.fill('What is 17 times 23? Answer in one short sentence.'); await box.press('Enter')
  const deadline = Date.now() + (publishS + 150) * 1000
  let visibleAt = 0
  while (Date.now() < deadline) {
    if (dispatchAt && await page.getByText('17 times 23 is 391', { exact: false }).count().then(n => n > 0 && Date.now() >= dispatchAt + publishS * 1000)) { visibleAt = Date.now(); break }
    await new Promise(r => setTimeout(r, 200))
  }
  await ctx.close()
  const publishAt = dispatchAt + publishS * 1000
  return { publish_s: publishS, shown: !!visibleAt, seconds_after_publish: visibleAt ? +((visibleAt - publishAt) / 1000).toFixed(1) : null, total_s_from_dispatch: visibleAt ? +((visibleAt - dispatchAt) / 1000).toFixed(1) : null, api_polls: polls.api, mirror_polls: polls.mirror }
}
;(async () => {
  const browser = await chromium.launch(); const res = []
  for (const s of offsets.split(',').map(Number)) { const r = await trial(browser, s); res.push(r); console.log(label, JSON.stringify(r)) }
  await browser.close(); fs.writeFileSync(outPath, JSON.stringify({ label, trials: res }, null, 2))
})()
