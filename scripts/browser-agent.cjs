// ForgeClaw browser agent runner (CommonJS: package.json is "type": "module"; Playwright is installed by the workflow).
// Replays a list of browser actions on a fresh Chromium and reports what is on the page afterwards. It runs untrusted
// websites, so it holds no credentials (the workflow's browse job is read-only with no persisted token), refuses
// private/internal addresses (also for redirects and sub-requests), never types into a password field, never
// downloads, and is bounded in actions, time and output. The model that decides the next step lives in the app.
//
// DRAFT MODE, ALWAYS ON (operator authorization 2026-10-27: "default-on write block ONLY; submit stays blocked"). There is no
// switch to turn it off. Every request whose method is not GET/HEAD/OPTIONS is refused at the network layer, and a form that
// would submit with a non-GET method is cancelled in the page. An action that tries to submit (a POST form submit, a POST
// navigation, or a same-site write right after a click, key press or typing) FAILS its step with a note, so the app reports it
// and drops it from the session; nothing is ever sent. Background writes to other sites during page load (usually analytics)
// are refused too but do not fail the step; they are counted in `writesBlocked`. GET forms (site search) still work: they are
// not writes. Residual risk, stated: a GET request with side effects, and WebSockets (not covered by request routing).
//
//   env: ACTIONS_JSON  JSON array of actions to replay from a blank page (the app sends the accepted ones plus the new batch)
//   out: agent-out/result.json, agent-out/screen.jpg
'use strict'
const fs = require('fs')
const dns = require('dns').promises
const net = require('net')

const MAX_ACTIONS = 60
const MAX_TEXT = 4000
const MAX_ELEMENTS = 60
const ACTION_TIMEOUT_MS = 8000
const TOTAL_TIMEOUT_MS = 4 * 60 * 1000
const ACTION_TYPES = new Set(['goto', 'click', 'type', 'press', 'scroll', 'wait', 'back'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Rough same-site test (last two labels); good enough to tell a site's own write from a third-party tracker. */
const siteOf = host => host.split('.').slice(-2).join('.')
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', 'Backspace', 'Space'])

function privateIPv4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19))
}

/** True for any address that is not a normal public one. Unparseable input counts as private. */
function isPrivateAddress(ip) {
  const v = net.isIP(ip)
  if (v === 4) return privateIPv4(ip)
  if (v === 6) {
    const s = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
    if (mapped) return privateIPv4(mapped[1])
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || /^fe[89ab]/.test(s) || s.startsWith('ff')
  }
  return true
}

function blockedHostname(host) {
  const h = host.toLowerCase().replace(/\.$/, '')
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home') || h === 'metadata.google.internal'
}

/** Static check of a URL string: http(s) only, no credentials, no internal names, no private IP literal. Throws with the reason. */
function checkUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error(`not a valid URL: ${String(raw).slice(0, 80)}`) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`only http and https pages are allowed (got ${u.protocol})`)
  if (u.username || u.password) throw new Error('URLs with a username or password are not allowed')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (blockedHostname(host)) throw new Error(`internal address refused: ${host}`)
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`private address refused: ${host}`)
  return u
}

/** Check a URL and every address its hostname resolves to (a public name that points at a private address is refused). */
async function checkUrlResolved(raw, lookup = dns.lookup.bind(dns)) {
  const u = checkUrl(raw)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return u
  let addrs
  try { addrs = await lookup(host, { all: true }) } catch { throw new Error(`could not resolve ${host}`) }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) throw new Error(`${host} resolves to a private address; refused`)
  return u
}

/** Validate the action list shape. Returns the cleaned list or throws. Pure. */
function validateActions(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('actions must be a non-empty array')
  if (list.length > MAX_ACTIONS) throw new Error(`at most ${MAX_ACTIONS} actions per session`)
  return list.map((a, i) => {
    if (!a || typeof a !== 'object' || !ACTION_TYPES.has(a.type)) throw new Error(`action ${i + 1}: unknown type`)
    const s = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined)
    if (a.type === 'goto') { checkUrl(a.url); return { type: 'goto', url: String(a.url).slice(0, 2000) } }
    if (a.type === 'click') {
      if (!a.name && !a.text && !a.selector) throw new Error(`action ${i + 1}: click needs name, text or selector`)
      return { type: 'click', role: s(a.role, 40), name: s(a.name), text: s(a.text), selector: s(a.selector) }
    }
    if (a.type === 'type') {
      if (typeof a.text !== 'string') throw new Error(`action ${i + 1}: type needs text`)
      if (!a.name && !a.label && !a.placeholder && !a.selector) throw new Error(`action ${i + 1}: type needs name, label, placeholder or selector`)
      return { type: 'type', role: s(a.role, 40), name: s(a.name), label: s(a.label), placeholder: s(a.placeholder), selector: s(a.selector), text: a.text.slice(0, 500), submit: a.submit === true }
    }
    if (a.type === 'press') { if (!KEYS.has(a.key)) throw new Error(`action ${i + 1}: key not allowed`); return { type: 'press', key: a.key } }
    if (a.type === 'scroll') return { type: 'scroll', direction: a.direction === 'up' ? 'up' : 'down', amount: Math.min(Math.max(Number(a.amount) || 600, 100), 3000) }
    if (a.type === 'wait') return { type: 'wait', ms: Math.min(Math.max(Number(a.ms) || 1000, 100), 5000) }
    return { type: 'back' }
  })
}

const INTERACTIVE = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]'

async function snapshot(page) {
  return await page.evaluate(({ sel, maxEl, maxText }) => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxText)
    const elements = []
    for (const el of document.querySelectorAll(sel)) {
      if (elements.length >= maxEl) break
      if (!vis(el)) continue
      const tag = el.tagName.toLowerCase()
      const type = (el.getAttribute('type') || '').toLowerCase()
      const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (type === 'checkbox' ? 'checkbox' : type === 'submit' || type === 'button' ? 'button' : 'textbox') : 'button')
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('value') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const item = { role, name }
      if (tag === 'a') item.href = (el.getAttribute('href') || '').slice(0, 100)
      if (type === 'password') item.note = 'password field: not allowed'
      elements.push(item)
    }
    return { title: document.title.slice(0, 120), text, elements }
  }, { sel: INTERACTIVE, maxEl: MAX_ELEMENTS, maxText: MAX_TEXT })
}

function locate(page, a) {
  if (a.selector) return page.locator(a.selector).first()
  if (a.role && a.name) return page.getByRole(a.role, { name: a.name }).first()
  if (a.label) return page.getByLabel(a.label).first()
  if (a.placeholder) return page.getByPlaceholder(a.placeholder).first()
  if (a.name && a.type === 'type') return page.getByRole('textbox', { name: a.name }).first()
  if (a.text) return page.getByText(a.text).first()
  return page.getByText(a.name).first()
}

// BROWSER_AGENT_TEST_* exist only so the tests can point a fake public name at a local page; the workflow never sets them.
const testLookup = process.env.BROWSER_AGENT_TEST_LOOKUP ? async () => [{ address: '93.184.216.34' }] : undefined

async function runAction(page, a) {
  if (a.type === 'goto') { await checkUrlResolved(a.url, testLookup); await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); return }
  if (a.type === 'back') { await page.goBack({ timeout: ACTION_TIMEOUT_MS }); return }
  if (a.type === 'wait') { await page.waitForTimeout(a.ms); return }
  if (a.type === 'scroll') { await page.mouse.wheel(0, a.direction === 'up' ? -a.amount : a.amount); await page.waitForTimeout(250); return }
  if (a.type === 'press') { await page.keyboard.press(a.key); await page.waitForTimeout(300); return }
  const target = locate(page, a)
  if (a.type === 'click') { await target.click({ timeout: ACTION_TIMEOUT_MS }); await page.waitForTimeout(500); return }
  // type
  const kind = await target.evaluate(el => (el.getAttribute('type') || '').toLowerCase(), { timeout: ACTION_TIMEOUT_MS })
  if (kind === 'password') throw new Error('typing into a password field is not allowed')
  await target.fill(a.text, { timeout: ACTION_TIMEOUT_MS })
  if (a.submit) await target.press('Enter')
  await page.waitForTimeout(500)
}

async function main() {
  const out = { ok: false, url: '', title: '', text: '', elements: [], steps: [], actionsOk: 0 }
  fs.mkdirSync('agent-out', { recursive: true })
  const finish = () => { fs.writeFileSync('agent-out/result.json', JSON.stringify(out)); process.exit(out.ok ? 0 : 1) }
  let browser
  try {
    const actions = validateActions(JSON.parse(process.env.ACTIONS_JSON || '[]'))
    let chromium
    try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('playwright-core')) }
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', ...(process.env.BROWSER_AGENT_TEST_ARGS ? JSON.parse(process.env.BROWSER_AGENT_TEST_ARGS) : [])] })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: false, serviceWorkers: 'block', permissions: [] })
    const seen = new Map()
    // Draft mode: the page can never send a write (see the header). Writes are recorded so a submit attempt fails its step.
    const blocked = []
    let submitsBlocked = 0
    await context.exposeFunction('__forgeclawSubmitBlocked', () => { submitsBlocked++ })
    await context.addInitScript(() => {
      const writes = f => (f && f.getAttribute && (f.getAttribute('method') || 'get').toLowerCase() !== 'get') || (f && f.method && f.method.toLowerCase() !== 'get')
      const report = () => { try { window.__forgeclawSubmitBlocked() } catch (_) { /* best effort; the network block still holds */ } }
      document.addEventListener('submit', e => { if (writes(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); report() } }, true)
      const P = HTMLFormElement.prototype, submit = P.submit, requestSubmit = P.requestSubmit
      Object.defineProperty(P, 'submit', { configurable: false, writable: false, value: function () { if (writes(this)) report(); else return submit.call(this) } })
      if (requestSubmit) Object.defineProperty(P, 'requestSubmit', { configurable: false, writable: false, value: function (b) { if (writes(this)) report(); else return requestSubmit.call(this, b) } })
    })
    // Every request the page makes (redirects, images, scripts) is checked, not only the address we typed.
    await context.route('**/*', async route => {
      const req = route.request()
      if (!SAFE_METHODS.has(req.method())) {
        let host = ''
        try { host = new URL(req.url()).hostname } catch { /* unparseable: still blocked */ }
        blocked.push({ method: req.method(), host, navigation: req.isNavigationRequest() })
        return route.abort('blockedbyclient')
      }
      const url = req.url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue()
      try {
        if (!seen.has(url)) seen.set(url, checkUrlResolved(url, testLookup))
        await seen.get(url)
        return route.continue()
      } catch { return route.abort('blockedbyclient') }
    })
    const page = await context.newPage()
    page.on('download', d => d.cancel().catch(() => {}))
    page.on('dialog', d => d.dismiss().catch(() => {}))
    const deadline = Date.now() + TOTAL_TIMEOUT_MS
    for (const [i, a] of actions.entries()) {
      if (Date.now() > deadline) { out.steps.push({ n: i + 1, type: a.type, ok: false, note: 'time limit reached' }); break }
      const before = { writes: blocked.length, submits: submitsBlocked }
      try { await runAction(page, a) }
      catch (e) { out.steps.push({ n: i + 1, type: a.type, ok: false, note: String(e.message || e).split('\n')[0].slice(0, 160) }); break }
      const fresh = blocked.slice(before.writes)
      let pageHost = ''
      try { pageHost = new URL(page.url()).hostname } catch { /* about:blank */ }
      const interactive = a.type === 'click' || a.type === 'press' || a.type === 'type'
      const attempt = submitsBlocked > before.submits ? { method: 'POST', host: pageHost }
        : fresh.find(w => w.navigation) || (interactive ? fresh.find(w => pageHost && siteOf(w.host) === siteOf(pageHost)) : undefined)
      if (attempt) {
        out.steps.push({ n: i + 1, type: a.type, ok: false, note: `write blocked (draft mode): a ${attempt.method} to ${attempt.host || 'the page'} was not sent. Submitting is turned off; stop and tell the owner the form is filled in.` })
        break
      }
      out.steps.push({ n: i + 1, type: a.type, ok: true }); out.actionsOk = i + 1
    }
    out.draftMode = true
    out.writesBlocked = blocked.length + submitsBlocked
    out.url = page.url()
    const snap = await snapshot(page).catch(() => ({ title: '', text: '', elements: [] }))
    Object.assign(out, snap)
    out.screenshot = await page.screenshot({ path: 'agent-out/screen.jpg', type: 'jpeg', quality: 55 }).then(() => true, () => false)
    out.ok = out.actionsOk === actions.length
  } catch (e) {
    out.error = String(e.message || e).split('\n')[0].slice(0, 300)
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
  finish()
}

module.exports = { isPrivateAddress, checkUrl, checkUrlResolved, validateActions, MAX_ACTIONS }
if (require.main === module) main()
