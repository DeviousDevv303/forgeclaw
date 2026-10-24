// @vitest-environment node
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { beforeEach, describe, expect, it } from 'vitest'
import { CorpusRepository } from './corpus'
import {
  intakeAutoAdmit,
  intakeCandidateInput,
  intakeDedupeKey,
  intakeOwnerAutoAdmit,
  parseNexusIntake,
  parseNexusIntakeLine,
  parseSimIntake,
  simOutcomeRecordProblem,
  simRunRecordProblem,
  syncNexusIntake,
  validateSimOutcomeRecord,
  validateSimRunRecord,
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

const SIM_RUN = {
  ts: '2026-10-24T18:00:00.000Z',
  source: 'mirofish-runner',
  run_id: 'sim-20261024-yan',
  kind: 'sim-run',
  ref: 'KXUFCFIGHT-26OCT24YANDVA-YAN',
  position_ref: 'pos-yan-1',
  seed: { stats_snapshot: 'kalshi-snapshot-2026-10-24T17:00Z', matchup_read: true, human_state: false },
  engine: {
    agents: 25,
    model: 'kimi-k2',
    rounds: 12,
    mirofish_commit: '0123456789abcdef0123456789abcdef01234567',
    image_digest: `sha256:${'a'.repeat(64)}`,
  },
  median_lean_pct: 62,
  side: 'YES',
  report: 'https://example.invalid/sim-reports/sim-20261024-yan',
}

const SIM_OUTCOME = {
  ts: '2026-10-25T04:00:00.000Z',
  source: 'mirofish-runner',
  run_id: 'sim-20261024-yan',
  kind: 'sim-outcome',
  ref: 'KXUFCFIGHT-26OCT24YANDVA-YAN',
  winning_side: 'YES',
}

describe('MiroFish sim records (same intake stream, typed side-parse)', () => {
  it('a complete sim-run validates and normalizes', () => {
    const run = validateSimRunRecord(SIM_RUN)
    expect(run).not.toBeNull()
    expect(run!.runId).toBe('sim-20261024-yan')
    expect(run!.marketRef).toBe('KXUFCFIGHT-26OCT24YANDVA-YAN')
    expect(run!.positionRef).toBe('pos-yan-1')
    expect(run!.seed).toEqual({ statsSnapshot: 'kalshi-snapshot-2026-10-24T17:00Z', matchupRead: true, humanState: false })
    expect(run!.engine.mirofishCommit).toBe('0123456789abcdef0123456789abcdef01234567')
    expect(run!.engine.imageDigest).toBe(`sha256:${'a'.repeat(64)}`)
    expect(run!.medianLeanPct).toBe(62)
    expect(run!.side).toBe('YES')
    expect(simRunRecordProblem(SIM_RUN)).toBeNull()
  })

  it('a sim-run missing its image digest pin is invalid, and the problem names the pin', () => {
    const engine: Record<string, unknown> = { ...SIM_RUN.engine }
    delete engine.image_digest
    const unpinned = { ...SIM_RUN, engine }
    expect(validateSimRunRecord(unpinned)).toBeNull()
    expect(simRunRecordProblem(unpinned)).toContain('image digest pin')
  })

  it('a sim-run missing its MiroFish commit pin is invalid, and the problem names the pin', () => {
    const noCommit = { ...SIM_RUN, engine: { ...SIM_RUN.engine, mirofish_commit: '' } }
    const shortCommit = { ...SIM_RUN, engine: { ...SIM_RUN.engine, mirofish_commit: 'abc' } }
    expect(validateSimRunRecord(noCommit)).toBeNull()
    expect(validateSimRunRecord(shortCommit)).toBeNull()
    expect(simRunRecordProblem(noCommit)).toContain('commit pin')
  })

  it('seed provenance must be stated: booleans for the reads, a named snapshot or an explicit null', () => {
    expect(validateSimRunRecord({ ...SIM_RUN, seed: { ...SIM_RUN.seed, stats_snapshot: null } })).not.toBeNull()
    const seedNoSnapshot: Record<string, unknown> = { ...SIM_RUN.seed }
    delete seedNoSnapshot.stats_snapshot
    expect(validateSimRunRecord({ ...SIM_RUN, seed: seedNoSnapshot })).toBeNull()
    expect(validateSimRunRecord({ ...SIM_RUN, seed: { ...SIM_RUN.seed, matchup_read: 'yes' } })).toBeNull()
  })

  it('a median outside 0-100 is not a record', () => {
    expect(validateSimRunRecord({ ...SIM_RUN, median_lean_pct: 140 })).toBeNull()
    expect(simRunRecordProblem({ ...SIM_RUN, median_lean_pct: 140 })).toContain('median_lean_pct')
  })

  it('a sim-outcome validates against the run it settles; a missing winning side is invalid', () => {
    const outcome = validateSimOutcomeRecord(SIM_OUTCOME)
    expect(outcome).not.toBeNull()
    expect(outcome!.runId).toBe(SIM_RUN.run_id)
    expect(outcome!.winningSide).toBe('YES')
    const noWinner: Record<string, unknown> = { ...SIM_OUTCOME }
    delete noWinner.winning_side
    expect(validateSimOutcomeRecord(noWinner)).toBeNull()
    expect(simOutcomeRecordProblem(noWinner)).toContain('winning_side')
  })

  it('parseSimIntake reads the sim records out of a mixed file: malformed sim lines counted, never fatal', () => {
    const malformedSim = JSON.stringify({ ...SIM_RUN, run_id: 'sim-bad', engine: { ...SIM_RUN.engine, image_digest: 'latest' } })
    const text = [CANARY_LINE, JSON.stringify(SIM_RUN), malformedSim, 'not json at all', JSON.stringify(SIM_OUTCOME)].join('\n')
    const parsed = parseSimIntake(text)
    expect(parsed.runs).toHaveLength(1)
    expect(parsed.outcomes).toHaveLength(1)
    expect(parsed.invalidSimLines).toBe(1)
  })

  it('a refiled run_id changes nothing: the first valid record wins', () => {
    const refiled = JSON.stringify({ ...SIM_RUN, median_lean_pct: 99 })
    const parsed = parseSimIntake([JSON.stringify(SIM_RUN), refiled].join('\n'))
    expect(parsed.runs).toHaveLength(1)
    expect(parsed.runs[0].medianLeanPct).toBe(62)
  })

  it('sim lines are not corpus candidates: the generic parser finds no record in them', () => {
    expect(parseNexusIntake(JSON.stringify(SIM_RUN))).toEqual([])
    expect(parseNexusIntake(JSON.stringify(SIM_OUTCOME))).toEqual([])
  })
})
