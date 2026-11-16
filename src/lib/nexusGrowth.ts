// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS learning-growth derivation: cumulative (recorded, admitted) counts over time,
// computed from the stored corpus records themselves. Kept separate from the rendering
// component so the derivation is unit-testable and react-refresh-clean.
import type { LearningCandidate } from './corpus'

export interface GrowthPoint { t: number; total: number; admitted: number }

/** The part of a knowledge record the graph needs. */
export interface AdmittedEntry { timestamp: string; metadata?: Record<string, string> }

/**
 * Counts over time from what is stored now. "Recorded" steps at each stored candidate's own timestamp. "Admitted" steps at
 * each KNOWLEDGE record's admission time (metadata.admittedAt when the admission recorded one, else its timestamp).
 * The admitted line reads the knowledge store, not the candidates' status: the two can differ (a legacy entry has no
 * candidate, a removed or evicted entry can leave an approved candidate behind), and the page's "Admitted" number is the
 * knowledge count, so the line and the number are one source. Records with an unparseable time are left off the lines.
 */
export function growthSeries(candidates: LearningCandidate[], knowledge: readonly AdmittedEntry[]): GrowthPoint[] {
  const events: Array<[number, number, number]> = []
  for (const c of candidates) {
    const recorded = Date.parse(c.timestamp)
    if (Number.isFinite(recorded)) events.push([recorded, 1, 0])
  }
  for (const k of knowledge) {
    const admittedAt = Date.parse(String(k.metadata?.admittedAt ?? ''))
    const t = Number.isFinite(admittedAt) ? admittedAt : Date.parse(k.timestamp)
    if (Number.isFinite(t)) events.push([t, 0, 1])
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
