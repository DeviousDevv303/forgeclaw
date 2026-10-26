// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// The MiroFish swarm sim from the chat. mirofish_sim dispatches .github/workflows/mirofish-sim.yml (the sim runs on
// GitHub Actions with the repository's MOONSHOT_API_KEY and ZEP_API_KEY secrets, never a key from this browser), finds
// the exact run by its invocation ID (the workflow's run-name), waits a bounded time, then reads the run record and the
// illustrated world the workflow published to the sim-results branch. mirofish_sim_result reads a finished run the same
// way. The world SVG reaches the chat through the image registry (imageArtifact.ts), never the model context.

import { appendSimRunLearning, type SimRunLearningInput } from './corpus'
import type { ToolContext } from './forgeTools'
import { describeGithubHttpFailure, githubStage, toolFetch } from './githubFetch'
import { isCorrelatedShellRun, type ShellWorkflowRun } from './shellCorrelation'
import { safeGetItem, safeSetItem } from './storage'

export const SIM_WORKFLOW_ID = 'mirofish-sim.yml'
export const SIM_RESULTS_BRANCH = 'sim-results'
export const SIM_PRESETS = ['tiny', 'small', 'mid'] as const
export const SIM_MODELS = ['kimi-k2.6', 'kimi-k2.7-code'] as const
/** The workflow refuses a higher ceiling; raising it needs a workflow edit. */
export const SIM_MAX_CEILING_USD = 1
export const SIM_DEFAULT_CEILING_USD = '0.40'
/**
 * The chat's default ceiling per preset. Two small runs with 9 and 10 agents (2026-10-26) both hit $0.40 before their poll,
 * losing everything spent; an unused ceiling costs nothing. tiny keeps the workflow's own $0.40 (a 5-agent tiny run: $0.25).
 */
export const SIM_DEFAULT_CEILING_BY_PRESET: Record<string, string> = { tiny: SIM_DEFAULT_CEILING_USD, small: '1.00', mid: '1.00' }
/** How long the chat waits before handing the run off to mirofish_sim_result. The first completed tiny run took 7 minutes. */
export const SIM_CHAT_WAIT_MS = 20 * 60 * 1000
const SIM_DISCOVERY_TIMEOUT_MS = 120_000
const SIM_READ_TIMEOUT_MS = 30_000
const SIM_POLL_DELAYS_MS = [2000, 5000, 10_000, 15_000, 20_000] as const
const SIM_DISCOVERY_PAGE_SIZE = 20
/** The world SVG the runner draws is a few KB; anything far larger is not ours. */
export const SIM_MAX_SVG_BYTES = 512 * 1024
/** App.tsx looks for this line in a tool result and attaches the registered world image to the reply. */
export const SIM_WORLD_MARKER = 'Sim world:'
export const SIM_WORLD_MARKER_RE = /Sim world:\s*(sim-[A-Za-z0-9._-]+)/

const KEY_RE = /^[A-Za-z0-9._-]{1,120}$/
const PERSISTENT_STATUS = /GitHub HTTP (?:401|403|404)\b/
const DISCOVERY_STAGE = 'sim-run-discovery GET /actions/workflows/mirofish-sim.yml/runs'
const STATUS_STAGE = 'sim-run-poll GET /actions/runs/{run_id}'

export interface SimRun {
  id: number
  status: string
  conclusion: string | null
  html_url: string
  run_number: number
  display_title?: string
}

export interface SimRecord {
  attempt?: number
  status?: string
  reason?: string
  invocation_id?: string
  sides?: [string, string]
  yes_side?: string | null
  key?: { card_id?: string; market_ticker?: string }
  seed?: { packet_sha256?: string; packet_chars?: number }
  config?: Record<string, unknown>
  extraction?: { n?: number; picks?: { A?: number; B?: number }; median_p_a?: number | null; iqr_p_a?: number | null; unparsed?: number } | null
  lean_for_yes_side?: number | null
  baseline_direct?: { pick?: string | null; p_a?: number | null; parsed?: boolean; error?: string } | null
  usage?: { cost_usd?: number; calls?: number; ceiling_usd?: number; ceiling_hit?: boolean }
  zep?: { deleted?: boolean | null }
  artifacts?: { run_url?: string; world_svg?: string; report?: string; world_json?: string }
  nexus?: { emitted?: boolean; reason?: string }
}

export interface SimResult {
  record: SimRecord
  recordPath: string
  svg?: string
  report?: string
}

/** The workflow's own input rules (mirofish-sim.yml, "Validate inputs and secrets"), checked before anything is dispatched. */
export function buildSimDispatchInputs(raw: Record<string, unknown>, invocationId: string): Record<string, string> {
  const text = (name: string): string => (typeof raw[name] === 'string' ? (raw[name] as string).trim() : raw[name] === undefined || raw[name] === null ? '' : String(raw[name]).trim())
  const cardId = text('card_id')
  const ticker = text('market_ticker')
  if (!KEY_RE.test(invocationId)) throw new Error('invalid invocation_id')
  if (!KEY_RE.test(cardId)) throw new Error('card_id must be 1-120 letters, digits, dots, underscores or hyphens')
  if (!KEY_RE.test(ticker)) throw new Error('market_ticker must be 1-120 letters, digits, dots, underscores or hyphens')
  const sides = text('sides')
  const parts = sides.split('|')
  if (parts.length !== 2 || parts.some(p => !p.trim() || p.length > 80)) throw new Error("sides must be exactly 'Name A|Name B'")
  const yesSide = text('yes_side')
  if (yesSide && !parts.map(p => p.trim()).includes(yesSide)) throw new Error('yes_side must be one of the two sides, or empty (then no intake line is filed)')
  const preset = text('preset') || 'tiny'
  if (!(SIM_PRESETS as readonly string[]).includes(preset)) throw new Error('preset must be tiny, small or mid')
  const model = text('model') || 'kimi-k2.6'
  if (!(SIM_MODELS as readonly string[]).includes(model)) throw new Error('model must be kimi-k2.6 or kimi-k2.7-code')
  const thinking = text('thinking') || 'disabled'
  if (thinking !== 'disabled' && thinking !== 'enabled') throw new Error('thinking must be disabled or enabled')
  const ceiling = text('ceiling_usd') || SIM_DEFAULT_CEILING_BY_PRESET[preset] || SIM_DEFAULT_CEILING_USD
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(ceiling) || !(Number(ceiling) > 0 && Number(ceiling) <= SIM_MAX_CEILING_USD)) {
    throw new Error(`ceiling_usd must be a dollar amount above 0 and at most ${SIM_MAX_CEILING_USD.toFixed(2)}`)
  }
  const packet = typeof raw.packet === 'string' ? raw.packet : ''
  if (packet.length < 200) throw new Error('the packet is under 200 characters; there is nothing to simulate')
  if (packet.length > 40_000) throw new Error('the packet is over 40000 characters')
  const provenance = text('provenance') || '{}'
  try { JSON.parse(provenance) } catch { throw new Error('provenance must be JSON, e.g. {"stats_snapshot":"espn:600061268","matchup_read":"absent","human_state":"absent"}') }
  return {
    invocation_id: invocationId, card_id: cardId, market_ticker: ticker, sides: `${parts[0].trim()}|${parts[1].trim()}`, yes_side: yesSide,
    position_ref: text('position_ref'), preset, model, thinking, ceiling_usd: ceiling, packet, provenance, rerun_reason: text('rerun_reason'),
  }
}

function ghHeaders(ctx: ToolContext, accept = 'application/vnd.github.v3+json'): Record<string, string> {
  return { Authorization: `token ${ctx.ghToken}`, Accept: accept }
}

export async function dispatchSim(ctx: ToolContext, owner: string, repo: string, inputs: Record<string, string>): Promise<void> {
  const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${SIM_WORKFLOW_ID}/dispatches`, {
    method: 'POST',
    headers: { ...ghHeaders(ctx), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`MiroFish sim dispatch failed: GitHub ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
  }
}

async function findSimRun(ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number): Promise<SimRun | undefined> {
  const res = await githubStage(DISCOVERY_STAGE, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${SIM_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=${SIM_DISCOVERY_PAGE_SIZE}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!res.ok) throw new Error(describeGithubHttpFailure(DISCOVERY_STAGE, res.status, res.statusText))
  const data = await githubStage(`${DISCOVERY_STAGE} response JSON`, () => res.json()) as { workflow_runs?: Array<Partial<ShellWorkflowRun>> }
  return (data.workflow_runs || []).find(run => isCorrelatedShellRun(run, invocationId, dispatchedAt)) as SimRun | undefined
}

/**
 * A sim run found by its invocation ID alone, for mirofish_sim_result. Unlike dispatch correlation there is no time window:
 * a sim may run for up to 150 minutes, and the ID (timestamp + random suffix) is already unique.
 */
export async function findSimRunByInvocation(ctx: ToolContext, owner: string, repo: string, invocationId: string): Promise<SimRun | undefined> {
  if (!KEY_RE.test(invocationId)) throw new Error('invocation_id must be letters, digits, dots, underscores or hyphens')
  const res = await githubStage(DISCOVERY_STAGE, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${SIM_WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=50`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!res.ok) throw new Error(describeGithubHttpFailure(DISCOVERY_STAGE, res.status, res.statusText))
  const data = await githubStage(`${DISCOVERY_STAGE} response JSON`, () => res.json()) as { workflow_runs?: Array<Partial<SimRun> & { name?: string }> }
  return (data.workflow_runs || []).find(run => typeof run.id === 'number' && `${run.name ?? ''} ${run.display_title ?? ''}`.includes(invocationId)) as SimRun | undefined
}

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

/**
 * A sim run still going, if any. A second dispatch while one runs could spend a key's other attempt: ForgeClaw re-runs the
 * last task the page died on by itself, and a 20-minute wait is exactly when a phone kills the tab.
 */
export async function findActiveSimRun(ctx: ToolContext, owner: string, repo: string): Promise<(SimRun & { invocationId?: string }) | undefined> {
  const res = await githubStage(DISCOVERY_STAGE, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${SIM_WORKFLOW_ID}/runs?per_page=${SIM_DISCOVERY_PAGE_SIZE}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!res.ok) throw new Error(describeGithubHttpFailure(DISCOVERY_STAGE, res.status, res.statusText))
  const data = await githubStage(`${DISCOVERY_STAGE} response JSON`, () => res.json()) as { workflow_runs?: Array<Partial<SimRun>> }
  const run = (data.workflow_runs || []).find(r => typeof r.id === 'number' && ACTIVE_STATUSES.has(String(r.status))) as SimRun | undefined
  if (!run) return undefined
  const invocationId = String(run.display_title ?? '').match(/MiroFish sim (\S+)/)?.[1]
  return { ...run, ...(invocationId ? { invocationId } : {}) }
}

async function readRun(ctx: ToolContext, owner: string, repo: string, runId: number): Promise<SimRun> {
  const res = await githubStage(STATUS_STAGE, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (!res.ok) throw new Error(describeGithubHttpFailure(STATUS_STAGE, res.status, res.statusText))
  return await githubStage(`${STATUS_STAGE} response JSON`, () => res.json()) as SimRun
}

const realSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Run aborted', 'AbortError')) }, { once: true })
})

/**
 * The dispatched run, polled until it completes or `maxWaitMs` passes. A run still going at the deadline is returned with
 * finished=false, never abandoned or reported as failed: the sim keeps running on GitHub and mirofish_sim_result reads it later.
 */
export async function waitForSimRun(
  ctx: ToolContext, owner: string, repo: string, invocationId: string, dispatchedAt: number,
  maxWaitMs = SIM_CHAT_WAIT_MS, deps: { now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<{ run: SimRun; finished: boolean }> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? realSleep
  const start = now()
  let run: SimRun | undefined
  let lastError = ''
  for (let attempt = 0; !run; attempt += 1) {
    if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
    try {
      run = await findSimRun(ctx, owner, repo, invocationId, dispatchedAt)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      lastError = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_STATUS.test(lastError)) throw error
    }
    if (run) break
    if (now() - start >= SIM_DISCOVERY_TIMEOUT_MS) {
      throw new Error(`The sim was dispatched, but its run "${invocationId}" was not found within ${SIM_DISCOVERY_TIMEOUT_MS / 1000}s${lastError ? ` (last read error: ${lastError})` : ''}. Check the Actions tab before dispatching again: a second dispatch may spend the key's next attempt.`)
    }
    await sleep(Math.min(1000 * (attempt + 1), 5000), ctx.signal)
  }
  for (let attempt = 0; run.status !== 'completed'; attempt += 1) {
    if (now() - start >= maxWaitMs) return { run, finished: false }
    await sleep(SIM_POLL_DELAYS_MS[Math.min(attempt, SIM_POLL_DELAYS_MS.length - 1)], ctx.signal)
    try {
      run = await readRun(ctx, owner, repo, run.id)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      if (PERSISTENT_STATUS.test(message)) throw error
    }
  }
  return { run, finished: true }
}

async function readBranchFile(ctx: ToolContext, owner: string, repo: string, path: string): Promise<string | null> {
  const stage = `sim-results GET ${path}`
  const res = await githubStage(stage, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${SIM_RESULTS_BRANCH}`,
    { headers: ghHeaders(ctx, 'application/vnd.github.raw'), cache: 'no-store' },
  ))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(describeGithubHttpFailure(stage, res.status, res.statusText))
  return await res.text()
}

/**
 * A run's record and world from the sim-results branch: the attempt that carries `invocationId` when given, else the given
 * attempt, else the latest. Null when the key has no record (an early failure or a refusal writes none).
 */
export async function readSimResult(
  ctx: ToolContext, owner: string, repo: string, key: { cardId: string; marketTicker: string; invocationId?: string; attempt?: number },
): Promise<SimResult | null> {
  if (!KEY_RE.test(key.cardId) || !KEY_RE.test(key.marketTicker)) throw new Error('card_id and market_ticker must be letters, digits, dots, underscores or hyphens')
  const listing = await readBranchListing(ctx, owner, repo, key.cardId)
  const prefix = `${key.marketTicker}.`
  const attempts = listing
    .map(name => name.startsWith(prefix) && name.endsWith('.run-record.json') ? Number(name.slice(prefix.length, -'.run-record.json'.length)) : NaN)
    .filter(n => Number.isInteger(n) && n > 0)
    .sort((a, b) => b - a)
  const wanted = key.attempt ? attempts.filter(n => n === key.attempt) : attempts
  for (const attempt of wanted) {
    const recordPath = `${key.cardId}/${key.marketTicker}.${attempt}.run-record.json`
    const raw = await readBranchFile(ctx, owner, repo, recordPath)
    if (raw === null) continue
    let record: SimRecord
    try { record = JSON.parse(raw) as SimRecord } catch { throw new Error(`${recordPath} on ${SIM_RESULTS_BRANCH} is not valid JSON`) }
    if (key.invocationId && record.invocation_id !== key.invocationId) continue
    const art = record.artifacts || {}
    const svg = art.world_svg ? await readBranchFile(ctx, owner, repo, `${key.cardId}/${art.world_svg}`) : null
    const report = art.report ? await readBranchFile(ctx, owner, repo, `${key.cardId}/${art.report}`) : null
    return { record, recordPath, ...(svg ? { svg } : {}), ...(report ? { report } : {}) }
  }
  return null
}

async function readBranchListing(ctx: ToolContext, owner: string, repo: string, dir: string): Promise<string[]> {
  const stage = `sim-results GET ${dir}/`
  const res = await githubStage(stage, () => toolFetch(
    { ...ctx, timeoutMs: SIM_READ_TIMEOUT_MS },
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(dir)}?ref=${SIM_RESULTS_BRANCH}`,
    { headers: ghHeaders(ctx), cache: 'no-store' },
  ))
  if (res.status === 404) return []
  if (!res.ok) throw new Error(describeGithubHttpFailure(stage, res.status, res.statusText))
  const items = await githubStage(`${stage} response JSON`, () => res.json()) as Array<{ name?: string; type?: string }>
  return Array.isArray(items) ? items.filter(i => i.type === 'file' && typeof i.name === 'string').map(i => i.name as string) : []
}

/** Which sims NEXUS has already learned, so viewing a run twice does not record it twice. */
export const SIM_LEARNED_KEY = 'nexus_sim_learned_v1'
const SIM_LEARNED_KEPT = 300

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** What NEXUS learns from one sim record: the run's shape and outcome, never its poll as a fact. */
export function simLearningInput(record: SimRecord): SimRunLearningInput | null {
  const card = record.key?.card_id, ticker = record.key?.market_ticker
  if (!card || !ticker || typeof record.attempt !== 'number') return null
  const cfg = (record.config || {}) as Record<string, unknown>
  return {
    simKey: `${card}/${ticker}/${record.attempt}`,
    invocationId: record.invocation_id || '',
    status: record.status || 'unknown',
    reason: (record.reason || '').slice(0, 300),
    preset: typeof cfg.preset === 'string' ? cfg.preset : 'unknown',
    model: typeof cfg.engine_label === 'string' ? cfg.engine_label : typeof cfg.llm_model === 'string' ? cfg.llm_model : 'unknown',
    packetSha256: record.seed?.packet_sha256 || '',
    packetChars: num(record.seed?.packet_chars),
    agents: num(cfg.agents_prepared),
    simulatedActions: num(cfg.simulated_actions),
    reloggedSeedPosts: num(cfg.relogged_seed_posts_dropped),
    pollAnswered: num(record.extraction?.n),
    costUsd: num(record.usage?.cost_usd),
    calls: num(record.usage?.calls),
    runUrl: record.artifacts?.run_url || '',
  }
}

/** Records a sim run in NEXUS once (an unapproved learning candidate). True when it was recorded now. Never throws. */
export async function learnFromSim(record: SimRecord): Promise<boolean> {
  const input = simLearningInput(record)
  if (!input) return false
  let learned: string[] = []
  try { learned = JSON.parse(safeGetItem(SIM_LEARNED_KEY) || '[]') as string[] } catch { learned = [] }
  if (!Array.isArray(learned)) learned = []
  if (learned.includes(input.simKey)) return false
  try {
    await appendSimRunLearning(input)
  } catch (error) {
    console.warn(`[mirofish] NEXUS could not record ${input.simKey}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  safeSetItem(SIM_LEARNED_KEY, JSON.stringify([...learned, input.simKey].slice(-SIM_LEARNED_KEPT)))
  return true
}

/** A browser-displayable data URL for the runner's world SVG, or null for anything that is not a plain, small SVG. */
export function svgDataUrl(svg: string): string | null {
  const trimmed = svg.trim()
  const bytes = new TextEncoder().encode(trimmed)
  if (!/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(trimmed) || bytes.length > SIM_MAX_SVG_BYTES) return null
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v}` : '—')

/** The report's first section, as a short excerpt for the chat (the full report is on the sim-results branch). */
export function reportExcerpt(markdown: string, maxChars = 700): string {
  const body = markdown.replace(/^#\s+[^\n]*\n+/, '').trim()
  const cut = body.length > maxChars ? `${body.slice(0, maxChars).replace(/\s+\S*$/, '')}…` : body
  return cut.replace(/\n{3,}/g, '\n\n')
}

/** What the model reads (and the owner sees in the trace): the record in plain lines. `worldId` is set when the image was registered. */
export function formatSimResult(result: SimResult, owner: string, repo: string, worldId?: string): string {
  const r = result.record
  const [a, b] = r.sides || ['A', 'B']
  const cfg = (r.config || {}) as Record<string, unknown>
  const ex = r.extraction
  const u = r.usage || {}
  const dir = `https://github.com/${owner}/${repo}/blob/${SIM_RESULTS_BRANCH}/${result.recordPath.split('/')[0]}`
  const lines = [
    `MiroFish sim ${r.key?.card_id ?? ''} / ${r.key?.market_ticker ?? ''}, attempt ${r.attempt ?? '?'}: ${r.status ?? 'unknown'}${r.reason ? ` (${r.reason})` : ''}`,
    `Agents: ${pct(cfg.agents_prepared)} · rounds run ${pct(cfg.rounds_run)} (${pct(cfg.active_rounds_run)} in which agents could act) · agent actions ${pct(cfg.simulated_actions)}`,
  ]
  if (ex && typeof ex.n === 'number') {
    lines.push(`Final poll: ${ex.n} answered · ${a} ${ex.picks?.A ?? 0} / ${b} ${ex.picks?.B ?? 0} · median P(${a}) ${pct(ex.median_p_a)} · IQR ${pct(ex.iqr_p_a)} · unparsed ${ex.unparsed ?? 0}`)
  }
  if (r.yes_side && typeof r.lean_for_yes_side === 'number') lines.push(`Lean for the YES side (${r.yes_side}): ${r.lean_for_yes_side}`)
  const base = r.baseline_direct
  if (base && base.parsed) lines.push(`Baseline (one direct model call on the same packet): ${base.pick === 'A' ? a : base.pick === 'B' ? b : base.pick}, P(${a}) ${pct(base.p_a)}`)
  lines.push(`Cost: $${typeof u.cost_usd === 'number' ? u.cost_usd.toFixed(4) : '—'} upper bound, ${u.calls ?? '—'} model calls, ceiling $${u.ceiling_usd ?? '—'}${u.ceiling_hit ? ' (reached)' : ''} · Zep graph deleted: ${r.zep?.deleted === true ? 'yes' : r.zep?.deleted === false ? 'NO' : 'unknown'}`)
  if (r.nexus) lines.push(`Intake line: ${r.nexus.emitted ? 'filed' : r.nexus.reason ?? 'not filed'}`)
  if (result.report) lines.push('', 'Report (opening, MiroFish\'s own narrative; never a source of numbers):', reportExcerpt(result.report))
  lines.push('', `Files: ${dir}`)
  if (r.artifacts?.run_url) lines.push(`Run: ${r.artifacts.run_url}`)
  lines.push('The agents are simulated personas built from the packet; the poll is a measurement of them, not independent evidence.')
  if (worldId) lines.push(`${SIM_WORLD_MARKER} ${worldId}`)
  else if (r.status === 'completed') lines.push('The world image could not be shown (no world.svg was published for this attempt).')
  return lines.join('\n')
}
