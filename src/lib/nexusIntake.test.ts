// @vitest-environment node
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { beforeEach, describe, expect, it } from 'vitest'
import { CorpusRepository } from './corpus'
import {
  intakeAutoAdmit,
  intakeAutoAdmitMarker,
  intakeBankAutoAdmit,
  intakeCandidateInput,
  intakeDedupeKey,
  intakeOwnerAutoAdmit,
  loadSeenIntakeKeys,
  parseNexusIntake,
  parseNexusIntakeLine,
  saveSeenIntakeKeys,
  syncNexusIntake,
  type NexusIntakeSource,
} from './nexusIntake'
import { INTAKE_ADMITTED_BY, OWNER_ADMITTED_BY, knowledgeOrigin } from './nexusConvergence'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

const CANARY_LINE = JSON.stringify({
  ts: '2026-10-24T10:10:02.359Z',
  source: 'canary',
  run_id: 'f5338bb1-5cab-457d-b20b-fb68ecfcb4b7',
  kind: 'suspect-new',
  check: 'scheduler-silence',
  evidence: 'kalshi-snapshot.yml last successful run 2026-10-24T07:17:32Z, 172 min old > 60 min silence tripwire',
  provenance: 'forgeclaw-canary v1',
})

const AUDIT_LINE = JSON.stringify({
  ts: '2026-10-24T11:00:00.000Z',
  source: 'fallacy-audit',
  run_id: 'audit-pass-37',
  kind: 'finding-confirmed',
  ref: 'F-031',
  summary: 'README line 21 contradicts line 77 on NEXUS admission',
  provenance: 'ledger §2 + https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6382826915',
})

const OWNER_LINE = JSON.stringify({
  ts: '2026-10-24T20:40:00.000Z',
  source: 'owner-decision',
  run_id: 'owner-bet-yan-ufc333-20261024',
  kind: 'decision-outcome',
  ref: 'UFC333-YAN-20261024',
  summary: 'Owner betting case study — the framework leaned Merab; the owner overrode on his own read and won.',
  provenance: 'Owner-attested in chat 2026-10-24',
})

const COUNTERFACTUAL_LINE = JSON.stringify({
  ts: '2026-10-29T18:18:46.000Z',
  source: 'owner-preapproved',
  run_id: 'owner-preapproval-nb-counterfactual-20261029-1415',
  kind: 'decision-outcome',
  ref: 'KXBTC15M-26OCT291415-15',
  summary: 'Rejected entry graded against settlement: the 1415 NO entry, rejected PRICE_BOUND at a 90.0c bound, would have WON +65c net at 7 contracts.',
  provenance: 'nb-counterfactual-watch — owner standing pre-approval 2026-10-28',
})

const MOLDING_LINE = JSON.stringify({
  ts: '2026-10-29T18:09:00.000Z',
  source: 'molding-walk',
  run_id: 'molding-walk-20261029-1309',
  kind: 'live-molding-record',
  check: 'per-window molding track record under the seated canary variant',
  ref: 'KXBTC15M-26OCT291400-00',
  summary: 'Window 1400 under the $12 mandate, seat cg-1-band-floor-tighten: evaluations stamped with the seated variant, tuning ramp+1.6 consistent, 0 fills, 2 PRICE_BOUND rejections.',
  provenance: 'owner-ordered molding walk, 2026-10-29',
})

const MOLDING_EVENT_LINE = JSON.stringify({
  ts: '2026-10-29T17:55:58.000Z',
  source: 'crew-lead-derivation',
  run_id: 'crew-lead-derivation-ceiling95-20261029',
  kind: 'molding-event',
  check: 'crew-lead derivation (owner doctrine, 2026-10-29: Muse is the loop until the loop earns it)',
  ref: 'cg-1-band-ceiling-loosen-x-floor-tighten',
  summary: 'STALL-BY-PRICE on mandate m-1793294098053-1ddd3534: derivation journaled before the seat; successor = floor-tighten tuning with entryBandHighCents 90 -> 95 only.',
  provenance: 'owner orders 2026-10-29 — first-hundred campaign, crew lead',
})

const CAMPAIGN_LINE = JSON.stringify({
  ts: '2026-10-29T17:29:02.000Z',
  source: 'hundred-campaign',
  run_id: 'campaign-adoption-m-1793294098053-20261029',
  kind: 'campaign-mandate',
  check: 'first-hundred campaign unit transition',
  ref: 'm-1793294098053-1ddd3534',
  summary: 'ADOPTED parent-issued successor: unit two closed at +7.88c net realized; successor live, $12 stake -> $100 goal, 7 contracts per entry.',
  provenance: 'owner order 2026-10-29 12:12 CDT — parent-issued successor, campaign adoption',
})

function sourceOf(text: string): NexusIntakeSource {
  return { load: () => Promise.resolve(text) }
}

describe('nexusIntake parsing', () => {
  it('parses a canary record (check/evidence shape)', () => {
    const record = parseNexusIntakeLine(CANARY_LINE)
    expect(record).not.toBeNull()
    expect(record).toMatchObject({
      source: 'canary',
      runId: 'f5338bb1-5cab-457d-b20b-fb68ecfcb4b7',
      kind: 'suspect-new',
      subject: 'scheduler-silence',
      provenance: 'forgeclaw-canary v1',
    })
    expect(record?.text).toContain('kalshi-snapshot.yml')
  })

  it('parses a fallacy-audit record (ref/summary shape) into the same fields', () => {
    const record = parseNexusIntakeLine(AUDIT_LINE)
    expect(record).toMatchObject({ source: 'fallacy-audit', runId: 'audit-pass-37', kind: 'finding-confirmed', subject: 'F-031' })
    expect(record?.text).toContain('README line 21')
  })

  it('skips malformed lines and keeps the valid ones, in order', () => {
    const text = [CANARY_LINE, '{not json', '', '{"ts":"x"}', AUDIT_LINE, '   '].join('\n')
    const records = parseNexusIntake(text)
    expect(records.map(r => r.subject)).toEqual(['scheduler-silence', 'F-031'])
  })

  it('rejects records missing any identity field', () => {
    const base = JSON.parse(CANARY_LINE) as Record<string, unknown>
    for (const field of ['ts', 'source', 'kind', 'check', 'evidence']) {
      const broken = { ...base }
      delete broken[field]
      expect(parseNexusIntakeLine(JSON.stringify(broken)), field).toBeNull()
    }
    expect(parseNexusIntakeLine('null')).toBeNull()
    expect(parseNexusIntakeLine('[1,2]')).toBeNull()
    expect(parseNexusIntakeLine('')).toBeNull()
  })

  it('tolerates a missing run_id: the record parses with an empty run id and can never auto-admit', () => {
    const broken = { ...(JSON.parse(AUDIT_LINE) as Record<string, unknown>) }
    delete broken.run_id
    const record = parseNexusIntakeLine(JSON.stringify(broken))
    expect(record?.runId).toBe('')
    expect(record && intakeAutoAdmit(record)).toBe(false)
  })

  it('parses an empty file to zero records', () => {
    expect(parseNexusIntake('')).toEqual([])
    expect(parseNexusIntake('\n\n')).toEqual([])
  })
})

describe('nexusIntake sync', () => {
  beforeEach(() => storage.clear())

  it('AUTO-ADMITS a qualifying audit record (finding-confirmed, run_id + ref) with full provenance and the owner-criteria marker', async () => {
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(AUDIT_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    const candidates = repo.listCandidates()
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]
    expect(candidate.admissionStatus).toBe('approved')
    expect(candidate.input).toBe('finding-confirmed: F-031')
    expect(candidate.generatedResult).toContain('README line 21')
    expect(candidate.source).toBe('nexus-intake')
    expect(candidate.metadata).toMatchObject({
      origin: 'external-intake',
      channel: 'external intake',
      intakeSource: 'fallacy-audit',
      kind: 'finding-confirmed',
      subject: 'F-031',
      run: 'audit-pass-37',
      intakeKey: 'audit-pass-37|finding-confirmed|F-031',
      link: 'https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6382826915',
      admittedBy: INTAKE_ADMITTED_BY,
    })
    expect(typeof candidate.metadata?.admittedAt).toBe('string')
    expect(candidate.provenance).toMatchObject({ origin: 'external-intake', intakeSource: 'fallacy-audit' })

    expect(repo.getApprovedCount()).toBe(1)
    const knowledge = repo.listKnowledge()
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].metadata).toMatchObject({
      intakeSource: 'fallacy-audit',
      kind: 'finding-confirmed',
      subject: 'F-031',
      link: 'https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-6382826915',
      admittedBy: INTAKE_ADMITTED_BY,
    })
    expect(knowledgeOrigin(knowledge[0])).toBe('AUTO-ADDED · AUDIT-ADJUDICATED')
  })

  it('AUTO-ADMITS a qualifying audit suspect-cleared record', async () => {
    const cleared = JSON.stringify({
      ts: '2026-10-24T09:00:00.000Z',
      source: 'fallacy-audit',
      run_id: 'audit-pass-40',
      kind: 'suspect-cleared',
      ref: 'snapshot-age',
      summary: 'Snapshot age back under the tripwire after the scheduled snapshot landed.',
      provenance: 'fallacy audit pass 40',
    })
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(cleared), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.getApprovedCount()).toBe(1)
    expect(repo.listKnowledge()[0].metadata?.kind).toBe('suspect-cleared')
  })

  it('keeps a canary suspect-new record PENDING at the gate — canary output never auto-admits', async () => {
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(CANARY_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
    const candidates = repo.listCandidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].admissionStatus).toBe('candidate')
    expect(candidates[0].metadata?.admittedBy).toBeUndefined()
    expect(repo.getApprovedCount()).toBe(0)
    expect(repo.listKnowledge()).toEqual([])
  })

  it('keeps an audit record missing run_id PENDING even when source and kind qualify', async () => {
    const broken = { ...(JSON.parse(AUDIT_LINE) as Record<string, unknown>) }
    delete broken.run_id
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(JSON.stringify(broken)), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
    expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
    expect(repo.getApprovedCount()).toBe(0)
    expect(repo.listKnowledge()).toEqual([])
  })

  it('AUTO-ADMITS a qualifying owner-decision record (decision-outcome, run_id + ref) under the OWNER marker — never the audit marker', async () => {
    const record = parseNexusIntakeLine(OWNER_LINE)
    expect(record && intakeAutoAdmit(record)).toBe(false)
    expect(record && intakeOwnerAutoAdmit(record)).toBe(true)
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(OWNER_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    const candidates = repo.listCandidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].admissionStatus).toBe('approved')
    expect(candidates[0].metadata).toMatchObject({
      intakeSource: 'owner-decision',
      kind: 'decision-outcome',
      subject: 'UFC333-YAN-20261024',
      run: 'owner-bet-yan-ufc333-20261024',
      admittedBy: OWNER_ADMITTED_BY,
    })
    const knowledge = repo.listKnowledge()
    expect(knowledge).toHaveLength(1)
    expect(knowledge[0].metadata?.admittedBy).toBe(OWNER_ADMITTED_BY)
    expect(knowledgeOrigin(knowledge[0])).toBe('AUTO-ADDED · OWNER-DIRECTED')
  })

  it('keeps an owner-decision record with a non-decision kind PENDING — only decision-outcome qualifies', async () => {
    const note = JSON.stringify({ ...(JSON.parse(OWNER_LINE) as Record<string, unknown>), kind: 'note' })
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(note), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
    expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
    expect(repo.listKnowledge()).toEqual([])
  })

  it('keeps an owner-decision record missing run_id PENDING', async () => {
    const broken = { ...(JSON.parse(OWNER_LINE) as Record<string, unknown>) }
    delete broken.run_id
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(JSON.stringify(broken)), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
    expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
    expect(repo.listKnowledge()).toEqual([])
  })

  it('UPGRADES an owner record that was already presented as a pending candidate (it arrived before the class existed)', async () => {
    const repo = new CorpusRepository()
    const record = parseNexusIntakeLine(OWNER_LINE)
    if (!record) throw new Error('fixture must parse')
    // Presented the way the pre-class app presented it: a pending candidate.
    await repo.appendShellExperience(intakeCandidateInput(record))
    expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
    expect(repo.listKnowledge()).toEqual([])

    const result = await syncNexusIntake(sourceOf(OWNER_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listCandidates()).toHaveLength(1)
    expect(repo.listCandidates()[0].admissionStatus).toBe('approved')
    expect(repo.listCandidates()[0].metadata?.admittedBy).toBe(OWNER_ADMITTED_BY)
    expect(repo.listKnowledge()).toHaveLength(1)
  })

  it('admits an owner ref at most once ever, even when it arrives again under a different run_id', async () => {
    const secondArrival = JSON.stringify({
      ...(JSON.parse(OWNER_LINE) as Record<string, unknown>),
      ts: '2026-10-25T20:40:00.000Z',
      run_id: 'owner-bet-yan-filed-again',
      summary: 'Same owner case filed again under another run.',
    })
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf([OWNER_LINE, secondArrival].join('\n')), repo)
    expect(result).toEqual({ status: 'synced', fetched: 2, added: 0, admitted: 1 })
    expect(repo.listKnowledge()).toHaveLength(1)
    expect(repo.getApprovedCount()).toBe(1)
  })

  it('never double-admits on refetch: the same qualifying record syncs to exactly one admission', async () => {
    const repo = new CorpusRepository()
    const first = await syncNexusIntake(sourceOf(AUDIT_LINE), repo)
    const second = await syncNexusIntake(sourceOf(AUDIT_LINE), repo)
    expect(first).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(second).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 0 })
    expect(repo.listCandidates()).toHaveLength(1)
    expect(repo.listKnowledge()).toHaveLength(1)
    expect(repo.getApprovedCount()).toBe(1)
  })

  it('admits a fallacy-audit ref at most once ever, even when it arrives again under a different run_id', async () => {
    const firstArrival = JSON.stringify({
      ts: '2026-10-24T08:00:00.000Z',
      source: 'fallacy-audit',
      run_id: 'backfill-20261024-ledger',
      kind: 'finding-confirmed',
      ref: 'F-099',
      summary: 'Finding resolved in the backfill batch.',
      provenance: 'ledger backfill',
    })
    const secondArrival = JSON.stringify({
      ts: '2026-10-25T08:00:00.000Z',
      source: 'fallacy-audit',
      run_id: 'audit-pass-41',
      kind: 'finding-confirmed',
      ref: 'F-099',
      summary: 'Same finding reported again by a later audit pass.',
      provenance: 'audit pass 41',
    })
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf([firstArrival, secondArrival].join('\n')), repo)
    expect(result).toEqual({ status: 'synced', fetched: 2, added: 0, admitted: 1 })
    expect(repo.listCandidates()).toHaveLength(1)
    expect(repo.listKnowledge()).toHaveLength(1)
    expect(repo.getApprovedCount()).toBe(1)

    // And a later sync carrying only the second arrival changes nothing.
    const again = await syncNexusIntake(sourceOf(secondArrival), repo)
    expect(again).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 0 })
    expect(repo.listKnowledge()).toHaveLength(1)
  })

  it('maps a canary record with its check as subject and the run id in context', () => {
    const record = parseNexusIntakeLine(CANARY_LINE)!
    const input = intakeCandidateInput(record)
    expect(input.input).toBe('suspect-new: scheduler-silence')
    expect(input.result).toContain('172 min old')
    expect(input.context).toContain('run_id=f5338bb1-5cab-457d-b20b-fb68ecfcb4b7')
    expect(input.provenance).toMatchObject({ intakeSource: 'canary', kind: 'suspect-new', subject: 'scheduler-silence' })
    expect(input.provenance.link).toBeUndefined()
    expect(intakeDedupeKey(record)).toBe('f5338bb1-5cab-457d-b20b-fb68ecfcb4b7|suspect-new|scheduler-silence')
  })

  it('dedupes the same run_id + kind + check: duplicate lines and repeat syncs add one candidate', async () => {
    const repo = new CorpusRepository()
    const text = [CANARY_LINE, CANARY_LINE].join('\n')
    const first = await syncNexusIntake(sourceOf(text), repo)
    expect(first).toEqual({ status: 'synced', fetched: 2, added: 1, admitted: 0 })
    const second = await syncNexusIntake(sourceOf(text), repo)
    expect(second).toEqual({ status: 'synced', fetched: 2, added: 0, admitted: 0 })
    expect(repo.listCandidates()).toHaveLength(1)
  })

  it('still dedupes when the seen set is lost but the candidate is already presented', async () => {
    const repo = new CorpusRepository()
    await syncNexusIntake(sourceOf(CANARY_LINE), repo)
    storage.removeItem('forgeclaw_nexus_intake_seen_v1')
    const result = await syncNexusIntake(sourceOf(CANARY_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 0 })
    expect(repo.listCandidates()).toHaveLength(1)
  })

  it('a different run reporting the same check is a new candidate', async () => {
    const repo = new CorpusRepository()
    const later = CANARY_LINE.replace('f5338bb1', 'aaaaaaaa')
    await syncNexusIntake(sourceOf(CANARY_LINE), repo)
    const result = await syncNexusIntake(sourceOf(later), repo)
    expect(result.added).toBe(1)
    expect(repo.listCandidates()).toHaveLength(2)
  })

  it('fetch failure reports unavailable and presents nothing — no throw, no fake candidates', async () => {
    const repo = new CorpusRepository()
    const failing: NexusIntakeSource = { load: () => Promise.reject(new Error('network down')) }
    const result = await syncNexusIntake(failing, repo)
    expect(result.status).toBe('unavailable')
    expect(result.added).toBe(0)
    expect(result.admitted).toBe(0)
    expect(result.reason).toContain('network down')
    expect(repo.listCandidates()).toHaveLength(0)
    expect(repo.getCandidateCount()).toBe(0)
  })

  it('an empty intake file syncs cleanly with nothing added', async () => {
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(''), repo)
    expect(result).toEqual({ status: 'synced', fetched: 0, added: 0, admitted: 0 })
    expect(repo.listCandidates()).toHaveLength(0)
  })
})

describe('nexusIntake Nexus Bank auto-admission (owner ruling, 2026-10-29)', () => {
  beforeEach(() => storage.clear())

  const BANK_LINES: Array<[string, string, string]> = [
    ['counterfactual decision-outcome (source owner-preapproved)', COUNTERFACTUAL_LINE, 'owner-preapproved'],
    ['molding-walk live-molding-record', MOLDING_LINE, 'molding-walk'],
    ['crew-lead molding-event', MOLDING_EVENT_LINE, 'crew-lead-derivation'],
    ['first-hundred campaign-mandate', CAMPAIGN_LINE, 'hundred-campaign'],
  ]

  const F039_RECEIPT_LINE = JSON.stringify({
    kind: 'live-trading-record',
    source: 'nexus-bank-ledger',
    run_id: 'refile-f-039-autohunt-first-fill',
    ref: 'KXBTC15M-26OCT300630-30',
    check: 'D1 order_intents + /api/status read-back by crew lead 2026-10-30 ~06:11 CDT',
    summary: 'AUTO-HUNT FIRST LIVE FILL: window 0630 NO 7 contracts, entry cashflow -518c (avg ~74c), exit cashflow +588c (avg ~84c, profit-lock shape), realized moved -239 -> -185 (net +54c after fees). Equity 817 -> 871. DIST-090 deployed same morning (PR #58, version a6173a8d) and live-verified evaluating (dist90State enabled, 0.3 bps from its threshold at read time).',
    status: 'verified',
    ts: '2026-10-30T11:11:00Z',
    original_run_id: 'autohunt-first-fill-20261030',
    provenance: 're-filed 2026-10-31 in consumer shape per F-039 option (a) (producer re-file); original line 487 in nexus-intake.jsonl; ts from the original check text, which states the read-back time as approximate (~06:11 CDT 2026-10-30)',
  })

  it('AUTO-ADMITS the F-039 settled-trade receipt under the OWNER marker', async () => {
    const record = parseNexusIntakeLine(F039_RECEIPT_LINE)
    expect(record).not.toBeNull()
    expect(record).toMatchObject({
      source: 'nexus-bank-ledger',
      runId: 'refile-f-039-autohunt-first-fill',
      kind: 'live-trading-record',
      ref: 'KXBTC15M-26OCT300630-30',
    })
    expect(record?.text).toContain('net +54c')
    expect(record && intakeBankAutoAdmit(record)).toBe(true)
    expect(record && intakeAutoAdmitMarker(record)).toBe(OWNER_ADMITTED_BY)

    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(F039_RECEIPT_LINE), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listCandidates()[0]).toMatchObject({
      admissionStatus: 'approved',
      metadata: { intakeSource: 'nexus-bank-ledger', admittedBy: OWNER_ADMITTED_BY },
    })
    expect(knowledgeOrigin(repo.listKnowledge()[0])).toBe('AUTO-ADDED · OWNER-DIRECTED')
  })

  it('keeps a live-trading receipt missing run_id pending', async () => {
    const broken = { ...(JSON.parse(F039_RECEIPT_LINE) as Record<string, unknown>) }
    delete broken.run_id
    const line = JSON.stringify(broken)
    const record = parseNexusIntakeLine(line)
    expect(record?.runId).toBe('')
    expect(record && intakeBankAutoAdmit(record)).toBe(false)
    expect(record && intakeAutoAdmitMarker(record)).toBeNull()

    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(line), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
    expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
    expect(repo.getApprovedCount()).toBe(0)
  })

  it('does not admit a live-trading receipt without ref or subject', async () => {
    const broken = { ...(JSON.parse(F039_RECEIPT_LINE) as Record<string, unknown>) }
    delete broken.ref
    delete broken.check
    const line = JSON.stringify(broken)
    expect(parseNexusIntakeLine(line)).toBeNull()

    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(line), repo)
    expect(result).toEqual({ status: 'synced', fetched: 0, added: 0, admitted: 0 })
    expect(repo.listCandidates()).toEqual([])
    expect(repo.listKnowledge()).toEqual([])
  })

  for (const [name, line, source] of BANK_LINES) {
    it(`AUTO-ADMITS a ${name} record carrying run_id + ref under the OWNER marker`, async () => {
      const record = parseNexusIntakeLine(line)
      expect(record).not.toBeNull()
      expect(record && intakeAutoAdmit(record)).toBe(false)
      expect(record && intakeBankAutoAdmit(record)).toBe(true)
      expect(record && intakeAutoAdmitMarker(record)).toBe(OWNER_ADMITTED_BY)
      const repo = new CorpusRepository()
      const result = await syncNexusIntake(sourceOf(line), repo)
      expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
      const candidates = repo.listCandidates()
      expect(candidates).toHaveLength(1)
      expect(candidates[0].admissionStatus).toBe('approved')
      expect(candidates[0].metadata).toMatchObject({ intakeSource: source, admittedBy: OWNER_ADMITTED_BY })
      const knowledge = repo.listKnowledge()
      expect(knowledge).toHaveLength(1)
      expect(knowledgeOrigin(knowledge[0])).toBe('AUTO-ADDED · OWNER-DIRECTED')
    })

    it(`keeps a ${name} record missing run_id PENDING — the class names run_id, no partial credit`, async () => {
      const broken = { ...(JSON.parse(line) as Record<string, unknown>) }
      delete broken.run_id
      const parsed = parseNexusIntakeLine(JSON.stringify(broken))
      expect(parsed?.runId).toBe('')
      expect(parsed && intakeBankAutoAdmit(parsed)).toBe(false)
      expect(parsed && intakeAutoAdmitMarker(parsed)).toBeNull()
      const repo = new CorpusRepository()
      const result = await syncNexusIntake(sourceOf(JSON.stringify(broken)), repo)
      expect(result).toEqual({ status: 'synced', fetched: 1, added: 1, admitted: 0 })
      expect(repo.listCandidates()[0].admissionStatus).toBe('candidate')
      expect(repo.getApprovedCount()).toBe(0)
      expect(repo.listKnowledge()).toEqual([])
    })
  }

  it('AUTO-ADMITS a Bank record whose subject is a check with no ref — the criteria name ref or check', async () => {
    const checkOnly = { ...(JSON.parse(MOLDING_EVENT_LINE) as Record<string, unknown>) }
    delete checkOnly.ref
    const record = parseNexusIntakeLine(JSON.stringify(checkOnly))
    expect(record?.ref).toBe('')
    expect(record?.subject).toContain('crew-lead derivation')
    expect(record && intakeBankAutoAdmit(record)).toBe(true)
    const repo = new CorpusRepository()
    const result = await syncNexusIntake(sourceOf(JSON.stringify(checkOnly)), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listKnowledge()).toHaveLength(1)
  })

  it('drops a Bank-kind record carrying neither ref nor check at validation — shapeless records never reach admission', () => {
    const shapeless = { ...(JSON.parse(MOLDING_EVENT_LINE) as Record<string, unknown>) }
    delete shapeless.ref
    delete shapeless.check
    expect(parseNexusIntakeLine(JSON.stringify(shapeless))).toBeNull()
  })

  it('drops the F-037 shape at validation: a Bank kind carrying title/status only, no subject and no text', () => {
    const f037 = JSON.stringify({
      ts: '2026-10-28T19:50:00.000Z',
      source: 'owner-decision',
      kind: 'decision-outcome',
      title: 'the habitat that never existed',
      status: 'verified',
    })
    expect(parseNexusIntakeLine(f037)).toBeNull()
  })

  it('still never auto-admits a canary record — its kinds are not Bank kinds', () => {
    const record = parseNexusIntakeLine(CANARY_LINE)
    expect(record && intakeBankAutoAdmit(record)).toBe(false)
    expect(record && intakeAutoAdmitMarker(record)).toBeNull()
  })
})

describe('nexusIntake producer-record sync (corpus sync fixes, 2026-11-09)', () => {
  beforeEach(() => storage.clear())

  // The daily producer's exact shape (observer_intake_producer.py): every
  // record carries the SAME constant check string as its subject and its own
  // window ticker as ref, with run_id 'nb-observer-run-<ticker>'.
  const PRODUCER_CHECK = 'D1 order_intents (confirmed + filled partials) + settlements + cash_adjustments read-back by observer_intake_producer'
  const producerLine = (ticker: string, summary: string, ts = '2026-11-09T15:33:17.000Z') => JSON.stringify({
    ts,
    source: 'nexus-bank',
    run_id: `nb-observer-run-${ticker}`,
    kind: 'live-trading-record',
    check: PRODUCER_CHECK,
    ref: ticker,
    summary,
    status: 'verified',
  })

  it('admits a second producer record with a different ref on a later sync, after a first one is stored', async () => {
    const repo = new CorpusRepository()
    const day1 = await syncNexusIntake(sourceOf(producerLine('KXBTC15M-26NOV090900-00', 'OBSERVER RUN 0900 settled.')), repo)
    expect(day1).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    // Day 2: the stored candidate's subject is the shared check string; the new
    // record must be judged by its own ref, not by that shared subject.
    const day2 = await syncNexusIntake(sourceOf(producerLine('KXBTC15M-26NOV090915-15', 'OBSERVER RUN 0915 settled.', '2026-11-09T15:48:17.000Z')), repo)
    expect(day2).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listKnowledge()).toHaveLength(2)
    expect(repo.getApprovedCount()).toBe(2)
  })

  it('admits different kinds of record about the same window — one kind never spends another kind’s ref', async () => {
    const repo = new CorpusRepository()
    // The molding walk's per-window record for the 0900 window lands first
    // (in the published file these precede the settled receipts).
    const molding = JSON.stringify({
      ...(JSON.parse(MOLDING_LINE) as Record<string, unknown>),
      ref: 'KXBTC15M-26NOV090900-00',
      run_id: 'molding-walk-20261109-0900',
    })
    const first = await syncNexusIntake(sourceOf(molding), repo)
    expect(first.admitted).toBe(1)
    // The producer's settled receipt for the SAME window is distinct knowledge
    // (a different kind): it must admit, not be blocked by the molding record.
    const receipt = producerLine('KXBTC15M-26NOV090900-00', 'OBSERVER RUN 0900 settled.')
    const second = await syncNexusIntake(sourceOf(receipt), repo)
    expect(second).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listKnowledge()).toHaveLength(2)
    // But a second RECEIPT for the same window under another run_id is still
    // the owner's one-admission rule, same kind + same ref: blocked.
    const refile = JSON.stringify({
      ...(JSON.parse(receipt) as Record<string, unknown>),
      run_id: 'nb-observer-run-KXBTC15M-26NOV090900-00-recheck',
      summary: 'OBSERVER RUN 0900 settled — refiled by a later pass.',
    })
    const third = await syncNexusIntake(sourceOf(refile), repo)
    expect(third.admitted).toBe(0)
    expect(repo.listKnowledge()).toHaveLength(2)
  })

  it('does not persist the seen key of a ref-blocked record, so a later sync reconsiders it', async () => {
    const repo = new CorpusRepository()
    const original = producerLine('KXBTC15M-26NOV090900-00', 'OBSERVER RUN 0900 settled.')
    const refile = JSON.stringify({
      ...(JSON.parse(original) as Record<string, unknown>),
      run_id: 'nb-observer-run-KXBTC15M-26NOV090900-00-recheck',
      summary: 'OBSERVER RUN 0900 settled — refiled by a later pass.',
    })
    const first = await syncNexusIntake(sourceOf(original), repo)
    expect(first.admitted).toBe(1)
    // Same ref under a different run_id: the one-admission-per-ref rule blocks
    // it — but a block is not a presentation, so its key must NOT be written
    // into the persisted seen set (the pre-fix code wrote it off as seen).
    const blocked = await syncNexusIntake(sourceOf(refile), repo)
    expect(blocked).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 0 })
    expect(repo.listKnowledge()).toHaveLength(1)
    const refileRecord = parseNexusIntakeLine(refile)
    if (!refileRecord) throw new Error('fixture must parse')
    expect(loadSeenIntakeKeys().has(intakeDedupeKey(refileRecord))).toBe(false)
    // Reconsidered on the next sync (still blocked while the first admission
    // stands) — and still not written off as seen.
    const again = await syncNexusIntake(sourceOf(refile), repo)
    expect(again.admitted).toBe(0)
    expect(loadSeenIntakeKeys().has(intakeDedupeKey(refileRecord))).toBe(false)
  })

  it('admits on re-sync a producer record the old collision had marked seen without ever presenting it', async () => {
    const repo = new CorpusRepository()
    const first = producerLine('KXBTC15M-26NOV090900-00', 'OBSERVER RUN 0900 settled.')
    const second = producerLine('KXBTC15M-26NOV090915-15', 'OBSERVER RUN 0915 settled.', '2026-11-09T15:48:17.000Z')
    await syncNexusIntake(sourceOf(first), repo)
    // Reproduce the pre-fix storage state: the second record's dedupe key sits
    // in the persisted seen set although it was never presented or admitted.
    const secondRecord = parseNexusIntakeLine(second)
    if (!secondRecord) throw new Error('fixture must parse')
    const seen = loadSeenIntakeKeys()
    seen.add(intakeDedupeKey(secondRecord))
    saveSeenIntakeKeys(seen)
    const result = await syncNexusIntake(sourceOf(second), repo)
    expect(result).toEqual({ status: 'synced', fetched: 1, added: 0, admitted: 1 })
    expect(repo.listKnowledge()).toHaveLength(2)
  })

  it('the knowledge list is not capped below the admitted corpus (panel display cap fix)', async () => {
    const repo = new CorpusRepository()
    const lines: string[] = []
    for (let i = 0; i < 305; i += 1) {
      lines.push(producerLine(`KXBTC15M-TEST-${i}`, `OBSERVER RUN test window ${i} settled.`))
    }
    const result = await syncNexusIntake(sourceOf(lines.join('\n')), repo)
    expect(result.admitted).toBe(305)
    expect(repo.getApprovedCount()).toBe(305)
    // The panel reads listKnowledge() with no explicit limit: all 305 admitted
    // records must come back (the pre-fix default silently cut the list at 300).
    expect(repo.listKnowledge()).toHaveLength(305)
    // An explicit smaller limit is still honored.
    expect(repo.listKnowledge(10)).toHaveLength(10)
  })
})

describe('leftover MiroFish lines (MiroFish removed 2026-11-14)', () => {
  // Earlier runs filed sim-run / sim-outcome lines into the intake stream. The sim parser is gone, so the generic parser
  // must still skip them quietly: they carry no subject or text, so they were never corpus candidates.
  it('the generic parser finds no record in an old sim-run or sim-outcome line and does not throw', () => {
    const simRun = { ts: '2026-10-24T18:00:00.000Z', source: 'mirofish-runner', run_id: 'sim-20261024-yan', kind: 'sim-run', ref: 'KXUFCFIGHT-26OCT24YANDVA-YAN', median_lean_pct: 62, side: 'YES' }
    const simOutcome = { ts: '2026-10-25T04:00:00.000Z', source: 'mirofish-runner', run_id: 'sim-20261024-yan', kind: 'sim-outcome', ref: 'KXUFCFIGHT-26OCT24YANDVA-YAN', winning_side: 'YES' }
    expect(parseNexusIntake(JSON.stringify(simRun))).toEqual([])
    expect(parseNexusIntake(JSON.stringify(simOutcome))).toEqual([])
    expect(parseNexusIntake([JSON.stringify(simRun), 'not json at all', JSON.stringify(simOutcome)].join('\n'))).toEqual([])
  })
})
