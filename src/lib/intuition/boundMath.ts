/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition, Step 0: the bound math (forgeclaw #235, Final Build Verdict, Step 0 item 3).
 *
 * ONE estimator, versioned: the Wilson score interval's lower bound at z = 1.959964 (95%, two-sided). Not a Beta-posterior
 * quantile; the two are distinct and disagree on thin classes, so the id below is part of every packet hash and a change is a
 * new named version (same law as the pack). Cold start is the point: 1/1 earns 0.21, 7/10 earns 0.40, 10/10 earns 0.72, and
 * live leverage starts at zero and is earned only from real graded records. Exact values stay app-side; the model only ever
 * sees the integer bucket.
 *
 * Estimator and bucket edges are FROZEN (Muse's ruling, forgeclaw #235 comment 6904200501). They are data, not behavior:
 * changing either means a new id, which changes every packet hash, so nothing silently re-buckets old evidence.
 */

export const ESTIMATOR_ID = 'wilson-lcb-z1.959964-v1'
const Z = 1.959964

export function wilsonLowerBound(hits: number, n: number): number {
  if (!Number.isInteger(hits) || !Number.isInteger(n) || hits < 0 || n < 0 || hits > n) {
    throw new RangeError(`wilsonLowerBound needs integers with 0 <= hits <= n (got ${hits}/${n})`)
  }
  if (n === 0) return 0
  const p = hits / n
  const z2 = Z * Z
  const denom = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const margin = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / denom)
}

export const BUCKET_EDGES_ID = 'bucket-edges-v1'
/** Lower edge of buckets 1..7 on the lower bound; bucket 0 is everything below the first edge. */
export const BUCKET_EDGES: readonly number[] = Object.freeze([0.05, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85])

/** What each bucket means statistically, written down per the freeze list (the lower bound is a hit-rate floor, not a hit rate). */
export const BUCKET_MEANING: readonly string[] = Object.freeze([
  '0: lower bound < 0.05 — no graded evidence, or evidence that does not separate from zero. No leverage.',
  '1: 0.05 <= lower bound < 0.15 — a trace of evidence. Essentially cold start.',
  '2: 0.15 <= lower bound < 0.25 — one clean hit earns this (1/1 = 0.21). Still a single observation.',
  '3: 0.25 <= lower bound < 0.40 — a few graded hits with misses on record.',
  '4: 0.40 <= lower bound < 0.55 — a majority-hit record with thin denominators (7/10 = 0.40).',
  '5: 0.55 <= lower bound < 0.70 — a solid record; the class has survived real misses.',
  '6: 0.70 <= lower bound < 0.85 — a strong record (10/10 = 0.72); needs double-digit clean denominators.',
  '7: lower bound >= 0.85 — an established record (needs roughly 25+ clean hits with no or near-no misses).',
])

export function bucketOf(lowerBound: number): number {
  if (!Number.isFinite(lowerBound) || lowerBound < 0 || lowerBound > 1) throw new RangeError(`lower bound out of range: ${lowerBound}`)
  let b = 0
  for (const edge of BUCKET_EDGES) if (lowerBound >= edge) b++
  return b
}

export interface BoundResult { hits: number; n: number; lowerBound: number; bucket: number }

export function boundFor(hits: number, n: number): BoundResult {
  const lowerBound = wilsonLowerBound(hits, n)
  return { hits, n, lowerBound, bucket: bucketOf(lowerBound) }
}
