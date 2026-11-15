// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Spiderlings — the ledger behind the spiders on the throne rig (mounted by default in App.tsx; the ?rig=1 preview flag was removed 2026-11-10).
 *
 * Rule from the owner: no decorative spiders. A spider exists only for a real TOOL_START that has not been
 * answered, and every number on screen is counted from ledger LINES that each trace to one event:
 *   out        <- TOOL_START
 *   returned   <- TOOL_SUCCESS   (the spider returns to the throne)
 *   flagged    <- TOOL_FAILURE   (it returns trailing red thread)
 *   unresolved <- MISSION_COMPLETE / MISSION_BLOCKED / RESET while the tool had no end event
 * A spider whose start has no end past its tool's timeout is shown as UNKNOWN (never as working).
 *
 * v1 uses only the events the app already emits (src/types/forgeOps.ts); nothing here emits or stores anything.
 * Limitation, stated: events carry no run id yet (v2), so a TOOL_SUCCESS/FAILURE is paired with the OLDEST unanswered
 * TOOL_START of the same tool name. Two concurrent runs of one tool can therefore swap outcomes; counts stay right.
 */
import type { AgentEvent } from '../types/forgeOps'

export type SpiderChannel = 'browser' | 'sandbox' | 'network'
export type SpiderSource = 'live' | 'demo'

const MIN = 60_000
/**
 * Tool -> channel, and how long a start may go unanswered before the spider is shown as unknown. Timeouts come from the
 * repo's own limits: browser-agent.yml 12 min, shell-exec.yml 10 min, qwen3-8b.yml 30 min; plain network reads get 3.
 * Tools that never leave the device (memory_*, funds_*, coding_task_update, error_report, spawn_agent) have no spider.
 */
const TOOLS: Record<string, { channel: SpiderChannel; timeoutMs: number }> = {
  browser_run: { channel: 'browser', timeoutMs: 14 * MIN },
  shell_exec: { channel: 'sandbox', timeoutMs: 12 * MIN },
  shell_patch: { channel: 'sandbox', timeoutMs: 12 * MIN },
  sculpt_self: { channel: 'sandbox', timeoutMs: 12 * MIN },
  run_js: { channel: 'sandbox', timeoutMs: 2 * MIN },
  qwen_reason: { channel: 'network', timeoutMs: 31 * MIN },
  nexus_reason: { channel: 'network', timeoutMs: 21 * MIN },
  ask_qwen: { channel: 'network', timeoutMs: 31 * MIN },
  deepseek_reason: { channel: 'network', timeoutMs: 31 * MIN },
  ask_deepseek: { channel: 'network', timeoutMs: 31 * MIN },
  github_run_workflow: { channel: 'network', timeoutMs: 31 * MIN },
  mirofish_sim: { channel: 'network', timeoutMs: 31 * MIN },
  deep_research: { channel: 'network', timeoutMs: 10 * MIN },
}
const NETWORK_READS = [
  'web_search', 'http_fetch', 'analyze_image', 'generate_image', 'review_code', 'mirofish_sim_result', 'espn_fight_stats', 'weather_forecast',
  'kalshi_markets', 'kalshi_owner_prices', 'gmail_read', 'gmail_send', 'calendar_read', 'calendar_create', 'send_whatsapp',
]
for (const name of NETWORK_READS) TOOLS[name] = { channel: 'network', timeoutMs: 3 * MIN }

export function spiderChannel(tool: string): { channel: SpiderChannel; timeoutMs: number } | null {
  if (TOOLS[tool]) return TOOLS[tool]
  if (tool.startsWith('github_')) return { channel: 'network', timeoutMs: 3 * MIN }
  return null
}

export interface SpiderRun {
  id: string
  tool: string
  channel: SpiderChannel
  startedAt: number
  timeoutMs: number
  endedAt?: number
  /** ok = TOOL_SUCCESS, failed = TOOL_FAILURE, unresolved = the mission ended with no end event for this tool. */
  outcome?: 'ok' | 'failed' | 'unresolved'
  failClass?: string
}

export type LedgerKind = 'out' | 'returned' | 'flagged' | 'unresolved'
export interface LedgerLine {
  id: string
  at: number
  kind: LedgerKind
  tool: string
  channel: SpiderChannel
  runId: string
  detail?: string
}

export interface SpiderLedger {
  source: SpiderSource
  /** Date.now() when this ledger started counting (the counters are "since" this moment). */
  since: number
  seq: number
  /** Counts every line ever written, so line ids stay unique after old lines are trimmed. */
  lineSeq: number
  runs: SpiderRun[]
  lines: LedgerLine[]
}

const MAX_LINES = 500
const MAX_ENDED_RUNS = 60

export function emptyLedger(source: SpiderSource, since: number): SpiderLedger {
  return { source, since, seq: 0, lineSeq: 0, runs: [], lines: [] }
}

/** The events of `events` that come after `last` (identity, not index: the ForgeOps window slides at 60). */
export function eventsAfter(events: readonly AgentEvent[], last: AgentEvent | null): AgentEvent[] {
  if (events.length === 0) return []
  if (last === null) return events.slice()
  const idx = events.lastIndexOf(last)
  return idx >= 0 ? events.slice(idx + 1) : events.slice()
}

function trim(runs: SpiderRun[]): SpiderRun[] {
  const ended = runs.filter(r => r.endedAt !== undefined)
  if (ended.length <= MAX_ENDED_RUNS) return runs
  const drop = new Set(ended.slice(0, ended.length - MAX_ENDED_RUNS).map(r => r.id))
  return runs.filter(r => !drop.has(r.id))
}

/** Fold new events into the ledger. Pure: returns a new ledger and never mutates the one passed in. */
export function foldSpiderEvents(ledger: SpiderLedger, events: readonly AgentEvent[]): SpiderLedger {
  if (events.length === 0) return ledger
  // A ledger that starts by reading events already in the stream counts from the oldest of them.
  const since = ledger.lineSeq === 0 ? Math.min(ledger.since, events[0].timestamp) : ledger.since
  let seq = ledger.seq
  let lineSeq = ledger.lineSeq
  let runs = ledger.runs.slice()
  const lines = ledger.lines.slice()
  const line = (at: number, kind: LedgerKind, run: SpiderRun, detail?: string) => {
    lineSeq += 1
    lines.push({ id: `l${lineSeq}`, at, kind, tool: run.tool, channel: run.channel, runId: run.id, ...(detail ? { detail } : {}) })
  }
  const endAll = (at: number, why: string) => {
    runs = runs.map(r => {
      if (r.endedAt !== undefined) return r
      const done: SpiderRun = { ...r, endedAt: at, outcome: 'unresolved' }
      line(at, 'unresolved', done, why)
      return done
    })
  }
  for (const ev of events) {
    if (ev.type === 'TOOL_START') {
      const meta = spiderChannel(ev.tool)
      if (!meta) continue
      seq += 1
      const run: SpiderRun = { id: `s${seq}`, tool: ev.tool, channel: meta.channel, startedAt: ev.timestamp, timeoutMs: meta.timeoutMs }
      runs.push(run)
      line(ev.timestamp, 'out', run)
    } else if (ev.type === 'TOOL_SUCCESS' || ev.type === 'TOOL_FAILURE') {
      const i = runs.findIndex(r => r.tool === ev.tool && r.endedAt === undefined)
      if (i < 0) continue // an end with no unanswered start: nothing to return, nothing invented
      const failed = ev.type === 'TOOL_FAILURE'
      const done: SpiderRun = { ...runs[i], endedAt: ev.timestamp, outcome: failed ? 'failed' : 'ok', ...(failed ? { failClass: String(ev.failClass) } : {}) }
      runs[i] = done
      line(ev.timestamp, failed ? 'flagged' : 'returned', done, failed ? String(ev.failClass) : undefined)
    } else if (ev.type === 'MISSION_COMPLETE') endAll(ev.timestamp, 'mission completed with no end event for this tool')
    else if (ev.type === 'MISSION_BLOCKED') endAll(ev.timestamp, 'mission blocked with no end event for this tool')
    else if (ev.type === 'RESET') endAll(ev.timestamp, 'reset with no end event for this tool')
  }
  return { ...ledger, since, seq, lineSeq, runs: trim(runs), lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines }
}

export interface SpiderCounters {
  inFlight: number
  returned: number
  flagged: number
  unresolved: number
  /** Started, not answered, and past the tool's timeout: shown as unknown, never as working. */
  unknown: number
  /** Lines of kind `out`: every other counter must add up to this (see the invariant test). */
  out: number
}

export function isStale(run: SpiderRun, now: number): boolean {
  return run.endedAt === undefined && now - run.startedAt > run.timeoutMs
}

/**
 * How long the spider panel stays on screen after the last tool activity (or after it first
 * appears) before it hides. Owner's order (2026-11-10): the status strip must not sit over the
 * composer constantly — show it when a run starts, then it goes away.
 */
export const SPIDER_PANEL_LINGER_MS = 5_000

/**
 * Whether the spider panel is on screen at `now`. Visible while any run is unanswered (in
 * flight, or past its timeout and shown unknown), and for SPIDER_PANEL_LINGER_MS after the
 * most recent ledger line — so a run's start raises it and its settled outcome lingers just
 * long enough to be read. The same linger applies from the ledger's start, so the panel
 * introduces itself at mount and then clears. Display timing only: the ledger and its
 * counters are untouched.
 */
export function spiderPanelVisible(ledger: SpiderLedger, now: number, lingerMs: number = SPIDER_PANEL_LINGER_MS): boolean {
  if (ledger.runs.some(r => r.endedAt === undefined)) return true
  const lastLine = ledger.lines[ledger.lines.length - 1]
  const lastActivity = Math.max(ledger.since, lastLine ? lastLine.at : Number.NEGATIVE_INFINITY)
  return now - lastActivity < lingerMs
}

/** Counters are counted from the ledger lines and the unanswered runs, never from a separate tally. */
export function spiderCounters(ledger: SpiderLedger, now: number): SpiderCounters {
  const count = (k: LedgerKind) => ledger.lines.filter(l => l.kind === k).length
  const open = ledger.runs.filter(r => r.endedAt === undefined)
  const unknown = open.filter(r => isStale(r, now)).length
  return { inFlight: open.length - unknown, returned: count('returned'), flagged: count('flagged'), unresolved: count('unresolved'), unknown, out: count('out') }
}

export interface PanelLine { key: string; at: number; text: string; tone: 'out' | 'ok' | 'flag' | 'unknown' }

const CHANNEL_NAME: Record<SpiderChannel, string> = { browser: 'browser', sandbox: 'sandbox', network: 'network' }
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false })
export const formatClock = clock

/** The newest lines, newest first, plus a synthesized line for each unanswered run past its timeout. */
export function panelLines(ledger: SpiderLedger, now: number, limit = 6): PanelLine[] {
  const out: PanelLine[] = ledger.lines.map(l => ({
    key: l.id,
    at: l.at,
    tone: l.kind === 'out' ? 'out' : l.kind === 'returned' ? 'ok' : l.kind === 'flagged' ? 'flag' : 'unknown',
    text:
      l.kind === 'out' ? `out of the throne → ${CHANNEL_NAME[l.channel]} · ${l.tool}`
      : l.kind === 'returned' ? `returned from ${CHANNEL_NAME[l.channel]} · ${l.tool}`
      : l.kind === 'flagged' ? `flagged at ${CHANNEL_NAME[l.channel]} · ${l.tool}${l.detail ? ` · ${l.detail}` : ''}`
      : `unresolved at ${CHANNEL_NAME[l.channel]} · ${l.tool} · ${l.detail ?? 'no end event'}`,
  }))
  for (const r of ledger.runs) {
    if (isStale(r, now)) out.push({ key: `stale-${r.id}`, at: r.startedAt + r.timeoutMs, tone: 'unknown', text: `unknown at ${CHANNEL_NAME[r.channel]} · ${r.tool} · no end event since ${clock(r.startedAt)} (timeout ${Math.round(r.timeoutMs / MIN)} min)` })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit)
}
