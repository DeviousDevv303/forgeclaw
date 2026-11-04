// Multi-turn conversation check of the Qwen path in real Chromium against the PRODUCTION build (vite preview on :4173).
// Reproduces the owner's report: "Teach me something new" -> answer -> "What do you attribute that phenomenon too?" lost the thread and the
// model answered from the runtime envelope (a ledger / bankroll). GitHub is a local stand-in that RECORDS every workflow_dispatch body, so the
// check is on what the app actually sends, per turn; the answers it serves are scripted (they test transport, not the model).
// Usage: node ui_conversation.cjs META_TEMPLATE OUT_JSON
const { chromium } = require('playwright')
const fs = require('fs')
const [metaTemplate, outPath] = process.argv.slice(2)
const meta = fs.readFileSync(metaTemplate, 'utf8')
const report = { turns: [], checks: [] }
const check = (name, pass, detail = {}) => { report.checks.push({ name, pass, ...detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 240)) }

const ANSWER_1 = 'Quantum entanglement is a link between two particles: measuring one instantly fixes the state of the other, however far apart they are.'
const ANSWER_2 = 'It is attributed to the particles sharing one joint quantum state, not to a signal passing between them.'
const ANSWER_3 = 'Because the joint state cannot be split into two independent parts, so a measurement on one part updates the whole.'
const ANSWER_4 = 'You are welcome.'
const ANSWER_5 = 'Understood, no further detail then.'
const scripted = [ANSWER_1, ANSWER_2, ANSWER_3, ANSWER_4, ANSWER_5]

;(async () => {
  const browser = await chromium.launch()
  const [vw, vh] = (process.env.VIEWPORT || '1100x900').split('x').map(Number)
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: vw < 600, hasTouch: vw < 600 })
  await ctx.addInitScript(() => { localStorage.setItem('gh_token', 'test-token') })
  const dispatches = []   // inputs of every workflow_dispatch the app made, in order
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(), url = req.url()
    if (req.method() === 'POST' && /\/actions\/workflows\/([^/]+)\/dispatches/.test(url)) { dispatches.push(JSON.parse(req.postData() || '{}').inputs); return route.fulfill({ status: 204, body: '' }) }
    if (/\/actions\/workflows\/qwen3-8b\.yml\/runs/.test(url)) {
      const runs = dispatches.map((d, i) => ({ id: 4200 + i, event: 'workflow_dispatch', head_branch: 'main', name: `Qwen/Qwen3-8B ${d.invocation_id}`, display_title: `Qwen/Qwen3-8B ${d.invocation_id}`, created_at: new Date().toISOString(), status: 'completed', conclusion: 'success', run_number: i + 1, html_url: 'x' }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workflow_runs: runs }) })
    }
    const m = url.match(/\/actions\/runs\/(\d+)$/); if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: Number(m[1]), status: 'completed', conclusion: 'success', run_number: 1, html_url: 'x' }) })
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await ctx.route('https://raw.githubusercontent.com/**', async route => {
    const url = route.request().url(); const idx = dispatches.findIndex(d => url.includes(`/qwen-results/qwen-results/${d.invocation_id}`))
    if (idx < 0) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/plain', body: url.endsWith('.meta.txt') ? meta.replace(/invocation_id=.*/, `invocation_id=${dispatches[idx].invocation_id}`) : scripted[idx] })
  })
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)))
  await page.goto(process.env.BASE_URL || 'http://localhost:4173/', { waitUntil: 'load' })
  const ask = async text => { const box = page.getByRole('textbox').first(); await box.fill(text); await box.press('Enter') }
  const waitText = async (src, ms = 60000) => { try { await page.waitForFunction(s => new RegExp(s, 'i').test(document.body.innerText), src, { timeout: ms }); return true } catch { return false } }

  // Turn 1: the owner's opening message
  await ask('Teach me something new'); const t1 = await waitText('Quantum entanglement is a link')
  report.turns.push({ n: 1, text: 'Teach me something new', shown: t1, dispatched: dispatches.length })
  check('T1 opening message dispatches and the answer renders', t1 && dispatches.length === 1, { dispatches: dispatches.length })

  // Turn 2: the owner's follow-up (verbatim, including its typo)
  await ask('What do you attribute that phenomenon too?'); const t2 = await waitText('joint quantum state')
  const d2 = dispatches[1] || {}
  report.turns.push({ n: 2, text: 'What do you attribute that phenomenon too?', shown: t2, task: (d2.task || '').slice(0, 200), contextHasThread: /Teach me something new/.test(d2.context || '') && (d2.context || '').includes(ANSWER_1), contextChars: (d2.context || '').length })
  check('T2 follow-up dispatches with the earlier question AND the earlier answer in the context', t2 && dispatches.length === 2 && /Teach me something new/.test(d2.context || '') && (d2.context || '').includes(ANSWER_1), { task: (d2.task || '').slice(0, 80), contextChars: (d2.context || '').length })
  const ctx2 = d2.context || '', env2 = ctx2.indexOf('ForgeClaw runtime envelope')
  check('T2 the thread is in the context, ahead of the runtime envelope when one is present, and carries no "— ForgeClaw" sign-off', ctx2.indexOf(ANSWER_1) > -1 && (env2 < 0 || ctx2.indexOf(ANSWER_1) < env2) && !/—\s*ForgeClaw\s*(\n|\[)/.test((ctx2.match(/\[CONVERSATION_SO_FAR\][\s\S]*?\[\/CONVERSATION_SO_FAR\]/) || [''])[0]), { threadAt: ctx2.indexOf(ANSWER_1), envelopeAt: env2 })
  check('T2 the task is only what the person typed (no envelope, no earlier turns in it)', !/RUNTIME_STATE|APPLICATION_IDENTITY/.test(d2.task || '') && /attribute that phenomenon/.test(d2.task || '') && !(d2.task || '').includes(ANSWER_1), { task: (d2.task || '').slice(0, 120) })

  // Turn 3: a very short follow-up used to receive the canned greeting
  await ask('and why?'); const t3 = await waitText('cannot be split')
  const d3 = dispatches[2] || {}; const body3 = await page.innerText('body')
  check('T3 "and why?" goes to the model (not the canned greeting) with BOTH earlier exchanges in the context', t3 && dispatches.length === 3 && (d3.context || '').includes(ANSWER_1) && (d3.context || '').includes(ANSWER_2) && !/Hey! What can I help you with\?[\s\S]*Hey! What can I help you with\?/.test(body3), { dispatches: dispatches.length, contextChars: (d3.context || '').length })

  // Turn 4: a plain thank-you reaches the model like everything else (owner's rule: no canned replies)
  const before = dispatches.length; await ask('thanks'); await waitText('no further detail', 3000).catch(() => false)
  for (let i = 0; i < 40 && dispatches.length === before; i++) await page.waitForTimeout(250)
  check('T4 "thanks" after an exchange is dispatched to the model with the thread, not answered by a canned reply', dispatches.length === before + 1 && (dispatches[before].context || '').includes(ANSWER_3), { dispatches: dispatches.length })
  await page.waitForTimeout(2500)

  // Turn 5: a one-word answer reaches the model with the thread
  await ask('no'); const t5 = await waitText('no further detail')
  const d5 = dispatches[4] || {}
  check('T5 "no" goes to the model with the thread in its context', t5 && dispatches.length === 5 && (d5.context || '').includes(ANSWER_3), { dispatches: dispatches.length, contextHasLastAnswer: (d5.context || '').includes(ANSWER_3) })

  check('no page errors; no DeepSeek on screen', !errs.length && !/deepseek/i.test(await page.innerText('body')), { pageErrors: errs })
  check('every dispatch stays inside the workflow_dispatch size limit', dispatches.every(d => JSON.stringify(d).length < 60000), { sizes: dispatches.map(d => JSON.stringify(d).length) })
  report.dispatches = dispatches.map(d => ({ task: (d.task || '').slice(0, 160), contextChars: (d.context || '').length, thread: ((d.context || '').match(/\[CONVERSATION_SO_FAR\][\s\S]*?\[\/CONVERSATION_SO_FAR\]/) || [''])[0] }))
  await page.screenshot({ path: outPath.replace('.json', '.png'), fullPage: false })
  await browser.close(); fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  const failed = report.checks.filter(c => !c.pass).length; console.log(`\n${report.checks.length - failed} of ${report.checks.length} checks pass`); process.exit(failed ? 1 : 0)
})()
