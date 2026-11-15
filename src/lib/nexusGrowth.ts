// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS learning-growth derivation: cumulative (recorded, admitted) counts over time,
// computed from the stored corpus records themselves. Kept separate from the rendering
// component so the derivation is unit-testable and react-refresh-clean.
import type { LearningCandidate } from './corpus'

export interface GrowthPoint { t: number; total: number; admitted: number }

/**
 * Cumulative counts over time from the stored records themselves. "Recorded" steps
 * at each record's own timestamp; "admitted" steps at the record's admission time
 * (metadata.admittedAt when the admission recorded one, else its record timestamp).
 * Records with an unparseable timestamp cannot be placed on a time axis and are
 * left off the lines — they still count in the panel's totals elsewhere.
 */
export function growthSeries(candidates: LearningCandidate[]): GrowthPoint[] {
  const events: Array<[number, number, number]> = []
  for (const c of candidates) {
    const recorded = Date.parse(c.timestamp)
    if (Number.isFinite(recorded)) events.push([recorded, 1, 0])
    if (c.admissionStatus === 'approved') {
      const admittedAt = Date.parse(String(c.metadata?.admittedAt ?? ''))
      const t = Number.isFinite(admittedAt) ? admittedAt : recorded
      if (Number.isFinite(t)) events.push([t, 0, 1])
    }
  }
  events.sort((a, b) => a[0] - b[0])
  const points: GrowthPoint[] = []
  let total = 0
  let admitted = 0
  for (const [t, dTotal, dAdmitted] of events) {
    total += dTotal
    admitted += dAdmitted
    const last = points[points.length - 1]
    if (last && last.t === t) { last.total = total; last.admitted = admitted } else points.push({ t, total, admitted })
  }
  return points
}
