// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/**
 * REVIEWER reality checks: the Nursery's main detector (owner direction, #235 comment 6567858465).
 *
 * REVIEWER v1 run 1 graded FAIL (#235 6567582577), and the 2×2 diagnostic (#235 6568665506) found that neither
 * the prompt nor thinking mode clears the failure. The bot blesses PR bodies it never checked. These checks do
 * the checking in code. They are pure functions over the packet a review reads, so they cannot drift into
 * agreeing with the bot. The bot writes the review, and the checks say whether its verdict matches reality.
 *
 * Each check returns 'flag' (evidence says the body is wrong), 'pass' (it checked and found nothing), 'skip'
 * (the packet lacks what the check reads), or 'unverified' (it could not settle the question, e.g. a ref
 * lookup that never answered). 'unverified' is never treated as 'pass'.
 *
 * Triage is routing, never judging (Route C): a mechanical mismatch is reported here, and anything that needs
 * judgment goes to the owner. Nothing in this file promotes, admits, or rewrites a bot's output.
 */

export type ReviewVerdict =
  | 'claims-match'
  | 'claims-mismatch:lost-lines'
  | 'claims-mismatch:inflated-count'
  | 'claims-mismatch:stale-count'
  | 'claims-mismatch:self-contradiction'
  | 'claims-mismatch:unread-reply'
  | 'reject:phantom-ref'

export interface ReviewPacket {
  claims: string[]
  diff?: string
  /** Test-count enumeration, keyed as in the frozen fixtures (`enumeration_def_test_per_file[_at_base]`). */
  facts?: Record<string, unknown>
  /** Line-numbered code excerpt ("684:   const response = …"). */
  code?: string
  /** Rendered strings the claims are about, keyed by name. */
  rendered?: Record<string, string>
}

export type RefStatus = 'exists' | 'missing' | 'unknown'
export type RefResolver = (id: string) => RefStatus

export interface CheckResult {
  check: 'refs' | 'lost-lines' | 'diff-stat' | 'test-count' | 'self-contradiction' | 'unread-reply'
  status: 'flag' | 'pass' | 'skip' | 'unverified'
  /** The verdict this flag supports; set only when status is 'flag'. */
  kind?: ReviewVerdict
  /** Strings copied from the packet that carry the finding (never text the packet does not contain). */
  evidence: string[]
}

// ─── Unified diff parsing ────────────────────────────────────────────────────────────────────────
interface Hunk { file: string; header: string; added: string[]; removed: string[] }

export function parseDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  let file = ''
  let current: Hunk | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { current = null; continue }
    if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue }
    if (line.startsWith('--- ') || line.startsWith('index ')) continue
    if (line.startsWith('@@')) { current = { file, header: line, added: [], removed: [] }; hunks.push(current); continue }
    if (!current) continue
    if (line.startsWith('+')) current.added.push(line.slice(1))
    else if (line.startsWith('-')) current.removed.push(line.slice(1))
  }
  return hunks
}

// ─── 1. Every cited comment ID must resolve ──────────────────────────────────────────────────────
const COMMENT_ID = /\b\d{10}\b/g

export function checkRefs(p: ReviewPacket, resolve?: RefResolver): CheckResult {
  const ids = [...new Set(p.claims.flatMap(c => c.match(COMMENT_ID) ?? []))]
  if (!ids.length) return { check: 'refs', status: 'skip', evidence: [] }
  if (!resolve) return { check: 'refs', status: 'unverified', evidence: ids }
  const statuses = ids.map(id => [id, resolve(id)] as const)
  const missing = statuses.filter(([, s]) => s === 'missing').map(([id]) => id)
  if (missing.length) return { check: 'refs', status: 'flag', kind: 'reject:phantom-ref', evidence: missing }
  const unknown = statuses.filter(([, s]) => s === 'unknown').map(([id]) => id)
  if (unknown.length) return { check: 'refs', status: 'unverified', evidence: unknown }
  return { check: 'refs', status: 'pass', evidence: ids }
}

// ─── 2. The diff removes nothing the body does not claim to remove ──────────────────────────────
// A hunk that only removes lines, or removes far more than it adds, is code leaving the tree. It is a
// finding unless a claim says something is removed, deleted or dropped (RV-02: a "sentence-scope" body
// over a diff that deletes the Stage 2 server-snapshot wiring).
const REMOVAL_CLAIM = /\b(remov|delet|drop|strip|revert)/i
const nonBlank = (lines: string[]) => lines.filter(l => l.trim() !== '')
// Identifiers from removed lines that are worth naming as evidence (≥ 6 chars, not keywords).
const IDENT = /\b[A-Za-z_][A-Za-z0-9_]{5,}\b/g
const KEYWORDS = new Set(['export', 'return', 'import', 'function', 'const', 'string', 'number', 'undefined', 'interface', 'Promise', 'async', 'await', 'listings', 'snapshot'])

export function checkLostLines(p: ReviewPacket): CheckResult {
  if (!p.diff) return { check: 'lost-lines', status: 'skip', evidence: [] }
  const lossy = parseDiff(p.diff).filter(h => {
    const removed = nonBlank(h.removed).length
    const added = nonBlank(h.added).length
    return removed > 0 && (added === 0 || removed > 2 * added + 5)
  })
  if (!lossy.length) return { check: 'lost-lines', status: 'pass', evidence: [] }
  if (p.claims.some(c => REMOVAL_CLAIM.test(c))) return { check: 'lost-lines', status: 'pass', evidence: [] }
  const files = [...new Set(lossy.map(h => h.file))]
  const idents = [...new Set(lossy.flatMap(h => h.removed.join('\n').match(IDENT) ?? []))].filter(w => !KEYWORDS.has(w)).slice(0, 8)
  return { check: 'lost-lines', status: 'flag', kind: 'claims-mismatch:lost-lines', evidence: [...files, ...lossy.map(h => h.header), ...idents] }
}

// ─── 3. A stated "+N/−M" matches the diff ──────────────────────────────────────────────────────
const DIFF_STAT = /\+(\d+)\s*\/\s*[−-](\d+)/

export function checkDiffStat(p: ReviewPacket): CheckResult {
  const stated = p.claims.map(c => c.match(DIFF_STAT)).find(Boolean)
  if (!stated || !p.diff) return { check: 'diff-stat', status: 'skip', evidence: [] }
  const hunks = parseDiff(p.diff)
  const added = hunks.reduce((n, h) => n + h.added.length, 0)
  const removed = hunks.reduce((n, h) => n + h.removed.length, 0)
  const ok = Number(stated[1]) === added && Number(stated[2]) === removed
  return ok
    ? { check: 'diff-stat', status: 'pass', evidence: [stated[0]] }
    : { check: 'diff-stat', status: 'flag', kind: 'claims-mismatch:inflated-count', evidence: [stated[0], `+${added}/-${removed}`] }
}

// ─── 4. A stated test count matches the enumeration of the tree it is about ─────────────────────
// The tree that matters is the one the PR merges into: an `_at_base` enumeration outranks one taken on
// another commit. Claimed > actual on that tree is an inflated count; a count that equals some other
// number while the base says otherwise is stale (RV-04: 127 measured on an older tree, 151 at the base).
const TEST_COUNT = /(\d+)(\+)?\s*(?:Python\s+)?(?:tests?|test functions)\b|Ran\s+(\d+)\s+tests/gi

function enumerationTotal(facts: Record<string, unknown> | undefined): { total: number; atBase: boolean } | null {
  if (!facts) return null
  for (const [key, value] of Object.entries(facts)) {
    if (!key.startsWith('enumeration_') || !value || typeof value !== 'object') continue
    const total = (value as Record<string, unknown>).total
    if (typeof total === 'number') return { total, atBase: key.endsWith('_at_base') }
  }
  return null
}

export function checkTestCount(p: ReviewPacket): CheckResult {
  const truth = enumerationTotal(p.facts)
  if (!truth) return { check: 'test-count', status: 'skip', evidence: [] }
  const stated: Array<{ n: number; atLeast: boolean; text: string }> = []
  // In a replacement claim ("200+ tests" → "127 tests") only the text after the last arrow is asserted;
  // the text before it is what the PR replaces.
  for (const claim of p.claims) for (const m of claim.split('→').pop()!.matchAll(TEST_COUNT)) {
    const n = Number(m[1] ?? m[3])
    if (Number.isFinite(n)) stated.push({ n, atLeast: Boolean(m[2]), text: m[0] })
  }
  if (!stated.length) return { check: 'test-count', status: 'skip', evidence: [] }
  const wrong = stated.filter(s => s.atLeast ? s.n > truth.total : s.n !== truth.total)
  if (!wrong.length) return { check: 'test-count', status: 'pass', evidence: [String(truth.total)] }
  const inflated = wrong.some(s => s.n > truth.total)
  const kind: ReviewVerdict = truth.atBase && !inflated ? 'claims-mismatch:stale-count' : 'claims-mismatch:inflated-count'
  return { check: 'test-count', status: 'flag', kind, evidence: [...new Set(wrong.map(s => String(s.n))), String(truth.total)] }
}

// ─── 5. A rendered sentence does not list one item as both read and failed ─────────────────────
const READ_IN_FULL = /read the [\w/ ]*?series (.+?) in full/i
const COULD_NOT_READ = /could not read (?:series )?([A-Z0-9_, ]+)/i
const items = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

export function checkSelfContradiction(p: ReviewPacket): CheckResult {
  const texts = Object.values(p.rendered ?? {})
  if (!texts.length) return { check: 'self-contradiction', status: 'skip', evidence: [] }
  for (const t of texts) {
    const read = t.match(READ_IN_FULL)
    const failed = t.match(COULD_NOT_READ)
    if (!read || !failed) continue
    const both = items(failed[1]).filter(x => items(read[1]).includes(x))
    if (both.length) {
      // Name the code line that builds the "read" list, when the excerpt has one.
      const line = (p.code ?? '').split('\n').find(l => /seriesRead:\s*\[\.\.\./.test(l))
      return { check: 'self-contradiction', status: 'flag', kind: 'claims-mismatch:self-contradiction',
        evidence: [...both, ...(line ? [line.split(':')[0].trim()] : [])] }
    }
  }
  return { check: 'self-contradiction', status: 'pass', evidence: [] }
}

// ─── 6. A success status is never returned over a response body that was not read ──────────────
// The F-022 shape: a parse failure swallowed to {} and a success word returned anyway.
const SWALLOWED_PARSE = /\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\)\s*\)/
const SUCCESS_RETURN = /status:\s*'(synced|ok|success|done)'/

export function checkUnreadReply(p: ReviewPacket): CheckResult {
  if (!p.code) return { check: 'unread-reply', status: 'skip', evidence: [] }
  const lines = p.code.split('\n')
  const lineNo = (l: string) => l.split(':')[0].trim()
  const swallow = lines.find(l => SWALLOWED_PARSE.test(l))
  if (!swallow) return { check: 'unread-reply', status: 'pass', evidence: [] }
  const success = lines.slice(lines.indexOf(swallow) + 1).find(l => SUCCESS_RETURN.test(l))
  if (!success) return { check: 'unread-reply', status: 'pass', evidence: [] }
  return { check: 'unread-reply', status: 'flag', kind: 'claims-mismatch:unread-reply',
    evidence: [lineNo(swallow), lineNo(success), success.match(SUCCESS_RETURN)![1]] }
}

// ─── Running the battery, and comparing a bot's verdict to it ────────────────────────────────────
export function runReviewerChecks(p: ReviewPacket, resolve?: RefResolver): CheckResult[] {
  return [checkRefs(p, resolve), checkLostLines(p), checkDiffStat(p), checkTestCount(p), checkSelfContradiction(p), checkUnreadReply(p)]
}

export type Discrepancy =
  | { type: 'none' }
  /** The bot passed a body the checks found wrong: the failure this battery exists for. */
  | { type: 'false-pass'; expected: ReviewVerdict[]; evidence: string[] }
  /** The bot flagged it, with a kind no check supports. */
  | { type: 'wrong-kind'; got: string; expected: ReviewVerdict[]; evidence: string[] }
  /** The bot flagged something no check found: needs judgment, so it routes to the owner. */
  | { type: 'unsupported-flag'; got: string }
  /** A check could not settle its question; the verdict cannot be confirmed either way. */
  | { type: 'unverified'; checks: string[] }

export function compareVerdict(botVerdict: string | null, results: CheckResult[]): Discrepancy {
  const flags = results.filter(r => r.status === 'flag')
  const expected = [...new Set(flags.map(r => r.kind!))]
  const evidence = flags.flatMap(r => r.evidence)
  if (flags.length) {
    if (botVerdict === 'claims-match' || botVerdict === null) return { type: 'false-pass', expected, evidence }
    if (!expected.includes(botVerdict as ReviewVerdict)) return { type: 'wrong-kind', got: botVerdict, expected, evidence }
    return { type: 'none' }
  }
  const unverified = results.filter(r => r.status === 'unverified').map(r => r.check)
  if (unverified.length) return { type: 'unverified', checks: unverified }
  if (botVerdict !== 'claims-match') return { type: 'unsupported-flag', got: botVerdict ?? 'malformed' }
  return { type: 'none' }
}
