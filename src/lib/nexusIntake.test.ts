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
  parseNexusIntake,
  parseNexusIntakeLine,
  syncNexusIntake,
  type NexusIntakeSource,
} from './nexusIntake'
import { INTAKE_ADMITTED_BY, knowledgeOrigin } from './nexusConvergence'

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
