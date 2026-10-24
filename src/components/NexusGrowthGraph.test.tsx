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

describe('growthSeries', () => {
  it('steps recorded at record timestamps and admitted at admission times', () => {
    const points = growthSeries([
      candidate('2026-10-20T10:00:00Z', 'candidate'),
      candidate('2026-10-21T10:00:00Z', 'approved', '2026-10-22T09:00:00Z'),
      candidate('2026-10-21T12:00:00Z', 'approved'), // no admittedAt: falls back to its record timestamp
    ])
    expect(points.map(p => [p.total, p.admitted])).toEqual([
      [1, 0], // Oct 20: one recorded
      [2, 0], // Oct 21 10:00: second recorded
      [3, 1], // Oct 21 12:00: third recorded and admitted (fallback time)
      [3, 2], // Oct 22 09:00: the first approval's recorded admission time
    ])
  })

  it('leaves records with unparseable timestamps off the lines', () => {
    expect(growthSeries([candidate('not-a-date', 'approved')])).toEqual([])
    expect(growthSeries([])).toEqual([])
  })
})

describe('NexusGrowthGraph', () => {
  it('labels the empty state with the real zero count instead of a blank graph', () => {
    render(<NexusGrowthGraph candidates={[]} />)
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
    ]} />)
    expect(screen.getByRole('status').textContent).toContain('admitted 2 of 3 recorded entries')
    expect(screen.getByTestId('nexus-growth-chart')).toBeTruthy()
    const totalLine = screen.getByTestId('nexus-growth-total-line').getAttribute('d') ?? ''
    const admittedLine = screen.getByTestId('nexus-growth-admitted-line').getAttribute('d') ?? ''
    expect(totalLine).toContain('L') // stepped through the three record times
    expect(admittedLine).toContain('L')
    expect(screen.getByText(/recorded \(3\)/)).toBeTruthy()
    expect(screen.getByText(/admitted \(2\)/)).toBeTruthy()
  })
})
