// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// A numbered request is a debt ledger: every item it enumerates is owed a rendered section before the run may end.
// 2026-10-23: a five-section repo-state report ran github_repo_state, rendered section 1 and presented as complete;
// nothing in the run driver knew four sections were still owed. This module is that missing state: the App loop asks
// it what is still owed before ending a run, and settles the final reply against it (rendered, or named unavailable).
import { cleanOutput } from './cleanOutput'
import { sanitizeChatText, errorDetail } from './userFacingErrors'
import { translate, type Lang } from './i18n'

export interface LedgerItem {
  n: number
  title: string
  /** Tool names the request names for this item, in the order they appear. */
  tools: string[]
  /** The item's own text in the request (its line and any lines under it), for matching tool arguments. */
  text: string
}

export interface RequestLedger {
  items: LedgerItem[]
}

export type LedgerItemStatus = 'rendered' | 'unavailable'

export interface SettledItem {
  n: number
  title: string
  status: LedgerItemStatus
  /** Why an unavailable item has no data (always set when status is 'unavailable'). */
  reason?: string
  /** What backs the item: each named tool with its outcome, and the run id. */
  evidence: string[]
}

export interface SettledLedger {
  items: SettledItem[]
  complete: boolean
  text: string
}

export interface LedgerToolResult {
  name: string
  output: string
  isError?: boolean
  /** The call's arguments: a result backs a section only when they match what that section asked for. */
  input?: Record<string, unknown>
}

/** Model rounds may re-ask for owed sections at most this many times per run, so a model that never renders cannot loop. */
export const MAX_LEDGER_CONTINUATIONS = 2
/** DeepSeek's CPU workflow takes 9–23 min per model step; one re-ask keeps a free-mode report from doubling its worst case. */
export const MAX_LEDGER_CONTINUATIONS_DEEPSEEK = 1

export function ledgerContinuationLimit(deepSeek: boolean): number {
  return deepSeek ? MAX_LEDGER_CONTINUATIONS_DEEPSEEK : MAX_LEDGER_CONTINUATIONS
}

const ITEM_WORD = '(?:section|secci[oó]n|step|paso|item|punto)'
const PROMPT_ITEM_RE = new RegExp(`^\\s{0,3}(?:#{1,4}\\s*)?(?:\\*\\*)?\\s*(?:${ITEM_WORD}\\s+)?(\\d{1,2})\\s*[.):]\\s*(?:\\*\\*)?\\s*(.*)$`, 'i')
const STRONG_HEADER_RE = new RegExp(`^\\s{0,3}(?:(#{1,6})\\s*|(\\*\\*)\\s*|(${ITEM_WORD})\\s+)(?:\\*\\*)?\\s*(?:${ITEM_WORD}\\s+)?(\\d{1,2})\\s*[.):\\-—]\\s*(?:\\*\\*)?\\s*(.*)$`, 'i')
const PLAIN_HEADER_RE = /^\s{0,3}(\d{1,2})\s*[.):]\s+(.*)$/
const UNAVAILABLE_RE = /^(?:unavailable|no disponible)\s*[—–:-]?\s*/i
const MAX_ITEMS = 20

/**
 * The numbered items a request enumerates (1, 2, 3 … in order, at least two), with the tools each one names.
 * A pasted file is content, not the request's shape, so an attachment prompt has no ledger.
 */
export function parseRequestLedger(prompt: string, toolNames: readonly string[]): RequestLedger | null {
  if (!prompt || /^\[File: /.test(prompt)) return null
  const lines = prompt.split(/\r?\n/)
  const starts: Array<{ line: number; n: number; title: string }> = []
  for (let i = 0; i < lines.length && starts.length < MAX_ITEMS; i++) {
    const match = PROMPT_ITEM_RE.exec(lines[i])
    if (!match || Number(match[1]) !== starts.length + 1) continue
    starts.push({ line: i, n: Number(match[1]), title: match[2] })
  }
  if (starts.length < 2) return null
  const items = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].line : lines.length
    const block = lines.slice(start.line, end).join('\n')
    const tools = toolNames
      .map(name => ({ name, at: block.search(new RegExp(`\\b${name}\\b`)) }))
      .filter(found => found.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map(found => found.name)
    return { n: start.n, title: cleanTitle(start.title) || `#${start.n}`, tools, text: block }
  })
  return { items }
}

function cleanTitle(title: string): string {
  const clean = title.replace(/\*\*/g, '').replace(/`/g, '').replace(/[:\s]+$/, '').trim()
  return clean.length > 100 ? `${clean.slice(0, 97)}...` : clean
}

/** The sections one model reply renders, keyed by item number: the header's own text and the lines under it. */
export function findRenderedSections(text: string, ledger: RequestLedger): Map<number, string> {
  const lines = (text || '').split(/\r?\n/)
  const total = ledger.items.length
  const strong = lines.map(line => {
    const match = STRONG_HEADER_RE.exec(line)
    return match ? { n: Number(match[4]), rest: match[5] } : null
  })
  // A reply that marks its sections (## 3., **3.**, Section 3:) is read by those marks only, so a plain numbered list
  // inside a section is never mistaken for the next section.
  const useStrong = strong.some(header => header && header.n >= 1 && header.n <= total)
  const headers = useStrong
    ? strong
    : lines.map(line => {
        const match = PLAIN_HEADER_RE.exec(line)
        return match ? { n: Number(match[1]), rest: match[2] } : null
      })
  const sections = new Map<number, string>()
  let last = 0
  let current: { n: number; lines: string[] } | null = null
  const flush = () => { if (current) sections.set(current.n, current.lines.join('\n').trim()) }
  lines.forEach((line, index) => {
    const header = headers[index]
    if (header && header.n > last && header.n <= total) {
      flush()
      last = header.n
      current = { n: header.n, lines: [header.rest] }
      return
    }
    current?.lines.push(line)
  })
  flush()
  return sections
}

/** Merge every round's sections; a later round that re-renders a section replaces the earlier text. */
export function collectSections(rounds: readonly string[], ledger: RequestLedger): Map<number, string> {
  const merged = new Map<number, string>()
  for (const round of rounds) {
    for (const [n, body] of findRenderedSections(round, ledger)) {
      if (hasContent(body, ledger.items[n - 1])) merged.set(n, body)
    }
  }
  return merged
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[*_`#]/g, '').replace(/\s+/g, ' ').replace(/[:.\s]+$/, '').trim()
}

/** A header that only repeats the request's title, with nothing under it, renders nothing. */
function hasContent(body: string, item: LedgerItem | undefined): boolean {
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return false
  if (lines.length > 1 || !item) return true
  return normalize(lines[0]) !== normalize(item.title)
}

/** The items no round has rendered yet. */
export function owedItems(rounds: readonly string[], ledger: RequestLedger): LedgerItem[] {
  const sections = collectSections(rounds, ledger)
  return ledger.items.filter(item => !sections.has(item.n))
}

/** Told to the model with the tools: the request's numbered shape is the reply's shape. */
export function reportFormatInstruction(ledger: RequestLedger): string {
  return [
    'REQUEST LEDGER (report mode)',
    `This request enumerates ${ledger.items.length} numbered items. Every item is owed a section in your reply, in order:`,
    ...ledger.items.map(item => `${item.n}. ${item.title}${item.tools.length ? ` [tools: ${item.tools.join(', ')}]` : ''}`),
    'Start each section with a header line "## N. <title>" using the request\'s numbering. Under it: one fact per line; list-shaped data as a markdown table (| a | b |), never raw JSON or a wrapped blob.',
    'Call the tools each section names before writing it. If a section\'s data cannot be obtained, still write its header and one line "unavailable — <reason>". Never stop before the last section.',
  ].join('\n')
}

/** Sent to the model when it ended a reply with items still owed and the run may continue. */
export function ledgerContinuationPrompt(ledger: RequestLedger, owed: readonly LedgerItem[]): string {
  const rendered = ledger.items.length - owed.length
  return [
    `REQUEST LEDGER: the request enumerates ${ledger.items.length} sections; your reply rendered ${rendered}. Still owed:`,
    ...owed.map(item => `${item.n}. ${item.title}${item.tools.length ? ` [tools: ${item.tools.join(', ')}]` : ''}`),
    'Continue now: call the tools those sections name, then render each owed section under "## N. <title>". Do not repeat sections already rendered. If a section\'s data cannot be obtained, write its header and one line "unavailable — <reason>".',
  ].join('\n')
}

type ToolOutcome = 'ok' | 'failed' | 'not-called'

function normalizeArg(value: string): string {
  return value.trim().replace(/^\.?\//, '').toLowerCase()
}

/** The call's string arguments worth matching against request text (a path, a query, a PR number). */
function argValues(input: Record<string, unknown> | undefined): string[] {
  return Object.values(input ?? {})
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(value => normalizeArg(String(value)))
    .filter(value => value.length >= 2)
}

function mentions(text: string, value: string): boolean {
  return text.toLowerCase().includes(value)
}

/**
 * The results of `name` that back this item. Evidence is keyed by tool name AND arguments: when several items name the
 * same tool, a call backs only the item whose text names its arguments (section 4 never borrows section 2's file).
 * A call whose arguments no item names backs an item only when that item is the sole one naming the tool.
 */
function resultsForItem(item: LedgerItem, name: string, ledger: RequestLedger, results: readonly LedgerToolResult[]): LedgerToolResult[] {
  const own = results.filter(result => result.name === name)
  const sharing = ledger.items.filter(other => other.tools.includes(name))
  return own.filter(result => {
    const values = argValues(result.input)
    if (values.some(value => mentions(item.text, value))) return true
    if (sharing.length === 1) return true
    // Shared tool: an argument-less call, or one whose arguments no sharing item names, cannot be attributed.
    return false
  })
}

function toolOutcome(item: LedgerItem, name: string, ledger: RequestLedger, results: readonly LedgerToolResult[]): { outcome: ToolOutcome; error?: string; calledElsewhere?: boolean } {
  const own = resultsForItem(item, name, ledger, results)
  if (own.some(result => !result.isError)) return { outcome: 'ok' }
  const failed = own.find(result => result.isError)
  if (failed) return { outcome: 'failed', error: firstLine(failed.output) }
  return { outcome: 'not-called', calledElsewhere: results.some(result => result.name === name) }
}

function firstLine(output: string): string {
  const line = output.replace(/^\[TOOL ERROR\]\s*/i, '').split('\n').find(l => l.trim()) ?? ''
  return errorDetail(line)
}

function cleanBody(body: string): string {
  return sanitizeChatText(cleanOutput(jsonBlocksToTables(body)))
}

/**
 * Settle the reply against the ledger. Every item gets a section: the model's rendering when one exists and the tools
 * it names did not all fail, otherwise "section N: unavailable — <reason>". complete is true only when every item rendered.
 */
export function settleLedger(
  ledger: RequestLedger,
  rounds: readonly string[],
  results: readonly LedgerToolResult[],
  options: { lang: Lang; runId: string },
): SettledLedger {
  const { lang, runId } = options
  const sections = collectSections(rounds, ledger)
  const blocks: string[] = []
  const items: SettledItem[] = ledger.items.map(item => {
    const outcomes = item.tools.map(name => ({ name, ...toolOutcome(item, name, ledger, results) }))
    const evidence = [
      ...outcomes.map(o => `${o.name} ${o.outcome === 'ok' ? '✓' : o.outcome === 'failed' ? '✗' : '—'}`),
      translate(lang, 'report.run', { runId }),
    ]
    const header = `${item.n}. ${item.title}`
    const unavailable = (reason: string): SettledItem => {
      blocks.push(`${header}\n${translate(lang, 'report.unavailable', { n: item.n, reason })}`)
      return { n: item.n, title: item.title, status: 'unavailable', reason, evidence }
    }
    const failed = outcomes.find(o => o.outcome === 'failed')
    const missing = outcomes.find(o => o.outcome === 'not-called')
    const toolReason = () => failed
      ? translate(lang, 'report.reason.toolFailed', { tool: failed.name, error: failed.error || '?' })
      : translate(lang, missing!.calledElsewhere ? 'report.reason.toolNotCalledFor' : 'report.reason.toolNotCalled', { tool: missing!.name })
    // A section whose named tools returned nothing for it (failed, or never called with its arguments) has no
    // evidence; the model's prose for it is not reported as data.
    if (outcomes.length > 0 && !outcomes.some(o => o.outcome === 'ok')) return unavailable(toolReason())
    const body = sections.get(item.n)
    if (body === undefined) return unavailable(translate(lang, 'report.reason.notRendered'))
    const lines = body.split('\n')
    // The header's own text is kept only when it says more than the request's title.
    if (normalize(lines[0] || '') === normalize(item.title)) lines.shift()
    const cleaned = cleanBody(lines.join('\n'))
    // The model's own "unavailable — <reason>", on the header line or the first line under it, is the item's status.
    const unavailableLine = cleaned.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).find(l => UNAVAILABLE_RE.test(l))
    if (unavailableLine) {
      return unavailable(unavailableLine.replace(UNAVAILABLE_RE, '') || translate(lang, 'report.reason.notRendered'))
    }
    // A run that used no tools has only the run id to cite; a plain numbered answer is not stamped with it.
    const cite = results.length > 0 || item.tools.length > 0
    blocks.push(`${header}\n${cleaned}${cite ? `\n${translate(lang, 'report.evidence', { sources: evidence.join(' · ') })}` : ''}`)
    return { n: item.n, title: item.title, status: 'rendered', evidence }
  })
  const missing = items.filter(item => item.status !== 'rendered').length
  if (missing > 0) blocks.push(translate(lang, 'report.incomplete', { missing, total: items.length }))
  return { items, complete: missing === 0, text: blocks.join('\n\n') }
}

// ── List-shaped data as tables ──────────────────────────────────────────────

type Cell = string | number | boolean | null
const isCell = (value: unknown): value is Cell => value === null || ['string', 'number', 'boolean'].includes(typeof value)

function cellText(value: Cell): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/** A JSON array of flat objects (or one flat object) as a markdown table; anything else is left as it was. */
export function jsonToTable(json: string): string | null {
  let data: unknown
  try { data = JSON.parse(json) } catch { return null }
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? null : undefined
  if (rows === undefined) return null
  if (rows === null) {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0 || !entries.every(([, v]) => isCell(v))) return null
    return ['| field | value |', '| --- | --- |', ...entries.map(([k, v]) => `| ${cellText(k)} | ${cellText(v as Cell)} |`)].join('\n')
  }
  if (rows.length === 0 || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.values(row).every(isCell))) return null
  const columns = [...new Set(rows.flatMap(row => Object.keys(row as object)))]
  if (columns.length === 0 || columns.length > 10) return null
  return [
    `| ${columns.map(cellText).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${columns.map(c => cellText(((row as Record<string, Cell>)[c]) ?? '')).join(' | ')} |`),
  ].join('\n')
}

/** Fenced JSON (or a body that is only JSON) becomes a table when it is list-shaped. */
export function jsonBlocksToTables(text: string): string {
  const fenced = text.replace(/```(?:json)?\s*\n([\s\S]*?)```/gi, (whole, inner: string) => jsonToTable(inner.trim()) ?? whole)
  const trimmed = fenced.trim()
  if (/^[[{]/.test(trimmed)) return jsonToTable(trimmed) ?? fenced
  return fenced
}

export type ContentSegment = { kind: 'text'; text: string } | { kind: 'table'; header: string[]; rows: string[][] }

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim())
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** Split text into plain runs and markdown pipe tables (a header row, a --- separator row, then body rows). */
export function splitPipeTables(text: string): ContentSegment[] {
  const lines = text.split('\n')
  const segments: ContentSegment[] = []
  let buffer: string[] = []
  const flushText = () => { if (buffer.length) segments.push({ kind: 'text', text: buffer.join('\n') }); buffer = [] }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      const header = splitRow(lines[i])
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim().startsWith('|')) rows.push(splitRow(lines[j++]))
      flushText()
      segments.push({ kind: 'table', header, rows })
      i = j - 1
      continue
    }
    buffer.push(lines[i])
  }
  flushText()
  return segments
}
