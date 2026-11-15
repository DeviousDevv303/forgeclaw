// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Stage 3b — the NEXUS intake consumer.
 *
 * Learning records produced OUTSIDE this browser (the Tier-0 canary's suspect
 * events and the fallacy-audit pass's adjudication verdicts, both on Muse's
 * VM) are published as one JSONL file on the `nexus-intake-data` branch —
 * the same server-publish pattern as the Kalshi snapshot (kalshiServerSnapshot.ts).
 * This module fetches that file and presents each record to NEXUS through the
 * corpus module's external-candidate path. The default is a pending candidate
 * at the existing approval gate — but under the owner's auto-admission criteria
 * (Cristian, 2026-10-24; see intakeAutoAdmitMarker) a qualifying record is
 * admitted on arrival, through the corpus module's intake admission
 * (appendIntakeExperience), carrying full provenance and its class's marker:
 * INTAKE_ADMITTED_BY for an audit-adjudicated record whose loop closed, and
 * OWNER_ADMITTED_BY for the owner's own filed decision record (the second
 * class, directed by the owner the same day). A third class followed on
 * 2026-10-29: Nexus Bank live-trading records, admitted under the OWNER
 * marker by the owner's ruling that live-trading records are verified by
 * construction — live results, receipts, grades (see intakeBankAutoAdmit).
 * The criteria are the owner's rulings, implemented literally — this module
 * widens nothing beyond them:
 * canary records (raw sensor output) NEVER auto-admit, and neither does any
 * record missing a field the criteria name.
 *
 * The honesty rules are the house rules, enforced by shape, not trust:
 * - Parsing is tolerant per line: a malformed line is skipped, never thrown,
 *   never repaired into a plausible record. A line that does not carry the
 *   required shape (ts, source, kind, a subject — `check` for canary records
 *   or `ref` for audit verdicts — and a text — `evidence` or `summary`) is
 *   not a record at all. A missing run_id does not kill a record; it only
 *   bars it from auto-admission (the owner's criteria name run_id).
 * - Any fetch/transport failure reports 'unavailable' and presents NOTHING:
 *   the Nexus tab is left exactly as it was. No fake candidates, no partial
 *   credit for a half-read file the caller could not load.
 * - Dedupe is by record identity (run_id + kind + subject). A record already
 *   presented — or already admitted through the gate — is never presented
 *   twice; the seen set persists alongside the corpus state (same storage
 *   helpers corpus.ts uses), so a rejected candidate is never re-offered.
 */

import { corpusRepository, type CorpusRepository, type ShellCorpusExperienceInput } from './corpus'
import { INTAKE_ADMITTED_BY, OWNER_ADMITTED_BY } from './nexusConvergence'
import { safeGetItem, safeSetItem } from './storage'

export const NEXUS_INTAKE_URL =
  'https://raw.githubusercontent.com/DeviousDevv303/forgeclaw/nexus-intake-data/intake.jsonl'

/** Why 8s: the file is tiny and raw.githubusercontent answers in well under a second when reachable; a dead network must not hang the Nexus tab. */
export const NEXUS_INTAKE_FETCH_TIMEOUT_MS = 8_000

const SEEN_KEY = 'forgeclaw_nexus_intake_seen_v1'

/** One validated intake record, normalized across the two producer shapes. */
export interface NexusIntakeRecord {
  ts: string
  /** Producer name, e.g. 'canary' or 'fallacy-audit'. */
  source: string
  /** The producing run's ID — half of the record's identity (see intakeDedupeKey). May be '' when the producer filed none; such a record can still be a candidate but can never auto-admit (the owner's criteria name run_id). */
  runId: string
  /** Record kind, e.g. 'suspect-new', 'suspect-cleared', 'canary-failure', 'finding-confirmed'. */
  kind: string
  /** The audit ref (finding ID or check name) when the record carries one, else ''. The owner's criteria name ref, so it is tracked separately from the normalized subject. */
  ref: string
  /** What the record is about: a canary check name, or an audit finding ref. */
  subject: string
  /** The evidence line (canary) or summary (audit verdict). */
  text: string
  /** Free-text provenance from the producer (may carry a link). */
  provenance: string
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Validates one parsed JSON value into an intake record, or returns null.
 * Both producer shapes are accepted by normalizing their field names:
 * canary lines carry `check`/`evidence`; audit lines carry `ref`/`summary`.
 */
export function validateIntakeRecord(value: unknown): NexusIntakeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const ts = nonEmptyString(raw.ts)
  const source = nonEmptyString(raw.source)
  const kind = nonEmptyString(raw.kind)
  const ref = nonEmptyString(raw.ref)
  const subject = nonEmptyString(raw.check) ?? ref
  const text = nonEmptyString(raw.evidence) ?? nonEmptyString(raw.summary)
  if (!ts || !source || !kind || !subject || !text) return null
  // run_id is deliberately NOT required here: a record missing it is still a
  // record — it dedupes on kind + subject and stays a pending candidate. Only
  // auto-admission requires it (the owner's criteria name it), and that check
  // lives in intakeAutoAdmit, not in shape validation.
  return { ts, source, runId: nonEmptyString(raw.run_id) ?? '', kind, ref: ref ?? '', subject, text, provenance: typeof raw.provenance === 'string' ? raw.provenance : '' }
}

/**
 * The owner's auto-admission criteria (Cristian's ruling, 2026-10-24), applied
 * literally — ALL of them, no partial credit:
 * - source is the fallacy-audit lane: the record is an adjudication, not a
 *   sensor reading. Canary output is a claim awaiting adjudication, so a canary
 *   record never qualifies no matter its kind.
 * - kind is 'finding-confirmed' or 'suspect-cleared': the loop closed — a
 *   finding confirmed (with its fix shipped) or a suspect verified gone.
 * - run_id present: the record names the exact run that produced it, so the
 *   admission is traceable and purgeable by run.
 * - ref present: the record names WHAT was resolved (finding ID or check name).
 */
export const INTAKE_AUTO_ADMIT_SOURCE = 'fallacy-audit'
export const INTAKE_AUTO_ADMIT_KINDS: ReadonlySet<string> = new Set(['finding-confirmed', 'suspect-cleared'])

export function intakeAutoAdmit(record: NexusIntakeRecord): boolean {
  return record.source === INTAKE_AUTO_ADMIT_SOURCE
    && INTAKE_AUTO_ADMIT_KINDS.has(record.kind)
    && record.runId !== ''
    && record.ref !== ''
}

/**
 * The owner's SECOND auto-admission class (Cristian, directed 2026-10-24 over his
 * settled Yan position): a record the owner himself filed about his own decision —
 * source 'owner-decision', kind 'decision-outcome', with run_id and ref — is admitted
 * on arrival under the OWNER marker. Same discipline as the audit class (ALL fields
 * required, no partial credit), different attestation: the owner attested it, no lane
 * adjudicated it, and the marker never pretends otherwise. Any other owner-source
 * kind stays a pending candidate at the gate.
 */
export const INTAKE_AUTO_ADMIT_OWNER_SOURCE = 'owner-decision'
export const INTAKE_AUTO_ADMIT_OWNER_KINDS: ReadonlySet<string> = new Set(['decision-outcome'])

export function intakeOwnerAutoAdmit(record: NexusIntakeRecord): boolean {
  return record.source === INTAKE_AUTO_ADMIT_OWNER_SOURCE
    && INTAKE_AUTO_ADMIT_OWNER_KINDS.has(record.kind)
    && record.runId !== ''
    && record.ref !== ''
}

/**
 * The owner's THIRD auto-admission class (Cristian's ruling, 2026-10-29): Nexus
 * Bank live-trading records. The kinds are the Bank producers' kinds — the
 * counterfactual watch's graded rejected-entry outcomes ('decision-outcome',
 * filed under source 'owner-preapproved', which the owner-decision class above
 * misses on the source name alone), the molding walk's per-window records
 * ('live-molding-record') and events ('molding-event'), the first-hundred
 * campaign's unit records ('campaign-mandate'), and settled trade receipts
 * ('live-trading-record'). The owner's stated basis, in
 * his words: everything filed for live trading is based off of live results,
 * so it is verified — the records are verified by construction (live fills,
 * receipts, settlement grades), and no approval stop applies to them. Same
 * discipline as the other classes (ALL named fields required, no partial
 * credit): run_id AND a subject — a ref, or a check (the normalized subject
 * IS the record's check-or-ref) — must be present. A Bank record missing
 * either stays a pending candidate at the gate, and a shapeless one still
 * drops at validation. The class is matched on kind, not source: the Bank's
 * producers file under several source names, and the listed kinds are theirs —
 * no canary kind is among them, so canary output still never auto-admits.
 * Admitted under the OWNER marker: the class exists by the owner's direct
 * ruling, the same attestation as the owner-decision class.
 */
export const INTAKE_AUTO_ADMIT_BANK_KINDS: ReadonlySet<string> = new Set([
  'decision-outcome',
  'live-molding-record',
  'molding-event',
  'campaign-mandate',
  'live-trading-record',
])

export function intakeBankAutoAdmit(record: NexusIntakeRecord): boolean {
  return INTAKE_AUTO_ADMIT_BANK_KINDS.has(record.kind)
    && record.runId !== ''
    && (record.ref !== '' || record.subject !== '')
}

/** The admission marker a record qualifies for, or null when it stays a pending candidate. */
export function intakeAutoAdmitMarker(record: NexusIntakeRecord): string | null {
  if (intakeAutoAdmit(record)) return INTAKE_ADMITTED_BY
  if (intakeOwnerAutoAdmit(record)) return OWNER_ADMITTED_BY
  if (intakeBankAutoAdmit(record)) return OWNER_ADMITTED_BY
  return null
}

/** Parses one JSONL line; a blank or malformed line yields null, never a throw. */
export function parseNexusIntakeLine(line: string): NexusIntakeRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return validateIntakeRecord(JSON.parse(trimmed) as unknown)
  } catch {
    return null
  }
}

/** Parses a whole intake file: valid records in file order, malformed lines skipped. */
export function parseNexusIntake(text: string): NexusIntakeRecord[] {
  if (!text) return []
  return text.split('\n').flatMap(line => {
    const record = parseNexusIntakeLine(line)
    return record ? [record] : []
  })
}

/** The identity a record is deduped by: the same run reporting the same kind of thing about the same subject is one candidate. */
export function intakeDedupeKey(record: NexusIntakeRecord): string {
  return `${record.runId}|${record.kind}|${record.subject}`
}

export function loadSeenIntakeKeys(): Set<string> {
  try {
    const parsed = JSON.parse(safeGetItem(SEEN_KEY) || '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveSeenIntakeKeys(keys: Set<string>): void {
  safeSetItem(SEEN_KEY, JSON.stringify([...keys]))
}

function firstLink(text: string): string | null {
  const match = /https?:\/\/[^\s)]+/.exec(text)
  return match ? match[0] : null
}

/**
 * Maps one intake record onto the corpus module's existing external-candidate
 * input. The provenance bag doubles as candidate metadata (appendShellExperience
 * spreads it there), which is how the Nexus tab labels the candidate as
 * external intake and shows its source, kind, run_id and provenance.
 */
export function intakeCandidateInput(record: NexusIntakeRecord): ShellCorpusExperienceInput {
  const link = firstLink(record.provenance)
  return {
    input: `${record.kind}: ${record.subject}`,
    context: `nexus-intake record: source=${record.source}; run_id=${record.runId}; kind=${record.kind}; ts=${record.ts}`,
    result: record.text,
    runtime: 'nexus-intake',
    model: record.source,
    source: 'nexus-intake',
    provenance: {
      origin: 'external-intake',
      channel: 'external intake',
      tool: record.kind,
      run: record.runId,
      intakeKey: intakeDedupeKey(record),
      intakeSource: record.source,
      kind: record.kind,
      subject: record.subject,
      // The record's ref, stored under its own name (2026-11-09 fix): the
      // one-admission-per-ref rule in syncNexusIntake compares refs to refs.
      // Before this, only the subject was stored, and the admitted-ref set was
      // built from subjects — for records whose subject is a shared prose
      // check string (the Bank producers), subject-space and ref-space
      // collided.
      ...(record.ref ? { ref: record.ref } : {}),
      provenance: record.provenance,
      ...(link ? { link } : {}),
    },
  }
}

export interface NexusIntakeSource {
  /** The raw intake file text. Rejects on any transport failure; parsing is parseNexusIntake's job. */
  load(): Promise<string>
}

/** A source that reads the data branch's raw file. The fetcher is injected so tests stay offline. */
export function httpNexusIntakeSource(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  url: string = NEXUS_INTAKE_URL,
): NexusIntakeSource {
  return {
    async load() {
      const res = await fetcher(url, { headers: { Accept: 'text/plain' }, signal: AbortSignal.timeout(NEXUS_INTAKE_FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`Nexus intake answered HTTP ${res.status}.`)
      return res.text()
    },
  }
}

export interface NexusIntakeSyncResult {
  status: 'synced' | 'unavailable'
  /** Valid records read from the intake file. */
  fetched: number
  /** Records newly presented as PENDING candidates by this sync. */
  added: number
  /** Records newly AUTO-ADMITTED by this sync under the owner's criteria (intakeAutoAdmit). */
  admitted: number
  reason?: string
}

/**
 * Fetches the intake file and presents every not-yet-seen record through the
 * corpus module's external-candidate path. A record meeting ALL of one of the
 * owner's auto-admission classes (intakeAutoAdmitMarker) is admitted on arrival
 * via appendIntakeExperience, marked with its class's marker and its full
 * provenance; every other record lands as a pending candidate (admissionStatus
 * 'candidate') at the existing approval gate. A record already presented as a
 * pending candidate is upgraded to admitted when it qualifies (the declined
 * guard still vetoes). Admission is idempotent at two levels: the dedupe key
 * (run_id + kind + subject) means a refetch never re-presents or re-admits a
 * record, and — the owner's strengthened rule — a REF may be admitted at most
 * once ever PER KIND, even when the same finding arrives again under a
 * different run_id (the 2026-10-24 ledger backfill and a future audit pass can
 * both report F-0NN; it is admitted once). The per-kind scope is the
 * like-for-like reading: different kinds of record about the same ref (a
 * window's molding record, its counterfactual grade, its settled receipt) are
 * distinct knowledge and never spend each other's admission. A repeat arrival
 * of an already-admitted ref is
 * presented no further, but its dedupe key is kept OUT of the persisted seen
 * set (and any stale entry cleared): a block is not a presentation, so the
 * arrival is reconsidered on a later sync if the ref's admission is ever
 * removed — and a seen key with no presented candidate behind it (the write-off
 * the pre-fix sync left for skipped records) is reprocessed in full rather
 * than honored as a presentation. Any failure — transport, storage,
 * a broken write — reports 'unavailable' and changes nothing the tab shows
 * beyond records already fully written.
 */
export async function syncNexusIntake(
  source: NexusIntakeSource = httpNexusIntakeSource(),
  repo: CorpusRepository = corpusRepository,
): Promise<NexusIntakeSyncResult> {
  try {
    const text = await source.load()
    const records = parseNexusIntake(text)
    const seen = loadSeenIntakeKeys()
    const candidates = repo.listCandidates()
    const presentedByKey = new Map(
      candidates.flatMap(candidate => {
        const key = candidate.metadata?.intakeKey
        return typeof key === 'string' && key ? [[key, candidate] as const] : []
      }),
    )
    const presented = new Set(presentedByKey.keys())
    // Admissions already spent, as (kind, ref) pairs. This set is the
    // enforcement of "admitted at most once ever" across run_ids, scoped
    // like-for-like (2026-11-09 fix): a ref names WHAT a record is about (a
    // finding, a window), and each KIND of record about it is distinct
    // knowledge — a molding track record, a counterfactual grade, and the
    // settled trade receipt of the same window are three records, not one, so
    // one kind's admission never spends another kind's. Before the fix the set
    // was built from the admitted candidates' SUBJECTS and queried with
    // incoming records' refs, unscoped: Bank producer records all share one
    // constant check-subject and name their window only in ref, so subject-
    // space and ref-space collided and unrelated admissions spent each
    // other's refs (29 of the 375 settled-window receipts in the published
    // intake were blocked by molding/counterfactual records of the same
    // windows). Candidates admitted before refs were stored in metadata carry
    // no ref; for those, the ref is recovered from the producer run_id shape
    // when it encodes one ('nb-observer-run-<ticker>'), and otherwise the
    // subject stands in — for the audit and owner classes the subject IS the
    // ref by construction.
    const admissionKey = (kind: string, ref: string) => `${kind}|${ref}`
    const admittedRefs = new Set(
      candidates.flatMap(candidate => {
        const marker = candidate.metadata?.admittedBy
        if (marker !== INTAKE_ADMITTED_BY && marker !== OWNER_ADMITTED_BY) return []
        const kind = candidate.metadata?.kind
        if (typeof kind !== 'string' || !kind) return []
        const ref = candidate.metadata?.ref
        if (typeof ref === 'string' && ref) return [admissionKey(kind, ref)]
        const run = candidate.metadata?.run
        if (typeof run === 'string' && run.startsWith('nb-observer-run-')) {
          const derived = run.slice('nb-observer-run-'.length)
          if (derived) return [admissionKey(kind, derived)]
        }
        const subject = candidate.metadata?.subject
        return typeof subject === 'string' && subject ? [admissionKey(kind, subject)] : []
      }),
    )
    // A record with no ref has no ref-admission to spend or check; the dedupe
    // key alone governs it.
    const refSpent = (record: NexusIntakeRecord) => record.ref !== '' && admittedRefs.has(admissionKey(record.kind, record.ref))
    const spendRef = (record: NexusIntakeRecord) => { if (record.ref) admittedRefs.add(admissionKey(record.kind, record.ref)) }
    // Keys blocked by the ref rule during THIS sync: a blocked record is not
    // presented, so its key must never reach the persisted seen set — not even
    // via a duplicate line later in the same file.
    const blockedThisSync = new Set<string>()
    let added = 0
    let admitted = 0
    for (const record of records) {
      const key = intakeDedupeKey(record)
      if (presented.has(key)) {
        // Already presented. One exception, and it is the point of the owner's
        // classes: a record that was presented as a PENDING candidate before it
        // qualified (e.g. it arrived before the class existed, or before the app
        // update carrying it) is upgraded to admitted when it qualifies now —
        // unless the owner declined it, which appendIntakeExperience's declined
        // guard enforces, or its ref's one admission is already spent.
        const prior = presentedByKey.get(key)
        const marker = intakeAutoAdmitMarker(record)
        if (marker && prior && prior.admissionStatus === 'candidate' && !refSpent(record)) {
          await repo.appendIntakeExperience(intakeCandidateInput(record), marker)
          spendRef(record)
          admitted += 1
        }
        if (!blockedThisSync.has(key)) seen.add(key)
        continue
      }
      // A key sitting in the persisted seen set with NO presented candidate
      // behind it is not a presentation: it is the write-off the pre-fix sync
      // left for records it skipped (the ref-collision path marked them seen),
      // and it falls through to full processing so the record is reconsidered.
      const input = intakeCandidateInput(record)
      const marker = intakeAutoAdmitMarker(record)
      if (marker) {
        if (refSpent(record)) {
          // This ref's one admission is already spent (possibly under another
          // run_id): present nothing further — and do NOT persist the key as
          // seen (2026-11-09 fix). A block is not a presentation; writing the
          // key off meant the record was never reconsidered, even after the
          // admission that spent its ref was removed. Any stale seen entry
          // for it is cleared for the same reason.
          seen.delete(key)
          presented.add(key)
          blockedThisSync.add(key)
          continue
        }
        await repo.appendIntakeExperience(input, marker)
        spendRef(record)
        admitted += 1
      } else {
        await repo.appendShellExperience(input)
        added += 1
      }
      seen.add(key)
      presented.add(key)
    }
    saveSeenIntakeKeys(seen)
    return { status: 'synced', fetched: records.length, added, admitted }
  } catch (error) {
    return { status: 'unavailable', fetched: 0, added: 0, admitted: 0, reason: error instanceof Error ? error.message : 'Nexus intake unavailable.' }
  }
}
