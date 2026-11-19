// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// NexusGrowthGraph coverage (2026-10-23): the growth display draws only the stored
// records it is handed — cumulative steps at real timestamps, admission steps at the
// recorded admission time, and a status line that names the real counts even at zero,
// so a young graph reads as young rather than blank/broken.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NexusGrowthGraph } from './NexusGrowthGraph'
import { growthSeries } from '../lib/nexusGrowth'
import type { LearningCandidate } from '../lib/corpus'

function candidate(timestamp: string, admissionStatus: string, admittedAt?: string): LearningCandidate {
  return {
    timestamp,
    admissionStatus,
    metadata: admittedAt ? { admittedAt } : {},
  } as unknown as LearningCandidate
}

const know = (timestamp: string, admittedAt?: string): { timestamp: string; metadata: Record<string, string> } => ({ timestamp, metadata: admittedAt ? { admittedAt } : {} })

describe('growthSeries', () => {
  it('plots admitted intake at its original producer timestamp, not sync time', () => {
    const points = growthSeries(
      [candidate('2026-10-24T11:00:00.000Z', 'approved')],
      [know('2026-10-24T11:00:00.000Z', '2026-10-24T11:00:00.000Z')],
    )
    expect(points).toEqual([{ t: Date.parse('2026-10-24T11:00:00.000Z'), total: 1, admitted: 1 }])
  })

  it('steps recorded at candidate timestamps and admitted at knowledge admission times', () => {
    const points = growthSeries(
      [candidate('2026-10-20T10:00:00Z', 'candidate'), candidate('2026-10-20T11:00:00Z', 'approved'), candidate('2026-10-21T12:00:00Z', 'approved')],
      [know('2026-10-20T11:00:00Z', '2026-10-21T09:00:00Z'), know('2026-10-21T12:00:00Z')], // the second has no admittedAt: its own time
    )
    expect(points.map(p => [p.total, p.admitted])).toEqual([[1, 0], [2, 0], [2, 1], [3, 2]])
  })

  it('the admitted line follows the knowledge store, not the candidates\' status', () => {
    // An approved candidate whose knowledge record was removed or evicted is not admitted knowledge any more,
    // and a legacy knowledge entry with no candidate still is.
    expect(growthSeries([candidate('2026-10-20T10:00:00Z', 'approved')], []).at(-1)).toMatchObject({ total: 1, admitted: 0 })
    expect(growthSeries([], [know('2026-10-01T10:00:00Z')]).at(-1)).toMatchObject({ total: 0, admitted: 1 })
  })

  it('leaves unplaceable timestamps off the lines', () => {
    expect(growthSeries([candidate('not-a-date', 'approved')], [know('not-a-date')])).toEqual([])
    expect(growthSeries([], [])).toEqual([])
  })
})

describe('NexusGrowthGraph', () => {
  it('labels the empty state with the real zero count instead of a blank graph', () => {
    render(<NexusGrowthGraph candidates={[]} knowledge={[]} />)
    expect(screen.getByRole('status').textContent).toContain('admitted 0 entries')
    expect(screen.getByRole('status').textContent).toContain('the graph grows as it learns')
    expect(screen.queryByTestId('nexus-growth-chart')).toBeNull()
    expect(screen.getByTestId('nexus-node-field')).toBeTruthy()
  })

  it('names the real admitted / recorded counts and draws both cumulative lines', () => {
    render(<NexusGrowthGraph candidates={[
      candidate('2026-10-20T10:00:00Z', 'candidate'),
      candidate('2026-10-21T10:00:00Z', 'approved'),
      candidate('2026-10-22T10:00:00Z', 'approved'),
    ]} knowledge={[know('2026-10-21T10:00:00Z'), know('2026-10-22T10:00:00Z')]} />)
    expect(screen.getByRole('status').textContent).toContain('holds 2 admitted knowledge entries and 3 recorded candidates')
    expect(screen.getByTestId('nexus-growth-chart')).toBeTruthy()
    const totalLine = screen.getByTestId('nexus-growth-total-line').getAttribute('d') ?? ''
    const admittedLine = screen.getByTestId('nexus-growth-admitted-line').getAttribute('d') ?? ''
    expect(totalLine).toContain('L') // stepped through the three record times
    expect(admittedLine).toContain('L')
    expect(screen.getByText(/recorded \(3\)/)).toBeTruthy()
    expect(screen.getByText(/admitted \(2\)/)).toBeTruthy()
  })
})
