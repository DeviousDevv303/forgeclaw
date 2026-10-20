// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// ForgeClaw public relay (Cloudflare Worker). Lets visitors of the public ForgeClaw site use the hosted
// model (deepseek-16b.yml, Qwen/Qwen3-8B) without ever holding the owner's credentials.
//
// What it can do: dispatch ONE workflow (deepseek-16b.yml, chat profile, no NEXUS learning, no mirror
// branch) and read that run's result artifact. Nothing else: no repository writes, no other workflow,
// no tools. Abuse limits: allowed origins only, a per-IP hourly quota (needs the RATE KV binding), and a
// cap on concurrently running public jobs so visitors cannot starve the owner's own runs.
//
// Secrets / vars (see relay/README.md):
//   GITHUB_TOKEN     fine-grained token: repository forgeclaw only; Actions: Read and write. Nothing else.
//   REPO             owner/name, default DeviousDevv303/forgeclaw
//   ALLOWED_ORIGINS  comma-separated, e.g. https://deviousdevv303.github.io
//   MAX_PER_HOUR     per-IP dispatches per hour, default 10
//   MAX_CONCURRENT   public runs in progress at once, default 3
//   RATE             optional KV namespace binding for the per-IP quota

const WORKFLOW = 'deepseek-16b.yml'
const ID_RE = /^public-[a-z0-9]{6,12}-[a-z0-9]{6,12}$/
const MAX_TASK_CHARS = 4000

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return null
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
}

function gh(env, path, init = {}) {
  const repo = env.REPO || 'DeviousDevv303/forgeclaw'
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'forgeclaw-relay', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
  })
}

async function publicRunsInProgress(env) {
  let count = 0
  for (const status of ['queued', 'in_progress']) {
    const res = await gh(env, `/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=50`)
    if (!res.ok) throw new Error(`GitHub ${res.status} listing runs`)
    const data = await res.json()
    count += (data.workflow_runs || []).filter(r => String(r.display_title || '').includes(' public-')).length
  }
  return count
}

async function overQuota(request, env) {
  if (!env.RATE) return false
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const key = `ip:${ip}:${new Date().toISOString().slice(0, 13)}`
  const used = Number(await env.RATE.get(key)) || 0
  if (used >= Number(env.MAX_PER_HOUR || 10)) return true
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
  if (!task) return json({ error: 'task is required' }, 400, cors)
  if (task.length > MAX_TASK_CHARS) return json({ error: `task is limited to ${MAX_TASK_CHARS} characters` }, 413, cors)
  if (await overQuota(request, env)) return json({ error: `hourly limit reached (${env.MAX_PER_HOUR || 10} per hour); try again later` }, 429, cors)
  if (await publicRunsInProgress(env) >= Number(env.MAX_CONCURRENT || 3)) return json({ error: 'the public model is busy; try again in a few minutes' }, 503, cors)
  const id = `public-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
  const res = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { task, context: '', nexus_learning: 'false', invocation_id: id, mirror: 'false' } }),
  })
  if (!res.ok) return json({ error: `the model could not be started (GitHub ${res.status})` }, 502, cors)
  return json({ invocation_id: id, status: 'queued' }, 202, cors)
}

async function readReasoning(id, env, cors) {
  if (!ID_RE.test(id)) return json({ error: 'unknown invocation id' }, 404, cors)
  const runs = await gh(env, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50`)
  if (!runs.ok) return json({ error: `GitHub ${runs.status}` }, 502, cors)
  const run = ((await runs.json()).workflow_runs || []).find(r => String(r.display_title || '').includes(id))
  if (!run) return json({ status: 'queued' }, 200, cors)
  if (run.status !== 'completed') return json({ status: run.status }, 200, cors)
  if (run.conclusion !== 'success') return json({ status: 'failed', conclusion: run.conclusion }, 200, cors)
  const arts = await gh(env, `/actions/runs/${run.id}/artifacts?per_page=20`)
  if (!arts.ok) return json({ error: `GitHub ${arts.status} listing artifacts` }, 502, cors)
  const artifact = ((await arts.json()).artifacts || []).find(a => a.name === `deepseek-${id}` && !a.expired)
  if (!artifact) return json({ status: 'failed', conclusion: 'no result artifact' }, 200, cors)
  const zip = await gh(env, `/actions/artifacts/${artifact.id}/zip`, { redirect: 'follow' })
  if (!zip.ok) return json({ error: `GitHub ${zip.status} downloading the result` }, 502, cors)
  const files = await readZipEntries(await zip.arrayBuffer(), ['result.txt', 'result_meta.txt'])
  const model = /^model=(.+)$/m.exec(files['result_meta.txt'] || '')?.[1] || ''
  return json({ status: 'done', result: files['result.txt'] || '', model }, 200, cors)
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)
    if (!cors) return json({ error: 'origin not allowed' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (!env.GITHUB_TOKEN) return json({ error: 'relay is not configured' }, 503, cors)
    const url = new URL(request.url)
    try {
      if (request.method === 'POST' && url.pathname === '/v1/reason') return await startReasoning(request, env, cors)
      const m = /^\/v1\/reason\/([^/]+)$/.exec(url.pathname)
      if (request.method === 'GET' && m) return await readReasoning(m[1], env, cors)
      return json({ error: 'not found' }, 404, cors)
    } catch (error) {
      return json({ error: `relay error: ${error instanceof Error ? error.message : String(error)}` }, 502, cors)
    }
  },
}
