/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FROZEN_TEST_REGISTRY, DRAFT_REGISTRY, grade, ledgerWith, pre } from './fixtures'
import { addGrade, addRecord, allStats, statsFor, type IntuitionLedger } from './ledger'
import { PACKET_CHAR_BUDGET, buildPacket, journalPacket, renderPacket, resolvePacket } from './packet'
import { ACTIVE_REGISTRY, assertFrozen, validateRegistry, type PatternRegistry } from './patternClasses'
import { BUCKET_EDGES, BUCKET_EDGES_ID } from './boundMath'

const req = { patternClassId: 'tape.drift-consistent', regime: 'weekday-us', hypothesisRank: 1, falsifierRegistered: true, pressureEvents: 2, now: '2026-11-15T12:00:00Z' }
const build = (l: IntuitionLedger) => buildPacket(l, FROZEN_TEST_REGISTRY, req)

describe('ledger eligibility: No Signal Without Sediment', () => {
  it('cold start: no graded records means bucket 0', () => {
    const b = build(ledgerWith(0, 0))
    expect(b.text).toBe('ix1 c=00 b=0 r=1 f=1 p=2')
  })
  it('10/10 live graded records earn bucket 6; one live hit earns bucket 2', () => {
    expect(build(ledgerWith(10, 0)).entry.bucket).toBe(6)
    expect(build(ledgerWith(1, 0)).entry.bucket).toBe(2)
  })
  it('synthetic and mined-235 records, ungraded records, and unresolved grades never count', () => {
    let l = ledgerWith(1, 0)
    for (const [i, source] of (['synthetic', 'mined-235'] as const).entries()) {
      l = addRecord(l, pre(`x${i}`, { source })); l = addGrade(l, grade(`x${i}`, l.records[`x${i}`].hash, 'correct'))
    }
    l = addRecord(l, pre('u1')) // never graded
    l = addRecord(l, pre('m1')); l = addGrade(l, grade('m1', l.records.m1.hash, 'unresolved', { failureClass: 'method', methodSignature: 'timeout' }))
    const s = statsFor(l, 'tape.drift-consistent', 'test-1', 'weekday-us')
    expect([s.hits, s.n]).toEqual([1, 1])
    expect(s.excluded).toEqual({ ungraded: 1, synthetic: 1, 'mined-235': 1, unresolved: 1, tampered: 0 })
  })
  it('evidence is kept apart per regime and per registry version', () => {
    let l = ledgerWith(5, 0)
    l = addRecord(l, pre('o1', { regime: 'overnight' })); l = addGrade(l, grade('o1', l.records.o1.hash, 'incorrect'))
    expect(allStats(l).map(s => `${s.regime}:${s.hits}/${s.n}`)).toEqual(['overnight:0/1', 'weekday-us:5/5'])
    expect(statsFor(l, 'tape.drift-consistent', 'test-2', 'weekday-us').n).toBe(0)
  })
  it('records and grades are never rewritten', () => {
    const l = ledgerWith(1, 0)
    expect(() => addRecord(l, pre('r000'))).toThrow(/already sealed/)
    expect(() => addGrade(l, grade('r000', l.records.r000.hash, 'correct'))).toThrow(/already graded/)
  })
})

describe('the packet', () => {
  it('is integers only, within budget, and deterministic', () => {
    const l = ledgerWith(10, 2)
    const a = build(l), b = build(l)
    expect(a.text).toBe(b.text)
    expect(a.hash).toBe(b.hash)
    expect(a.text).toMatch(/^ix1 c=\d\d b=[0-7] r=[1-7] f=[01] p=[0-7]$/)
    expect(a.text.length).toBeLessThanOrEqual(PACKET_CHAR_BUDGET)
    expect(a.text).not.toMatch(/[.%]|strong|high|confident/i)
  })
  it('caps pressure at 7 and rejects out-of-range fields instead of clamping silently', () => {
    expect(renderPacket({ classCode: 1, bucket: 3, rank: 2, falsifier: false, pressure: 99 })).toBe('ix1 c=01 b=3 r=2 f=0 p=7')
    expect(() => renderPacket({ classCode: 1, bucket: 8, rank: 1, falsifier: true, pressure: 0 })).toThrow(RangeError)
    expect(() => renderPacket({ classCode: 1, bucket: 1, rank: 0, falsifier: true, pressure: 0 })).toThrow(RangeError)
  })
  it('refuses a draft registry unless explicitly allowed, and records that it was a draft', () => {
    expect(() => buildPacket(ledgerWith(0, 0), DRAFT_REGISTRY, req)).toThrow(/not frozen/)
    const b = buildPacket(ledgerWith(0, 0), DRAFT_REGISTRY, { ...req, allowDraft: true })
    expect(b.entry.registryStatus).toBe('draft')
  })
  it('the hash differs when the evidence behind an identical packet differs', () => {
    const a = build(ledgerWith(3, 0)), b = build(ledgerWith(3, 0, l => l))
    expect(a.hash).toBe(b.hash)
    let l2 = ledgerWith(2, 0)
    l2 = addRecord(l2, pre('zz')); l2 = addGrade(l2, grade('zz', l2.records.zz.hash, 'correct'))
    expect(build(l2).text).toBe(a.text)
    expect(build(l2).hash).not.toBe(a.hash)
  })
})

describe('harness gate: fails closed', () => {
  const journaled = () => { const l0 = ledgerWith(4, 1); const b = build(l0); return { l: journalPacket(l0, b), b } }
  it('a journaled packet resolves, with lane and provider attribution', () => {
    const { l, b } = journaled()
    const r = resolvePacket(l, FROZEN_TEST_REGISTRY, b.hash)
    expect(r.ok).toBe(true)
    expect(b.entry).toMatchObject({ hits: 4, n: 5, lanes: ['claude'], providers: ['anthropic'], estimator: 'wilson-lcb-z1.959964-v1' })
  })
  it('an unknown hash, a different registry, or a dropped record is rejected', () => {
    const { l, b } = journaled()
    expect(resolvePacket(l, FROZEN_TEST_REGISTRY, 'a'.repeat(64))).toMatchObject({ ok: false })
    expect(resolvePacket(l, { ...FROZEN_TEST_REGISTRY, version: 'test-2' }, b.hash)).toMatchObject({ ok: false, reason: expect.stringMatching(/registry/) })
    const dropped = { ...l, grades: Object.fromEntries(Object.entries(l.grades).filter(([k]) => k !== 'r000')) }
    expect(resolvePacket(dropped, FROZEN_TEST_REGISTRY, b.hash)).toMatchObject({ ok: false, reason: expect.stringMatching(/r000/) })
  })
  it('a record rewritten after the packet was issued is rejected as tampered', () => {
    const { l, b } = journaled()
    const forged = { ...l, records: { ...l.records, r001: { ...l.records.r001, hypothesis: 'rewritten' } } }
    expect(resolvePacket(forged, FROZEN_TEST_REGISTRY, b.hash)).toMatchObject({ ok: false })
  })
  it('a doctored journal entry (bucket edited) no longer matches its hash', () => {
    const { l, b } = journaled()
    const doctored = { ...l, journal: [{ ...l.journal[0], recordIds: [...l.journal[0].recordIds, 'ghost'] }] }
    expect(resolvePacket(doctored, FROZEN_TEST_REGISTRY, b.hash)).toMatchObject({ ok: false })
  })
  it('later evidence does not invalidate an earlier packet', () => {
    const { l, b } = journaled()
    let l2 = addRecord(l, pre('late')); l2 = addGrade(l2, grade('late', l2.records.late.hash, 'correct'))
    expect(resolvePacket(l2, FROZEN_TEST_REGISTRY, b.hash).ok).toBe(true)
  })
})

describe('pattern registry rules', () => {
  const good = FROZEN_TEST_REGISTRY
  it('accepts a well-formed registry', () => expect(validateRegistry(good)).toEqual([]))
  it('rejects a class with no falsifier, duplicate ids, a missing parent and a parent loop', () => {
    const bad: PatternRegistry = { version: 'x', status: 'frozen', classes: [
      { id: 'a', parent: 'b', signature: 'x'.repeat(30), asserts: 'a', falsifier: '' },
      { id: 'b', parent: 'a', signature: 'x'.repeat(30), asserts: 'a', falsifier: 'y'.repeat(30) },
      { id: 'b', parent: 'ghost', signature: 'x'.repeat(30), asserts: 'a', falsifier: 'y'.repeat(30) },
    ] }
    const e = validateRegistry(bad).join('\n')
    expect(e).toMatch(/no falsifier/); expect(e).toMatch(/duplicate class id "b"/); expect(e).toMatch(/not in the registry/); expect(e).toMatch(/loops/)
  })
})

describe('the frozen registry v1', () => {
  it('is frozen, valid, and holds Muse\'s twelve classes in order', () => {
    expect(() => assertFrozen(ACTIVE_REGISTRY)).not.toThrow()
    expect(ACTIVE_REGISTRY.version).toBe('pattern-classes-v1')
    expect(ACTIVE_REGISTRY.classes.map(c => c.id)).toEqual(['instrument-signature-mismatch', 'clean-chain-contradiction', 'thin-denominator-streak', 'regime-shift-drift', 'pressure-without-evidence', 'repeat-failure-signature', 'recognition-action-gap', 'near-boundary-adjacent', 'stale-context-answer', 'convergent-independent-signals', 'single-source-confidence', 'settled-pattern-repeat'])
    expect(BUCKET_EDGES_ID).toBe('bucket-edges-v1')
    expect(BUCKET_EDGES).toEqual([0.05, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85])
  })
})

describe('tokenizer: the bucket is one token under the deployed vocabulary', () => {
  const vocab = new Set(readFileSync(join(__dirname, '../../../nexus-llm/tokenizer/nexus.vocab'), 'utf8').split('\n').map(l => l.split('\t')[0]))
  it('digits 0-7 are whole pieces in nexus.vocab', () => { for (let d = 0; d <= 7; d++) expect(vocab.has(String(d))).toBe(true) })
  it('every character of every possible packet is a piece, so tokens <= characters <= budget', () => {
    for (let c = 0; c < 16; c++) for (let b = 0; b <= 7; b++) for (const f of [true, false]) {
      const t = renderPacket({ classCode: c, bucket: b, rank: 1, falsifier: f, pressure: 7 })
      for (const ch of t) if (ch !== ' ') expect(vocab.has(ch), `char ${JSON.stringify(ch)} of ${t}`).toBe(true)
      expect(t.length).toBeLessThanOrEqual(PACKET_CHAR_BUDGET)
    }
  })
})
