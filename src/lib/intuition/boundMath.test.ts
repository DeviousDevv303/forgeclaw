/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

import { describe, expect, it } from 'vitest'
import { BUCKET_EDGES, BUCKET_MEANING, boundFor, bucketOf, wilsonLowerBound } from './boundMath'
import { canonicalJson, sha256Hex } from './sha256'
import { createHash } from 'node:crypto'

describe('bound math: one estimator, cold start earned', () => {
  it('reproduces the numbers the record verified (1/1 = 0.21, 7/10 = 0.40, 10/10 = 0.72)', () => {
    expect(wilsonLowerBound(1, 1)).toBeCloseTo(0.2065, 3)
    expect(wilsonLowerBound(7, 10)).toBeCloseTo(0.3968, 3)
    expect(wilsonLowerBound(10, 10)).toBeCloseTo(0.7225, 3)
  })
  it('zero evidence earns zero, and 10/10 does not equal 10000/10000', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
    expect(wilsonLowerBound(10, 10)).toBeLessThan(wilsonLowerBound(10000, 10000))
    expect(wilsonLowerBound(10000, 10000)).toBeLessThan(1)
  })
  it('rejects impossible counts rather than clamping them', () => {
    expect(() => wilsonLowerBound(3, 2)).toThrow(RangeError)
    expect(() => wilsonLowerBound(-1, 2)).toThrow(RangeError)
    expect(() => wilsonLowerBound(0.5, 2)).toThrow(RangeError)
  })
  it('buckets: cold start is low, 10/10 is mid-high, and the mapping is monotone and covers 0-7', () => {
    expect(boundFor(0, 0).bucket).toBe(0)
    expect(boundFor(1, 1).bucket).toBe(2)
    expect(boundFor(7, 10).bucket).toBe(3)
    expect(boundFor(10, 10).bucket).toBe(6)
    expect(boundFor(25, 25).bucket).toBe(7)
    let last = 0
    for (let n = 0; n <= 60; n++) { const b = boundFor(n, 60).bucket; expect(b).toBeGreaterThanOrEqual(last); last = b }
    expect(BUCKET_EDGES.length).toBe(7)
    expect(BUCKET_MEANING.length).toBe(8)
    expect(bucketOf(1)).toBe(7)
    expect(() => bucketOf(1.2)).toThrow(RangeError)
  })
})

describe('sha256 / canonical json', () => {
  it('matches node crypto, including multi-block and non-ascii input', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Jozae — ñ 🔒']) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'))
    }
  })
  it('canonical json ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }))
  })
})
