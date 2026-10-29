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
 * ('live-molding-record') and events ('molding-event'), and the first-hundred
 * campaign's unit records ('campaign-mandate'). The owner's stated basis, in
 * his words: everything filed for live trading is based off of live results,
 * so it is verified — the records are verified by construction (live fills,
 * receipts, settlement grades), and no approval stop applies to them. Same
 * discipline as the other classes (ALL named fields required, no partial
 * credit): run_id AND a subject — a ref, or a check (the normalized subject
 * IS the record's check-or-ref) — must be present. A Bank record missing
 * either stays a pending candidate at the gate, and a shapeless one still
 * drops at validation. The class is matched on kind, not source: the Bank's
 * producers file under several source names, and the four kinds are theirs —
 * no canary kind is among them, so canary output still never auto-admits.
 * Admitted under the OWNER marker: the class exists by the owner's direct
 * ruling, the same attestation as the owner-decision class.
 */
export const INTAKE_AUTO_ADMIT_BANK_KINDS: ReadonlySet<string> = new Set([
  'decision-outcome',
  'live-molding-record',
  'molding-event',
  'campaign-mandate',
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
 * once ever, even when the same finding arrives again under a different run_id
 * (the 2026-10-24 ledger backfill and a future audit pass can both report
 * F-0NN; it is admitted once). A repeat arrival of an already-admitted ref is
 * recorded as seen and presented no further. Any failure — transport, storage,
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
    // Refs already admitted under either of the owner's auto-admission classes,
    // read off the candidates carrying an admission marker (an admitted record's
    // subject IS its ref). This set is the enforcement of "admitted at most once
    // ever" across run_ids — and across classes: one ref, one admission.
    const admittedRefs = new Set(
      candidates.flatMap(candidate => {
        const subject = candidate.metadata?.subject
        const marker = candidate.metadata?.admittedBy
        return (marker === INTAKE_ADMITTED_BY || marker === OWNER_ADMITTED_BY) && typeof subject === 'string' && subject ? [subject] : []
      }),
    )
    let added = 0
    let admitted = 0
    for (const record of records) {
      const key = intakeDedupeKey(record)
      if (seen.has(key) || presented.has(key)) {
        // Already presented. One exception, and it is the point of the owner's
        // classes: a record that was presented as a PENDING candidate before it
        // qualified (e.g. it arrived before the class existed, or before the app
        // update carrying it) is upgraded to admitted when it qualifies now —
        // unless the owner declined it, which appendIntakeExperience's declined
        // guard enforces, or its ref's one admission is already spent.
        const prior = presentedByKey.get(key)
        const marker = intakeAutoAdmitMarker(record)
        if (marker && prior && prior.admissionStatus === 'candidate' && !admittedRefs.has(record.ref)) {
          await repo.appendIntakeExperience(intakeCandidateInput(record), marker)
          admittedRefs.add(record.ref)
          admitted += 1
        }
        seen.add(key)
        continue
      }
      const input = intakeCandidateInput(record)
      const marker = intakeAutoAdmitMarker(record)
      if (marker) {
        if (admittedRefs.has(record.ref)) {
          // This ref's one admission is already spent (possibly under another
          // run_id): record the arrival as seen, present nothing further.
          seen.add(key)
          presented.add(key)
          continue
        }
        await repo.appendIntakeExperience(input, marker)
        admittedRefs.add(record.ref)
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

// ── MiroFish sim records (owner GO 2026-10-24, #235 comment 6390491232) ──────
//
// The MiroFish swarm-sim lane files two record kinds into THIS SAME intake
// stream (same JSONL file, same tolerant-per-line rule — no parallel store):
// `sim-run` when a simulation is run for a position, and `sim-outcome` when
// the market it simulated settles. They are calibration records, not corpus
// prose: the generic candidate path above ignores them (they carry no
// evidence/summary text), and the typed parsers here are their only reader.
// Grading and the weight policy live in simGrading.ts.
//
// Provenance is enforced by shape, per the owner's rule: a sim-run MUST pin
// the engine it ran on — the MiroFish commit SHA and the engine image digest.
// A run missing either pin is invalid, full stop: simRunRecordProblem names
// the defect ("fails loudly"), validateSimRunRecord returns null, and
// parseSimIntake counts the line as invalid rather than repairing it into a
// plausible record. An unpinned sim can never be graded honestly later, so it
// is never allowed to become a record at all.

export const SIM_RUN_KIND = 'sim-run'
export const SIM_OUTCOME_KIND = 'sim-outcome'

/** Which seed inputs the simulation was built from — provenance, not decoration: a thin packet is labeled thin forever. */
export interface SimSeedProvenance {
  /** The stats snapshot the packet carried (id or timestamp), or null when the packet had none. */
  statsSnapshot: string | null
  /** The matchup-neutralization read was in the packet. */
  matchupRead: boolean
  /** Human-state (fighter-state) observations were in the packet. */
  humanState: boolean
}

/** The engine configuration a sim ran under. The two pins are what make the run reproducible — and therefore gradeable. */
export interface SimEngineConfig {
  /** Swarm size (agent count). */
  agents: number
  /** The model id the agents ran on; engines are graded separately, so this is part of the record's identity. */
  model: string
  /** Simulation rounds. */
  rounds: number
  /** MiroFish engine commit SHA (pin 1 of 2 — required). */
  mirofishCommit: string
  /** Engine container image digest, `sha256:<64 hex>` (pin 2 of 2 — required). */
  imageDigest: string
}

/** One validated `sim-run` record: a swarm simulation run for one position on one market. */
export interface SimRunRecord {
  ts: string
  /** Producer name, e.g. 'mirofish-runner'. */
  source: string
  /** The run's own ID — its identity, and the key a sim-outcome links back by. */
  runId: string
  kind: typeof SIM_RUN_KIND
  /** The market the sim was about: a Kalshi ticker, e.g. 'KXUFCFIGHT-26OCT24YANDVA-YAN'. */
  marketRef: string
  /** The position (or proposal) this run was made for. */
  positionRef: string
  seed: SimSeedProvenance
  engine: SimEngineConfig
  /** The swarm's median probability (0-100) that `side` wins. */
  medianLeanPct: number
  /** The side the median lean is about, as one token (e.g. 'YES', 'YAN'). */
  side: string
  /** Where the sim's illustrated report lives (URL or artifact id). A sim without its report failed half its purpose. */
  reportRef: string
}

/** One validated `sim-outcome` record: how one sim-run's market settled. Hit and distance are NOT filed here — simGrading computes them from the run and this result, the same discipline as the ledger's crowdVerdict. */
export interface SimOutcomeRecord {
  ts: string
  /** Producer name, e.g. 'mirofish-runner' or the settling lane. */
  source: string
  /** The sim-run's run_id this outcome settles. */
  runId: string
  kind: typeof SIM_OUTCOME_KIND
  /** The market ticker, matching the run's marketRef. */
  marketRef: string
  /** The side that actually won, in the same label space as the run's `side`. */
  winningSide: string
}

const SHA_RE = /^[0-9a-f]{7,40}$/i
const IMAGE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const sideToken = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' && !/\s/.test(value.trim()) && value.trim().length <= 64 ? value.trim() : null
const positiveInt = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : null

/**
 * Why a value is not a valid sim-run, or null when it is. This is the loud
 * half of the pinning rule: validation never guesses which field was meant.
 */
export function simRunRecordProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'sim-run is not an object'
  const raw = value as Record<string, unknown>
  if (raw.kind !== SIM_RUN_KIND) return 'kind is not sim-run'
  if (!nonEmptyString(raw.ts)) return 'sim-run has no ts'
  if (!nonEmptyString(raw.source)) return 'sim-run has no source'
  if (!nonEmptyString(raw.run_id)) return 'sim-run has no run_id (a sim-outcome could never link back to it)'
  if (!nonEmptyString(raw.ref)) return 'sim-run has no ref (the market it simulated)'
  if (!nonEmptyString(raw.position_ref)) return 'sim-run has no position_ref (the position it was run for)'
  const seed = raw.seed
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return 'sim-run has no seed provenance object'
  const s = seed as Record<string, unknown>
  if (typeof s.matchup_read !== 'boolean') return 'sim-run seed.matchup_read must be true or false (was the matchup read in the packet?)'
  if (typeof s.human_state !== 'boolean') return 'sim-run seed.human_state must be true or false (were human-state observations in the packet?)'
  if (!('stats_snapshot' in s) || (s.stats_snapshot !== null && !nonEmptyString(s.stats_snapshot))) {
    return 'sim-run seed.stats_snapshot must name the stats snapshot in the packet, or be null when there was none'
  }
  const engine = raw.engine
  if (!engine || typeof engine !== 'object' || Array.isArray(engine)) return 'sim-run has no engine config object'
  const e = engine as Record<string, unknown>
  if (positiveInt(e.agents, 100_000) === null) return 'sim-run engine.agents must be a positive integer (the swarm size)'
  if (!nonEmptyString(e.model)) return 'sim-run engine.model is missing (engines are graded separately; the model id is part of the record)'
  if (positiveInt(e.rounds, 100_000) === null) return 'sim-run engine.rounds must be a positive integer'
  if (typeof e.mirofish_commit !== 'string' || !SHA_RE.test(e.mirofish_commit)) {
    return 'sim-run is missing its MiroFish commit pin (engine.mirofish_commit): an unpinned sim is not a record'
  }
  if (typeof e.image_digest !== 'string' || !IMAGE_DIGEST_RE.test(e.image_digest)) {
    return 'sim-run is missing its engine image digest pin (engine.image_digest, sha256:<64 hex>): an unpinned sim is not a record'
  }
  const median = raw.median_lean_pct
  if (typeof median !== 'number' || !Number.isFinite(median) || median < 0 || median > 100) {
    return 'sim-run median_lean_pct must be a number from 0 to 100 (the swarm median, in percent)'
  }
  if (!sideToken(raw.side)) return 'sim-run side must be one token naming the side the median lean is about (e.g. YES)'
  if (!nonEmptyString(raw.report)) return 'sim-run has no report reference (URL or artifact id of the illustrated sim report)'
  return null
}

/** Validates one parsed JSON value into a sim-run record, or returns null (see simRunRecordProblem for the reason). */
export function validateSimRunRecord(value: unknown): SimRunRecord | null {
  if (simRunRecordProblem(value) !== null) return null
  const raw = value as Record<string, unknown>
  const s = raw.seed as Record<string, unknown>
  const e = raw.engine as Record<string, unknown>
  return {
    ts: raw.ts as string,
    source: raw.source as string,
    runId: raw.run_id as string,
    kind: SIM_RUN_KIND,
    marketRef: raw.ref as string,
    positionRef: raw.position_ref as string,
    seed: {
      statsSnapshot: (s.stats_snapshot as string | null) ?? null,
      matchupRead: s.matchup_read as boolean,
      humanState: s.human_state as boolean,
    },
    engine: {
      agents: e.agents as number,
      model: e.model as string,
      rounds: e.rounds as number,
      mirofishCommit: e.mirofish_commit as string,
      imageDigest: e.image_digest as string,
    },
    medianLeanPct: raw.median_lean_pct as number,
    side: sideToken(raw.side)!,
    reportRef: raw.report as string,
  }
}

/** Why a value is not a valid sim-outcome, or null when it is. */
export function simOutcomeRecordProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'sim-outcome is not an object'
  const raw = value as Record<string, unknown>
  if (raw.kind !== SIM_OUTCOME_KIND) return 'kind is not sim-outcome'
  if (!nonEmptyString(raw.ts)) return 'sim-outcome has no ts'
  if (!nonEmptyString(raw.source)) return 'sim-outcome has no source'
  if (!nonEmptyString(raw.run_id)) return 'sim-outcome has no run_id (the sim-run it settles)'
  if (!nonEmptyString(raw.ref)) return 'sim-outcome has no ref (the market that settled)'
  if (!sideToken(raw.winning_side)) return 'sim-outcome winning_side must be one token naming the side that won'
  return null
}

/** Validates one parsed JSON value into a sim-outcome record, or returns null. */
export function validateSimOutcomeRecord(value: unknown): SimOutcomeRecord | null {
  if (simOutcomeRecordProblem(value) !== null) return null
  const raw = value as Record<string, unknown>
  return {
    ts: raw.ts as string,
    source: raw.source as string,
    runId: raw.run_id as string,
    kind: SIM_OUTCOME_KIND,
    marketRef: raw.ref as string,
    winningSide: sideToken(raw.winning_side)!,
  }
}

export interface SimIntakeParse {
  runs: SimRunRecord[]
  outcomes: SimOutcomeRecord[]
  /** Lines that claimed to be sim records (kind sim-run / sim-outcome) but failed validation — counted, never repaired, never fatal. */
  invalidSimLines: number
}

/**
 * Parses the sim records out of an intake file's text, with the intake
 * family's tolerant-per-line rule: blank and non-sim lines are ignored, a
 * malformed sim line is skipped and counted, nothing throws. Identity is
 * run_id: the first valid record for a run_id wins (a run is filed once; a
 * market settles once), so a refiled duplicate changes nothing.
 */
export function parseSimIntake(text: string): SimIntakeParse {
  const runs: SimRunRecord[] = []
  const outcomes: SimOutcomeRecord[] = []
  const seenRuns = new Set<string>()
  const seenOutcomes = new Set<string>()
  let invalidSimLines = 0
  if (!text) return { runs, outcomes, invalidSimLines }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      continue // not JSON at all: not identifiable as a sim line; the generic parser skips it too
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const kind = (parsed as Record<string, unknown>).kind
    if (kind === SIM_RUN_KIND) {
      const run = validateSimRunRecord(parsed)
      if (!run) { invalidSimLines += 1; continue }
      if (seenRuns.has(run.runId)) continue
      seenRuns.add(run.runId)
      runs.push(run)
    } else if (kind === SIM_OUTCOME_KIND) {
      const outcome = validateSimOutcomeRecord(parsed)
      if (!outcome) { invalidSimLines += 1; continue }
      if (seenOutcomes.has(outcome.runId)) continue
      seenOutcomes.add(outcome.runId)
      outcomes.push(outcome)
    }
  }
  return { runs, outcomes, invalidSimLines }
}
