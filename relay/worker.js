// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// ForgeClaw public relay (Cloudflare Worker). Lets visitors of the public ForgeClaw site use the hosted
// model (deepseek-16b.yml, Qwen/Qwen3-8B) without ever holding the owner's credentials.
//
// What it can do: dispatch TWO workflows (deepseek-16b.yml, chat profile, no NEXUS learning; and
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
//   RESEND_API_KEY   optional secret; with REPORT_EMAIL, error reports are emailed through Resend
//   REPORT_EMAIL     the owner's email address for error reports

const WORKFLOW = 'deepseek-16b.yml'
const RESEARCH_WORKFLOW = 'deep-research.yml'
const ID_RE = /^public-[a-z0-9]{6,12}-[a-z0-9]{6,12}$/
const MAX_TASK_CHARS = 4000
// Gathered web evidence for the answer; about 4K tokens of the model's 8K context.
const MAX_CONTEXT_CHARS = 16000
const MAX_QUESTION_CHARS = 500
const RESEARCH_SOURCES = '6'
const MAX_ERROR_ENTRIES = 30
const MAX_ERROR_CHARS = 600
const LEARN_TTL_S = 180 * 24 * 3600
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

async function overQuota(request, env, bucket = 'ip', limit = Number(env.MAX_PER_HOUR || 10)) {
  if (!env.RATE) return false
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const key = `${bucket}:${ip}:${new Date().toISOString().slice(0, 13)}`
  const used = Number(await env.RATE.get(key)) || 0
  if (used >= limit) return true
  await env.RATE.put(key, String(used + 1), { expirationTtl: 3700 })
  return false
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
  // Kept until the answer arrives, then stored with it as a NEXUS learning record (see readReasoning).
  if (env.LEARN) await env.LEARN.put(`task:${id}`, task, { expirationTtl: 86400 })
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
  return json({ invocation_id: id, status: 'queued' }, 202, cors)
}

async function readResearch(id, env, cors) {
  if (!ID_RE.test(id)) return json({ error: 'unknown invocation id' }, 404, cors)
  const run = await findRun(env, RESEARCH_WORKFLOW, id)
  if (!run) return json({ status: 'queued' }, 200, cors)
  if (run.status !== 'completed') return json({ status: run.status }, 200, cors)
  // A run that found no sources fails on purpose but still uploads its report (with the failures), so read it either way.
  const files = await readArtifact(env, run, `research-${id}`, ['research.json'])
  if (!files?.['research.json']) return json({ status: 'failed', conclusion: run.conclusion || 'no result artifact', run_url: run.html_url }, 200, cors)
  let report
  try { report = JSON.parse(files['research.json']) } catch { return json({ status: 'failed', conclusion: 'unreadable research report', run_url: run.html_url }, 200, cors) }
  return json({ status: 'done', report, run_url: run.html_url }, 200, cors)
}

async function readReasoning(id, env, cors) {
  if (!ID_RE.test(id)) return json({ error: 'unknown invocation id' }, 404, cors)
  const run = await findRun(env, WORKFLOW, id)
  if (!run) return json({ status: 'queued' }, 200, cors)
  if (run.status !== 'completed') return json({ status: run.status }, 200, cors)
  if (run.conclusion !== 'success') return json({ status: 'failed', conclusion: run.conclusion }, 200, cors)
  const files = await readArtifact(env, run, `deepseek-${id}`, ['result.txt', 'result_meta.txt'])
  if (!files) return json({ status: 'failed', conclusion: 'no result artifact' }, 200, cors)
  const model = /^model=(.+)$/m.exec(files['result_meta.txt'] || '')?.[1] || ''
  const result = files['result.txt'] || ''
  await recordLearning(env, id, result, model)
  return json({ status: 'done', result, model }, 200, cors)
}

/** Store a visitor conversation once, for the owner to import into NEXUS (unapproved candidates). */
async function recordLearning(env, id, result, model) {
  if (!env.LEARN) return
  const task = await env.LEARN.get(`task:${id}`)
  if (task === null) return  // already recorded, or expired
  const ts = new Date().toISOString()
  await env.LEARN.put(`learn:${ts}:${id}`, JSON.stringify({ id, task, result, model, ts }), { expirationTtl: LEARN_TTL_S })
  await env.LEARN.delete(`task:${id}`)
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
  if (!env.OWNER_KEY || auth !== `Bearer ${env.OWNER_KEY}`) return json({ error: 'owner key required' }, 401, cors)
  if (!env.LEARN) return json({ records: [] }, 200, cors)
  const list = await env.LEARN.list({ prefix, limit: 500 })
  const records = []
  for (const key of list.keys) {
    const value = await env.LEARN.get(key.name)
    if (value) try { records.push(JSON.parse(value)) } catch { /* skip a corrupt record */ }
  }
  return json({ records, complete: list.list_complete !== false }, 200, cors)
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)
    if (!cors) return json({ error: 'origin not allowed' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const url = new URL(request.url)
    // Error reports and the owner exports work even before the model token is configured.
    if (!env.GITHUB_TOKEN && (url.pathname.startsWith('/v1/reason') || url.pathname.startsWith('/v1/research'))) return json({ error: 'relay is not configured' }, 503, cors)
    try {
      if (request.method === 'POST' && url.pathname === '/v1/reason') return await startReasoning(request, env, cors)
      if (request.method === 'POST' && url.pathname === '/v1/errors') return await receiveErrors(request, env, cors)
      if (request.method === 'GET' && url.pathname === '/v1/learning') return await exportRecords(request, env, cors, 'learn:')
      if (request.method === 'GET' && url.pathname === '/v1/errors') return await exportRecords(request, env, cors, 'err:')
      if (request.method === 'POST' && url.pathname === '/v1/research') return await startResearch(request, env, cors)
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
