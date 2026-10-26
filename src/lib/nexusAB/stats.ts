// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Small, dependency-free statistics for the NEXUS before/after harness. Honest about small samples.

/** Wilson 95% interval for a pass rate; unlike the plain normal interval it stays inside 0..1 at small n. */
export function wilson(passes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 }
  const z = 1.96
  const p = passes / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

/**
 * Exact two-sided sign test on discordant pairs: `onOnly` pairs where only the guided answer passed, `offOnly` where only
 * the unguided one did. Pairs where both agreed carry no information about the difference and are not counted.
 */
export function signTestP(onOnly: number, offOnly: number): number {
  const n = onOnly + offOnly
  if (n === 0) return 1
  const k = Math.min(onOnly, offOnly)
  // P(X <= k) for X ~ Binomial(n, 0.5), summed with a running binomial coefficient.
  let coef = 1
  let cumulative = 0
  for (let i = 0; i <= k; i++) {
    if (i > 0) coef = (coef * (n - i + 1)) / i
    cumulative += coef
  }
  return Math.min(1, (2 * cumulative) / 2 ** n)
}
