/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

import { describe, expect, it } from 'vitest'
import { grade, pre } from './fixtures'
import { sealGrade, sealRecord, validateGrade, verifyRecord, type SealedRecord } from './record'

describe('pre-outcome record', () => {
  it('seals, deep-freezes and hashes the prediction', () => {
    const r = sealRecord(pre('a'))
    expect(verifyRecord(r)).toBe(true)
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.observations)).toBe(true)
    expect(() => { (r.observations as string[]).push('later narrative') }).toThrow()
  })
  it('a copy edited after the fact fails verification', () => {
    const r = sealRecord(pre('a'))
    const forged = { ...r, hypothesis: 'knew it all along' } as SealedRecord
    expect(verifyRecord(forged)).toBe(false)
  })
  it('refuses a record with no alternatives, observations or valid confidence', () => {
    expect(() => sealRecord(pre('a', { alternatives: [] }))).toThrow(/alternative/)
    expect(() => sealRecord(pre('a', { observations: [] }))).toThrow(/observations/)
    expect(() => sealRecord(pre('a', { confidence: 1.5 }))).toThrow(/confidence/)
  })
})

describe('field 11: method failure vs hypothesis disproof', () => {
  const r = sealRecord(pre('a'))
  it('a method failure needs a mechanistic signature and leaves the intuition unresolved (run #4 clock mis-binding shape)', () => {
    const ok = grade('a', r.hash, 'unresolved', { failureClass: 'method', methodSignature: 'mis-bound-clock' })
    expect(validateGrade(ok, r)).toEqual([])
    expect(validateGrade({ ...ok, methodSignature: undefined }, r).join()).toMatch(/mechanistic signature/)
    expect(validateGrade({ ...ok, verdict: 'incorrect' }, r).join()).toMatch(/unresolved/)
  })
  it('a hypothesis disproof needs the pre-registered test run on a clean chain, and means incorrect (1830 settle shape)', () => {
    const ok = grade('a', r.hash, 'incorrect')
    expect(validateGrade(ok, r)).toEqual([])
    expect(validateGrade({ ...ok, chainClean: false }, r).join()).toMatch(/clean provenance/)
    expect(validateGrade({ ...ok, discriminatingTestRan: false }, r).join()).toMatch(/clean provenance/)
  })
  it('"incorrect" with no disproof is refused, so convincing-looking bad evidence cannot collapse a belief', () => {
    expect(validateGrade(grade('a', r.hash, 'incorrect', { failureClass: 'none' }), r).join()).toMatch(/failureClass "hypothesis"/)
  })
  it('grades name the sealed hash, carry provenance, and are never self-graded', () => {
    expect(validateGrade(grade('a', 'f'.repeat(64), 'correct'), r).join()).toMatch(/sealed hash/)
    expect(validateGrade(grade('a', r.hash, 'correct', { outcomeProvenance: [] }), r).join()).toMatch(/provenance/)
    expect(validateGrade(grade('a', r.hash, 'correct', { gradedBy: 'Claude' }), r).join()).toMatch(/own lane or provider/)
    expect(validateGrade(grade('a', r.hash, 'correct', { gradedAt: '2026-10-01T00:00:00Z' }), r).join()).toMatch(/precede/)
    expect(() => sealGrade(grade('a', r.hash, 'correct'), r)).not.toThrow()
  })
})
