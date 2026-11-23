// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// ForgeClaw public relay (Cloudflare Worker). Lets visitors of the public ForgeClaw site use the hosted
// model (qwen3-8b.yml, Qwen/Qwen3-8B) without ever holding the owner's credentials.
//
// What it can do: dispatch TWO workflows (qwen3-8b.yml, chat profile, no NEXUS learning; and
// deep-research.yml, which searches the live web and reads pages), both without a mirror branch, and
// read those runs' result artifacts. Nothing else: no repository writes, no other workflow, no tools. Abuse limits: allowed origins only, a per-IP hourly quota (needs the RATE KV binding), and a
// cap on concurrently running public jobs so visitors cannot starve the owner's own runs.
//
// Secrets / vars (see relay/README.md):
//   GITHUB_TOKEN     fine-grained token: repository forgeclaw only; Actions: Read and write. Nothing else.
//   REPO             owner/name, default DeviousDevv303/forgeclaw
//   ALLOWED_ORIGINS  comma-separated, e.g. https://deviousdevv303.github.io
//   MAX_PER_HOUR     per-IP dispatches per hour, default 10
//   MAX_CONCURRENT   public runs in progress at once, default 3
//   RATE             optional KV namespace binding for the per-IP quota
//   LEARN            optional KV namespace: visitor conversations (for NEXUS) and error reports
//   OWNER_KEY        secret; the owner's app sends it to export the stored learning/error reports
//   FAMILY_CODE      optional secret; a simple shared code that unlocks the family tier below
//   OWNER_CODE       optional secret; the owner's OWN code, held by the owner alone and
//                    never shared with family. Powers ONLY the /seat-orders routes: the
//                    family code is family-tier access, not owner authority, and does
//                    not authorize them (GPT evidence audit, 2026-11-23).
//   GITHUB_TOKEN_NEXUS  optional secret; fine-grained token: repository nexus-isles only,
//                     Contents: Read and write. Powers ONLY the /seat-orders routes (Nexus
//                     Isles owner orders); separate from GITHUB_TOKEN on purpose, so the
//                     Actions-scoped token above can never write repository contents.
//   FAMILY_MAX_PER_HOUR    family dispatches per IP per hour, default 300
//   FAMILY_MAX_CONCURRENT  family-tier runs in progress per workflow, default 6
//   RESEND_API_KEY   optional secret; with REPORT_EMAIL, error reports are emailed through Resend
//   REPORT_EMAIL     the owner's email address for error reports

const WORKFLOW = 'qwen3-8b.yml'
const RESEARCH_WORKFLOW = 'deep-research.yml'
// Family tier: the interactive workflows the owner's app dispatches for chat, Nexus, images,
// research, search, browsing, shell and self-sculpt. Money and trading workflows
// (trader-agent.yml, kalshi-snapshot.yml, owner-exit.yml) are deliberately absent: a shared
// family code never gains a route to them, whatever the app asks for.
const FAMILY_WORKFLOWS = new Set([
  'qwen3-8b.yml', 'nexus-intelligence.yml', 'generate-image.yml', 'image-analyze.yml',
  'deep-research.yml', 'ddg_search.yml', 'code-review.yml', 'browser-agent.yml',
  'browser-automation.yml', 'shell-exec.yml', 'shell-repair.yml', 'self-sculpt.yml',
  'site-build.yml', 'search-proxy.yml', 'audio-transcribe.yml',
])
const ID_RE = /^public-[a-z0-9]{6,12}-[a-z0-9]{6,12}$/
const MAX_TASK_CHARS = 4000
// Gathered web evidence for the answer; about 4K tokens of the model's 8K context.
const MAX_CONTEXT_CHARS = 16000
const MAX_QUESTION_CHARS = 500
const RESEARCH_SOURCES = '6'
const MAX_ERROR_ENTRIES = 30
const MAX_ERROR_CHARS = 600
const LEARN_TTL_S = 180 * 24 * 3600
// Visitor learning is anti-manipulation by construction (see recordLearning): records are written only by the
// relay from the run's own artifact, signed with OWNER_KEY, capped per anonymous visitor and flagged when they
// read like instructions to a model.
const MAX_LEARN_PER_VISITOR_DAY = 20
const MAX_LEARN_RESULT_CHARS = 4000
// Wording used to steer a model ("ignore previous instructions", "from now on", "you are now", ...).
const MANIPULATION_RE = /\b(?:ignore (?:all |any )?(?:previous|prior|above)|disregard (?:the |all )?(?:previous|prior|above|instructions)|from now on|you are now|act as|pretend (?:to be|you)|system prompt|developer mode|jailbreak|always (?:answer|say|respond)|never (?:answer|say|mention|refuse)|remember (?:that|this)|new instructions?|override|do not tell)\b|<\/?(?:system|script|instructions?)\b|\[\/?INST\]/i
// Anything token-shaped is removed from error reports before they are stored or emailed.
const SECRET_RE = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return null
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
}

function gh(env, path, init = {}) {
  const repo = env.REPO || 'DeviousDevv303/forgeclaw'
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'forgeclaw-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
  })
}

async function publicRunsInProgress(env, workflow = WORKFLOW) {
  let count = 0
  for (const status of ['queued', 'in_progress']) {
    const res = await gh(env, `/actions/workflows/${workflow}/runs?status=${status}&per_page=50`)
    if (!res.ok) throw new Error(`GitHub ${res.status} listing runs`)
    const data = await res.json()
    count += (data.workflow_runs || []).filter(r => String(r.display_title || '').includes(' public-')).length
  }
  return count
}

// failOpen: a quota store that errors (KV daily or per-key write limits, an outage) is an abuse brake
// that broke, not a reason to refuse. The Kalshi route opts in, because the owner's orders ride it;
// the model routes keep failing closed, because their quota is what bounds workflow-dispatch spend.
async function overQuota(request, env, bucket = 'ip', limit = Number(env.MAX_PER_HOUR || 10), failOpen = false) {
  if (!env.RATE) return false
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    const key = `${bucket}:${ip}:${new Date().toISOString().slice(0, 13)}`
    const used = Number(await env.RATE.get(key)) || 0
    if (used >= limit) return true
    await env.RATE.put(key, String(used + 1), { expirationTtl: 3700 })
    return false
  } catch (error) {
    if (failOpen) return false
    throw error
  }
}

const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))
}
async function sha256Hex(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))) }

/** Stable JSON (sorted keys) of a learning record without its signature: what the owner's app verifies. */
export function canonicalRecord(record) {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'sig').sort().map(k => [k, sort(v[k])])) : v
  return JSON.stringify(sort(record))
}

/** Which manipulation patterns a text contains (shown to the owner; the record is still imported, unapproved). */
export function manipulationFlags(...texts) {
  const flags = []
  for (const text of texts) {
    if (MANIPULATION_RE.test(text || '')) { flags.push('instruction-like'); break }
  }
  if (texts.some(t => ((t || '').match(/https?:\/\//g) || []).length > 5)) flags.push('many-links')
  if (texts.some(t => /[A-Za-z0-9+/=]{200,}/.test(t || ''))) flags.push('encoded-blob')
  return flags
}

/** Anonymous, stable per-visitor id: HMAC of the client IP with the owner key; the IP itself is never stored. */
async function visitorId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  return (await hmacHex(env.OWNER_KEY || 'no-owner-key', `visitor:${ip}`)).slice(0, 12)
}

/** Constant-time string comparison for the owner key. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Note a visitor's request for learning, or decline to. Returns nothing; the record is written later by
 * recordLearning from the run's own result. Per anonymous visitor: at most MAX_LEARN_PER_VISITOR_DAY records a
 * day, and the same question twice in a day is kept once, so one person cannot flood or skew NEXUS.
 */
async function noteForLearning(request, env, id, kind, text) {
  if (!env.LEARN || !env.OWNER_KEY) return  // unsigned records would be rejected by the owner's app anyway
  const visitor = await visitorId(request, env)
  const day = new Date().toISOString().slice(0, 10)
  const dupKey = `vdup:${visitor}:${(await sha256Hex(text.toLowerCase().replace(/\s+/g, ' ').trim())).slice(0, 24)}`
  if (await env.LEARN.get(dupKey)) return
  const countKey = `vcount:${visitor}:${day}`
  const used = Number(await env.LEARN.get(countKey)) || 0
  if (used >= MAX_LEARN_PER_VISITOR_DAY) return
  await env.LEARN.put(countKey, String(used + 1), { expirationTtl: 2 * 86400 })
  await env.LEARN.put(dupKey, '1', { expirationTtl: 86400 })
  await env.LEARN.put(`task:${id}`, JSON.stringify({ kind, task: text, visitor, startedAt: Date.now() }), { expirationTtl: 86400 })
}

/** Minimal ZIP reader (central directory; stored or deflate entries) for the result artifact. */
export async function readZipEntries(buffer, wanted) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip archive')
  const entries = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out = {}
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip central directory')
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).split('/').pop()
    p += 46 + nameLen + extraLen + commentLen
    if (!wanted.includes(name)) continue
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(dataStart, dataStart + compSize)
    if (method === 0) out[name] = new TextDecoder().decode(data)
    else if (method === 8) out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    else throw new Error(`unsupported zip method ${method}`)
  }
  return out
}

async function startReasoning(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json({ error: 'body must be JSON {"task": "..."}' }, 400, cors) }
  const task = typeof body?.task === 'string' ? body.task.trim() : ''
  const context = typeof body?.context === 'string' ? body.context.trim() : ''
  if (!task) return json({ error: 'task is required' }, 400, cors)
  if (task.length > MAX_TASK_CHARS) return json({ error: `task is limited to ${MAX_TASK_CHARS} characters` }, 413, cors)
  if (context.length > MAX_CONTEXT_CHARS) return json({ error: `context is limited to ${MAX_CONTEXT_CHARS} characters` }, 413, cors)
  if (await overQuota(request, env)) return json({ error: `hourly limit reached (${env.MAX_PER_HOUR || 10} per hour); try again later` }, 429, cors)
  if (await publicRunsInProgress(env) >= Number(env.MAX_CONCURRENT || 3)) return json({ error: 'the public model is busy; try again in a few minutes' }, 503, cors)
  const id = `public-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
  const res = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { task, context, nexus_learning: 'false', invocation_id: id, mirror: 'false' } }),
  })
  if (!res.ok) return json({ error: `the model could not be started (GitHub ${res.status})` }, 502, cors)
  // Noted now; the record is written from the run's own result (see readReasoning).
  await noteForLearning(request, env, id, 'answer', task)
  return json({ invocation_id: id, status: 'queued' }, 202, cors)
}

async function findRun(env, workflow, id) {
  const runs = await gh(env, `/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=50`)
  if (!runs.ok) throw new Error(`GitHub ${runs.status} listing runs`)
  return ((await runs.json()).workflow_runs || []).find(r => String(r.display_title || '').includes(id))
}

async function readArtifact(env, run, name, wanted) {
  const arts = await gh(env, `/actions/runs/${run.id}/artifacts?per_page=20`)
  if (!arts.ok) throw new Error(`GitHub ${arts.status} listing artifacts`)
  const artifact = ((await arts.json()).artifacts || []).find(a => a.name === name && !a.expired)
  if (!artifact) return null
  const zip = await gh(env, `/actions/artifacts/${artifact.id}/zip`, { redirect: 'follow' })
  if (!zip.ok) throw new Error(`GitHub ${zip.status} downloading the result`)
  return readZipEntries(await zip.arrayBuffer(), wanted)
}

/** Live web research for a visitor's question: deep-research.yml searches and reads pages server-side. */
async function startResearch(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json({ error: 'body must be JSON {"question": "..."}' }, 400, cors) }
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return json({ error: 'question is required' }, 400, cors)
  if (question.length > MAX_QUESTION_CHARS) return json({ error: `question is limited to ${MAX_QUESTION_CHARS} characters` }, 413, cors)
  if (await overQuota(request, env, 'research')) return json({ error: `hourly limit reached (${env.MAX_PER_HOUR || 10} per hour); try again later` }, 429, cors)
  if (await publicRunsInProgress(env, RESEARCH_WORKFLOW) >= Number(env.MAX_CONCURRENT || 3)) return json({ error: 'web research is busy; try again in a minute' }, 503, cors)
  const id = `public-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
  const res = await gh(env, `/actions/workflows/${RESEARCH_WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { question, queries: '', max_sources: RESEARCH_SOURCES, invocation_id: id, mirror: 'false' } }),
  })
  if (!res.ok) return json({ error: `web research could not be started (GitHub ${res.status})` }, 502, cors)
  await noteForLearning(request, env, id, 'research', question)
  return json({ invocation_id: id, status: 'queued' }, 202, cors)
}

async function readResearch(id, env, cors) {
  if (!ID_RE.test(id)) return json({ error: 'unknown invocation id' }, 404, cors)
  const run = await findRun(env, RESEARCH_WORKFLOW, id)
  if (!run) return json({ status: 'queued' }, 200, cors)
  if (run.status !== 'completed') return json({ status: run.status }, 200, cors)
  // A run that found no sources fails on purpose but still uploads its report (with the failures), so read it either way.
  const files = await readArtifact(env, run, `research-${id}`, ['research.json'])
  if (!files?.['research.json']) {
    await recordLearning(env, id, { outcome: 'failed', result: `[TOOL ERROR] research run concluded ${run.conclusion || 'without a report'}`, model: 'deep-research' })
    return json({ status: 'failed', conclusion: run.conclusion || 'no result artifact', run_url: run.html_url }, 200, cors)
  }
  let report
  try { report = JSON.parse(files['research.json']) } catch { return json({ status: 'failed', conclusion: 'unreadable research report', run_url: run.html_url }, 200, cors) }
  const sources = Array.isArray(report.sources) ? report.sources.length : 0
  await recordLearning(env, id, sources
    ? { outcome: 'completed', result: `${sources} source(s): ${report.sources.slice(0, 6).map(s => s.domain || s.url).join(', ')}`, model: 'deep-research', sources }
    : { outcome: 'failed', result: '[TOOL ERROR] research found no readable sources', model: 'deep-research', sources: 0 })
  return json({ status: 'done', report, run_url: run.html_url }, 200, cors)
}

async function readReasoning(id, env, cors) {
  if (!ID_RE.test(id)) return json({ error: 'unknown invocation id' }, 404, cors)
  const run = await findRun(env, WORKFLOW, id)
  if (!run) return json({ status: 'queued' }, 200, cors)
  if (run.status !== 'completed') return json({ status: run.status }, 200, cors)
  if (run.conclusion !== 'success') {
    await recordLearning(env, id, { outcome: 'failed', result: `[TOOL ERROR] model run concluded ${run.conclusion}`, model: '' })
    return json({ status: 'failed', conclusion: run.conclusion }, 200, cors)
  }
  const files = await readArtifact(env, run, `qwen-${id}`, ['result.txt', 'result_meta.txt'])
  if (!files) return json({ status: 'failed', conclusion: 'no result artifact' }, 200, cors)
  const model = /^model=(.+)$/m.exec(files['result_meta.txt'] || '')?.[1] || ''
  const result = files['result.txt'] || ''
  await recordLearning(env, id, { outcome: result.trim() ? 'completed' : 'failed', result: result.trim() || '[TOOL ERROR] empty answer', model })
  return json({ status: 'done', result, model }, 200, cors)
}

/**
 * Store a visitor run once, for the owner to import into NEXUS as unapproved candidates. Everything in the
 * record comes from the relay (the noted request and the run's own outcome), never from the visitor's browser,
 * and the record is signed with OWNER_KEY so the owner's app can reject anything altered or forged.
 */
async function recordLearning(env, id, outcome) {
  if (!env.LEARN || !env.OWNER_KEY) return
  const raw = await env.LEARN.get(`task:${id}`)
  if (raw === null) return  // not noted (capped, duplicate), already recorded, or expired
  await env.LEARN.delete(`task:${id}`)
  let noted
  try { noted = JSON.parse(raw) } catch { return }
  const result = String(outcome.result || '').slice(0, MAX_LEARN_RESULT_CHARS)
  const record = {
    v: 2,
    id,
    kind: noted.kind,
    tool: noted.kind === 'research' ? 'deep_research' : 'qwen_reason',
    task: String(noted.task || ''),
    result,
    outcome: outcome.outcome,
    model: outcome.model || '',
    seconds: Math.max(0, Math.round((Date.now() - Number(noted.startedAt || Date.now())) / 1000)),
    ...(typeof outcome.sources === 'number' ? { sources: outcome.sources } : {}),
    visitor: noted.visitor,
    flags: manipulationFlags(noted.task, result),
    ts: new Date().toISOString(),
  }
  record.sig = await hmacHex(env.OWNER_KEY, canonicalRecord(record))
  await env.LEARN.put(`learn:${record.ts}:${id}`, JSON.stringify(record), { expirationTtl: LEARN_TTL_S })
}

export function sanitizeErrorEntries(entries) {
  if (!Array.isArray(entries)) return []
  return entries.slice(-MAX_ERROR_ENTRIES).map(e => ({
    timestamp: Number(e?.timestamp) || Date.now(),
    level: ['error', 'warn', 'info'].includes(e?.level) ? e.level : 'error',
    source: String(e?.source ?? '').replace(SECRET_RE, '[redacted]').slice(0, 80),
    message: String(e?.message ?? '').replace(SECRET_RE, '[redacted]').slice(0, MAX_ERROR_CHARS),
    details: e?.details ? String(e.details).replace(SECRET_RE, '[redacted]').slice(0, MAX_ERROR_CHARS) : undefined,
  }))
}

function formatErrorReport(report) {
  const lines = [`ForgeClaw error report (${report.mode}) — ${report.entries.length} entr${report.entries.length === 1 ? 'y' : 'ies'}`, `app ${report.app || 'unknown'} · ${report.ua || 'unknown browser'} · ${report.ts}`, '']
  for (const e of report.entries) lines.push(`[${new Date(e.timestamp).toISOString()}] ${e.level.toUpperCase()} ${e.source}: ${e.message}${e.details ? `\n    ${e.details}` : ''}`)
  return lines.join('\n')
}

async function emailReport(env, report) {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL) return 'not configured'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ForgeClaw Errors <onboarding@resend.dev>', to: [env.REPORT_EMAIL], subject: `ForgeClaw: ${report.entries.length} error(s) from a ${report.mode} session`, text: formatErrorReport(report) }),
  })
  return res.ok ? 'sent' : `failed (${res.status})`
}

async function receiveErrors(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json({ error: 'body must be JSON {"entries": [...]}' }, 400, cors) }
  const entries = sanitizeErrorEntries(body?.entries)
  if (!entries.length) return json({ error: 'entries is required' }, 400, cors)
  if (await overQuota(request, env, 'err', 6)) return json({ error: 'error-report limit reached; try later' }, 429, cors)
  const report = {
    mode: body?.mode === 'owner' ? 'owner' : 'visitor',
    app: String(body?.app ?? '').slice(0, 40),
    ua: String(request.headers.get('User-Agent') ?? '').slice(0, 160),
    ts: new Date().toISOString(),
    entries,
  }
  if (env.LEARN) await env.LEARN.put(`err:${report.ts}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(report), { expirationTtl: LEARN_TTL_S })
  const email = await emailReport(env, report)
  return json({ stored: Boolean(env.LEARN), email }, 202, cors)
}

/** Owner-only export of stored visitor conversations or error reports. */
async function exportRecords(request, env, cors, prefix) {
  const auth = request.headers.get('Authorization') || ''
  if (!env.OWNER_KEY || !sameSecret(auth, `Bearer ${env.OWNER_KEY}`)) return json({ error: 'owner key required' }, 401, cors)
  if (!env.LEARN) return json({ records: [] }, 200, cors)
  const list = await env.LEARN.list({ prefix, limit: 500 })
  const records = []
  for (const key of list.keys) {
    const value = await env.LEARN.get(key.name)
    if (value) try { records.push(JSON.parse(value)) } catch { /* skip a corrupt record */ }
  }
  return json({ records, complete: list.list_complete !== false }, 200, cors)
}

/**
 * The owner's Kalshi transport fallback: when the browser cannot reach Kalshi directly
 * (offline middle-mile or CORS), the app sends its already-signed request here and this route
 * forwards it verbatim to Kalshi, returning Kalshi's status and body. The signature does not
 * cover the host, so it stays valid. Nothing is stored or logged: the KALSHI-ACCESS headers
 * pass through untouched. Only the two Kalshi API hosts are reachable through this route, only
 * from the configured origins, rate-limited per IP like the other routes.
 */
const KALSHI_HOSTS = new Set(['external-api.kalshi.com', 'external-api.demo.kalshi.co'])

async function forwardKalshi(request, env, cors) {
  const body = await request.json().catch(() => null)
  const method = String(body?.method || '').toUpperCase()
  let target
  try { target = new URL(String(body?.url || '')) } catch { target = null }
  // https on the default port only: the caller picks the URL, so the scheme and port are pinned here
  // (new URL() has already normalized the host and resolved any dot-segments in the path).
  if (!['GET', 'POST'].includes(method) || !target || target.protocol !== 'https:' || target.port !== '' || !KALSHI_HOSTS.has(target.hostname) || !target.pathname.startsWith('/trade-api/v2/')) {
    return json({ error: 'bad kalshi forward request' }, 400, cors)
  }
  // After validation, so a malformed request never spends a quota write.
  if (await overQuota(request, env, 'kalshi', 120, true)) return json({ error: 'relay rate limit' }, 429, cors)
  const headers = {}
  for (const name of ['KALSHI-ACCESS-KEY', 'KALSHI-ACCESS-TIMESTAMP', 'KALSHI-ACCESS-SIGNATURE', 'Content-Type']) {
    const v = body.headers?.[name] ?? body.headers?.[name.toLowerCase()]
    if (v) headers[name] = String(v)
  }
  const res = await fetch(target.toString(), { method, headers, ...(body.body ? { body: String(body.body) } : {}) })
  return json({ status: res.status, body: await res.text() }, 200, cors)
}

/**
 * Family tier (owner-directed 2026-11-19): a browser holding the shared FAMILY_CODE but no
 * GitHub token gets the owner's interactive surface. The app rewrites its GitHub Actions API
 * calls to /v1/family/repos/<owner>/<repo>/actions/... and this handler performs them with the
 * relay's token, returning GitHub's response verbatim. The scope is pinned three ways: the
 * repository must be this relay's REPO, the workflow must be in FAMILY_WORKFLOWS (checked on
 * dispatch, and on run/artifact reads via the run's own workflow path), and nothing outside
 * /actions/ exists here at all — repository contents, issues and every other API stay
 * unreachable, because the relay token itself holds Actions permission only.
 */
function familyAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || ''
  return sameSecret(auth, `Bearer ${env.FAMILY_CODE}`)
}

/**
 * Owner authorization for the /seat-orders routes only. The family code is a
 * SHARED family-tier credential — by design it sits on family devices — so it
 * proves family access, never owner authority (GPT evidence audit, 2026-11-23:
 * anyone holding it could otherwise submit entries claiming operator "owner").
 * These routes require the separate OWNER_CODE, which the owner alone holds.
 * The family tier's own routes are untouched and keep using familyAuthorized.
 */
function ownerAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || ''
  return sameSecret(auth, `Bearer ${env.OWNER_CODE}`)
}

function passthrough(res, cors) {
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', ...cors },
  })
}

async function familyRunsInProgress(env, workflow) {
  let count = 0
  for (const status of ['queued', 'in_progress']) {
    const res = await gh(env, `/actions/workflows/${workflow}/runs?status=${status}&per_page=50`)
    if (!res.ok) throw new Error(`GitHub ${res.status} listing runs`)
    count += ((await res.json()).workflow_runs || []).length
  }
  return count
}

/** The workflow file a run belongs to, from the run's own record; null when unreadable. */
async function runWorkflow(env, runId) {
  const res = await gh(env, `/actions/runs/${runId}`)
  if (!res.ok) return { res }
  const run = await res.json()
  return { run, status: res.status, workflow: String(run.path || '').split('/').pop() || '' }
}

async function familyProxy(request, env, cors, url) {
  const repo = env.REPO || 'DeviousDevv303/forgeclaw'
  const m = /^\/v1\/family\/repos\/([^/]+)\/([^/]+)\/actions\/(.+)$/.exec(url.pathname)
  if (!m || `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}` !== repo) {
    return json({ error: 'family routes are scoped to the ForgeClaw repository' }, 403, cors)
  }
  const rest = m[3]
  const denied = workflow => json({ error: `workflow '${workflow}' is not family-unlocked` }, 403, cors)

  const dispatch = /^workflows\/([^/]+)\/dispatches$/.exec(rest)
  if (request.method === 'POST' && dispatch) {
    const workflow = decodeURIComponent(dispatch[1])
    if (!FAMILY_WORKFLOWS.has(workflow)) return denied(workflow)
    if (await overQuota(request, env, 'family', Number(env.FAMILY_MAX_PER_HOUR || 300))) {
      return json({ error: 'family hourly limit reached; try again later' }, 429, cors)
    }
    if (await familyRunsInProgress(env, workflow) >= Number(env.FAMILY_MAX_CONCURRENT || 6)) {
      return json({ error: 'family runs are busy; try again in a few minutes' }, 503, cors)
    }
    const body = await request.text()
    const res = await gh(env, `/actions/workflows/${workflow}/dispatches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    return passthrough(res, cors)
  }

  const runsList = /^workflows\/([^/]+)\/runs$/.exec(rest)
  if (request.method === 'GET' && runsList) {
    const workflow = decodeURIComponent(runsList[1])
    if (!FAMILY_WORKFLOWS.has(workflow)) return denied(workflow)
    return passthrough(await gh(env, `/actions/workflows/${workflow}/runs${url.search}`), cors)
  }

  const runRoute = /^runs\/(\d+)(\/artifacts)?$/.exec(rest)
  if (request.method === 'GET' && runRoute) {
    const { res, run, status, workflow } = await runWorkflow(env, runRoute[1])
    if (!run) return passthrough(res, cors)
    if (!FAMILY_WORKFLOWS.has(workflow)) return denied(workflow)
    if (!runRoute[2]) return json(run, status, cors)
    return passthrough(await gh(env, `/actions/runs/${runRoute[1]}/artifacts${url.search}`), cors)
  }

  const zipRoute = /^artifacts\/(\d+)\/zip$/.exec(rest)
  if (request.method === 'GET' && zipRoute) {
    const artRes = await gh(env, `/actions/artifacts/${zipRoute[1]}`)
    if (!artRes.ok) return passthrough(artRes, cors)
    const art = await artRes.json()
    const runId = art?.workflow_run?.id
    if (!runId) return json({ error: 'artifact has no workflow run' }, 404, cors)
    const { workflow } = await runWorkflow(env, runId)
    if (!workflow || !FAMILY_WORKFLOWS.has(workflow)) return denied(workflow || 'unknown')
    return passthrough(await gh(env, `/actions/artifacts/${zipRoute[1]}/zip`, { redirect: 'follow' }), cors)
  }

  return json({ error: 'not a family-unlocked route' }, 403, cors)
}

/**
 * Nexus Isles seat orders (owner directive 2026-11-22, "complete the playable game").
 *
 * The resident view's orders chat box composes owner order entries and POSTs them to
 * /seat-orders here; this route appends them — authenticated with the owner's OWN
 * code (the OWNER_CODE secret), never the shared family code — to the world's orders
 * file (DeviousDevv303/nexus-isles, branch live-world, world-data/seat-orders.json),
 * which the Nexus Isles runner reads fresh on every proposal. Three layers,
 * separately guaranteed:
 *
 *   1. HTTP authorization: only a request carrying the owner code reaches the write
 *      path at all; unauthorized requests write nothing. The family code does NOT
 *      authorize these routes: it is a shared family-tier credential, and owner
 *      authority is a different thing (GPT evidence audit, 2026-11-23).
 *   2. Deduplication: an entry whose complete canonical identity (seat, tick, the
 *      exact operator identity, standing, directive, orders) already exists anywhere
 *      in the seat's file appends nothing — so a stale retry of an order that a
 *      correction superseded can never resurrect it. Identity is the exact operator
 *      string, deliberately: deduplication detects a retry of the SAME submission
 *      by the SAME author; precedence classes are the runner's separate concern
 *      (layer 3), and two different authors' identical orders are two records, not
 *      a retry.
 *   3. Engine precedence: what governs a tick is decided by the Nexus Isles runner
 *      from the file (owner class beats operator class, last-in-class wins). This
 *      relay only records; it never decides an outcome, and no response from these
 *      routes claims the engine accepted anything — "recorded" means recorded.
 *
 * The GitHub credential is the GITHUB_TOKEN_NEXUS secret (nexus-isles only, Contents:
 * Read and write), held server-side only; the browser authenticates with the owner
 * code alone and never sees any token.
 */
const NEXUS_REPO = 'DeviousDevv303/nexus-isles'
const SEAT_ORDERS_BRANCH = 'live-world'
const SEAT_ORDERS_FILE = 'world-data/seat-orders.json'

function ghNexus(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${NEXUS_REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN_NEXUS}`, Accept: 'application/vnd.github+json', 'User-Agent': 'forgeclaw-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
  })
}

function b64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function b64DecodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function isRecordValue(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) }

/**
 * One seat-orders entry, validated and normalized exactly as the Nexus Isles runner's
 * parser validates it (runner/ownerOrders.ts, parseEntry) — the relay mirrors the
 * consumer, so anything recorded here parses there, and anything the parser would
 * refuse is refused here with the parser's own reason. Normalization matches too:
 * every order gains its args object ({} when absent), so two spellings of the same
 * order normalize identically. The engine's lawfulness verdict on an order (verb,
 * amounts, position) is NOT pre-judged here: the validator decides at resolution and
 * journals ACTION_REJECTED in the open, exactly as for any resident action.
 */
export function parseSeatOrderEntry(raw, index = 0) {
  const where = `seat orders entry ${index}`
  if (!isRecordValue(raw)) throw new Error(`${where}: must be an object`)
  const { tick, operator, orders, directive, standing } = raw
  if (tick !== null && !(typeof tick === 'number' && Number.isSafeInteger(tick) && tick >= 1)) {
    throw new Error(`${where}: tick must be null (standing) or an integer >= 1`)
  }
  if (standing !== undefined && typeof standing !== 'boolean') {
    throw new Error(`${where}: standing must be a boolean when present`)
  }
  if (standing === true && tick !== null) {
    throw new Error(`${where}: a standing entry carries tick: null`)
  }
  if (standing !== true && tick === null) {
    throw new Error(`${where}: a non-standing entry must name its tick`)
  }
  if (typeof operator !== 'string' || operator.length === 0) {
    throw new Error(`${where}: operator must be a non-empty string naming the author`)
  }
  if (!Array.isArray(orders)) throw new Error(`${where}: orders must be an array`)
  const parsedOrders = orders.map((o, i) => {
    if (!isRecordValue(o) || typeof o.verb !== 'string' || o.verb.length === 0) {
      throw new Error(`${where}: orders[${i}] must carry a non-empty verb`)
    }
    if (o.args !== undefined && !isRecordValue(o.args)) {
      throw new Error(`${where}: orders[${i}].args must be an object`)
    }
    return { verb: o.verb, args: o.args ?? {} }
  })
  if (directive !== undefined && typeof directive !== 'string') {
    throw new Error(`${where}: directive must be a string when present`)
  }
  return {
    tick,
    operator,
    orders: parsedOrders,
    ...(directive !== undefined ? { directive } : {}),
    // standing:false and an absent standing are the same logical entry — the
    // runner distinguishes only standing === true — so normalization drops the
    // false spelling. Without this, two spellings of one entry would carry two
    // canonical identities and a retry spelled the other way would append a
    // second copy of an order already recorded.
    ...(standing === true ? { standing: true } : {}),
  }
}

/** The whole orders file, validated as the runner's parseSeatOrdersFile validates it. */
export function parseSeatOrdersFile(raw) {
  if (!isRecordValue(raw)) throw new Error('seat orders file must be a JSON object')
  if (typeof raw.seat !== 'string' || raw.seat.length === 0) {
    throw new Error('seat orders file: seat must be a non-empty string')
  }
  if (!Array.isArray(raw.entries)) throw new Error('seat orders file: entries must be an array')
  return { seat: raw.seat, entries: raw.entries.map((e, i) => parseSeatOrderEntry(e, i)) }
}

/**
 * Deterministic canonical JSON: object keys sorted at every depth, arrays kept in
 * order. The same logical value always canonicalizes to the same string, regardless
 * of the key order it arrived with — duplicate matching compares these strings,
 * never raw serializations or insertion-ordered stringifies.
 */
export function canonicalSeatOrderJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalSeatOrderJson).join(',')}]`
  if (isRecordValue(value)) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalSeatOrderJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * The index of the file entry that IS the submitted entry, or -1. Identity is the
 * complete canonical entry — tick, operator (authorization class), standing,
 * directive and orders, within the one seat's file the route read (seat scoping is
 * the route's: it reads only the named seat's file and refuses a seat mismatch) —
 * matched against EVERY entry in the file, not just the latest: a retry of an order
 * that a later correction superseded is still a duplicate and appends nothing, so
 * the stale order stays superseded (owner-adopted rule from the GPT audit edge
 * case, 2026-11-22; the earlier latest-entry-only definition was withdrawn for
 * exactly this failure). An entry differing in any field — including a different
 * operator class carrying the same orders — is not a duplicate and appends
 * normally; precedence between classes is the runner's guarantee, not this check's.
 */
export function findSeatOrderDuplicate(file, entry) {
  const identity = canonicalSeatOrderJson(entry)
  return file.entries.findIndex(e => canonicalSeatOrderJson(e) === identity)
}

/**
 * The live orders file, parsed and normalized: { file, sha } (sha = the blob sha the
 * next write must name), or null when no orders file exists on live-world. Throws
 * with a plain reason when GitHub or the file itself cannot be read — callers turn
 * that into a 502 and write nothing.
 */
async function readLiveSeatOrders(env) {
  const res = await ghNexus(env, `/contents/${SEAT_ORDERS_FILE}?ref=${SEAT_ORDERS_BRANCH}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub ${res.status} reading the orders file`)
  const data = await res.json()
  let raw
  try { raw = JSON.parse(b64DecodeUtf8(data.content || '')) } catch { throw new Error('the existing seat-orders file is not valid JSON; nothing was written') }
  try {
    return { file: parseSeatOrdersFile(raw), sha: data.sha }
  } catch (error) {
    throw new Error(`the existing seat-orders file could not be parsed (${error instanceof Error ? error.message : String(error)}); nothing was written`)
  }
}

async function recordSeatOrder(request, env, cors) {
  if (!env.GITHUB_TOKEN_NEXUS) return json({ error: 'relay not configured for seat orders' }, 503, cors)
  let body
  try { body = await request.json() } catch { return json({ error: 'body must be JSON {"seat": "...", "entry": {...}}' }, 400, cors) }
  const seat = isRecordValue(body) ? body.seat : undefined
  if (typeof seat !== 'string' || seat.length === 0) return json({ error: 'seat must be a non-empty string' }, 400, cors)
  let entry
  try {
    entry = parseSeatOrderEntry(isRecordValue(body) ? body.entry : undefined)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400, cors)
  }
  // This route is the owner's own: the family code already authenticated the caller
  // as the owner, so an entry claiming another author is refused, never recorded.
  if (entry.operator !== 'owner') {
    return json({ error: 'this route records owner orders only: entry.operator must be "owner"' }, 400, cors)
  }
  // Read–check–append–write, with one retry when a concurrent append moves the file
  // between our read and our write (the duplicate check runs again on the retry, so
  // a raced identical submission still appends at most once).
  for (let attempt = 0; attempt < 2; attempt++) {
    let live
    try {
      live = await readLiveSeatOrders(env)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502, cors)
    }
    if (!live) {
      return json({ error: `no seat-orders file exists on ${SEAT_ORDERS_BRANCH} for seat '${seat}'; the relay records orders only into an existing orders file and never creates world state` }, 409, cors)
    }
    if (live.file.seat !== seat) {
      return json({ error: `seat mismatch: the live orders file is for seat '${live.file.seat}', not '${seat}'` }, 400, cors)
    }
    if (findSeatOrderDuplicate(live.file, entry) >= 0) {
      return json({ status: 'duplicate', seat, tick: entry.tick, sha: live.sha }, 200, cors)
    }
    const text = `${JSON.stringify({ seat: live.file.seat, entries: [...live.file.entries, entry] }, null, 2)}\n`
    const res = await ghNexus(env, `/contents/${SEAT_ORDERS_FILE}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `seat-orders: owner entry for seat ${seat}, tick ${entry.tick === null ? 'standing' : entry.tick}`,
        content: b64EncodeUtf8(text),
        branch: SEAT_ORDERS_BRANCH,
        sha: live.sha,
      }),
    })
    if (res.ok) {
      const written = await res.json().catch(() => null)
      return json({ status: 'recorded', seat, tick: entry.tick, sha: written?.content?.sha || null }, 200, cors)
    }
    if ((res.status === 409 || res.status === 422) && attempt === 0) continue
    return json({ error: `GitHub ${res.status} writing the orders file` }, 502, cors)
  }
  return json({ error: 'the orders file kept changing under the write; try again' }, 502, cors)
}

/**
 * Status read: the entries currently recorded for the seat, the orders file's blob
 * sha, and the sha of the latest commit that touched it. This reports what the
 * relay has recorded — never what the engine has accepted or resolved; resolution
 * is visible in the world journal, which the viewer already renders.
 */
async function readSeatOrders(request, env, cors, url) {
  if (!env.GITHUB_TOKEN_NEXUS) return json({ error: 'relay not configured for seat orders' }, 503, cors)
  const seat = url.searchParams.get('seat') || ''
  if (!seat) return json({ error: 'seat query parameter is required' }, 400, cors)
  let live
  try {
    live = await readLiveSeatOrders(env)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502, cors)
  }
  if (!live || live.file.seat !== seat) {
    return json({ error: `no seat-orders file exists on ${SEAT_ORDERS_BRANCH} for seat '${seat}'` }, 404, cors)
  }
  let commit = null
  try {
    const res = await ghNexus(env, `/commits?path=${encodeURIComponent(SEAT_ORDERS_FILE)}&sha=${SEAT_ORDERS_BRANCH}&per_page=1`)
    if (res.ok) commit = (await res.json())?.[0]?.sha || null
  } catch { /* the recorded entries are the substance; a failed commit lookup reports null, never a guess */ }
  return json({ seat, entries: live.file.entries, sha: live.sha, commit }, 200, cors)
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)
    if (!cors) return json({ error: 'origin not allowed' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const url = new URL(request.url)
    // Error reports and the owner exports work even before the model token is configured.
    if (!env.GITHUB_TOKEN && (url.pathname.startsWith('/v1/reason') || url.pathname.startsWith('/v1/research') || url.pathname.startsWith('/v1/family'))) return json({ error: 'relay is not configured' }, 503, cors)
    try {
      if (url.pathname.startsWith('/v1/family/')) {
        if (!env.FAMILY_CODE) return json({ error: 'family mode is not configured' }, 503, cors)
        if (!familyAuthorized(request, env)) return json({ error: 'family code required' }, 401, cors)
        return await familyProxy(request, env, cors, url)
      }
      if (url.pathname === '/seat-orders') {
        if (!env.OWNER_CODE) return json({ error: 'seat orders are not configured' }, 503, cors)
        if (!ownerAuthorized(request, env)) return json({ error: 'owner code required' }, 401, cors)
        if (request.method === 'POST') return await recordSeatOrder(request, env, cors)
        if (request.method === 'GET') return await readSeatOrders(request, env, cors, url)
        return json({ error: 'method not allowed' }, 405, cors)
      }
      if (request.method === 'POST' && url.pathname === '/v1/reason') return await startReasoning(request, env, cors)
      if (request.method === 'POST' && url.pathname === '/v1/errors') return await receiveErrors(request, env, cors)
      if (request.method === 'GET' && url.pathname === '/v1/learning') return await exportRecords(request, env, cors, 'learn:')
      if (request.method === 'GET' && url.pathname === '/v1/errors') return await exportRecords(request, env, cors, 'err:')
      if (request.method === 'POST' && url.pathname === '/v1/research') return await startResearch(request, env, cors)
      if (request.method === 'POST' && url.pathname === '/v1/kalshi') return await forwardKalshi(request, env, cors)
      const m = /^\/v1\/reason\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && m) return await readReasoning(m[1], env, cors)
      const r = /^\/v1\/research\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && r) return await readResearch(r[1], env, cors)
      return json({ error: 'not found' }, 404, cors)
    } catch (error) {
      return json({ error: `relay error: ${error instanceof Error ? error.message : String(error)}` }, 502, cors)
    }
  },
}
