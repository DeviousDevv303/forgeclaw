// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../lib/i18n'
import type { LearningCandidate } from '../lib/corpus'

const seeded: LearningCandidate[] = [
  {
    id: 'cand-1',
    timestamp: '2026-10-20T00:00:00.000Z',
    source: 'test',
    model: 'test-model',
    input: 'some prompt text',
    generatedResult: 'some result text',
    approved: false,
    metadata: { outcome: 'completed', tool: 'shell_exec', channel: 'test' },
  } as unknown as LearningCandidate,
  {
    id: 'cand-2',
    timestamp: '2026-10-20T00:01:00.000Z',
    source: 'test',
    model: 'test-model',
    input: 'another prompt',
    generatedResult: 'another result',
    approved: false,
    metadata: { outcome: 'failed', tool: 'github_search_code', channel: 'test' },
  } as unknown as LearningCandidate,
]

vi.mock('../lib/corpus', () => ({
  corpusRepository: {
    listCandidates: () => seeded,
    getApprovedCount: () => 0,
    getConvergedCounts: () => ({}),
    rejectCandidate: () => Promise.resolve(false),
  },
}))

const { NexusLearningPanel } = await import('./NexusLearningPanel')

afterEach(() => { cleanup(); __setLangForTests('en') })

describe('NexusLearningPanel phone layout', () => {
  it('renders on a 375px viewport without page-level horizontal scroll', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const page = screen.getByTestId('nexus-page')
    const pageStyle = getComputedStyle(page)
    // The page itself must not scroll horizontally; only the tools table may.
    expect(pageStyle.overflowY).not.toBe('hidden')
    // Tighter padding fits a 375px viewport (375 - 2*12 = 351px content width).
    expect(page.style.padding).toBe('12px')
  })

  it('scrolls the tool-reliability table inside its card on narrow screens', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const scroller = screen.getByTestId('nexus-tools-scroll')
    // The table wrapper absorbs overflow so the page never gains a horizontal scrollbar.
    expect(scroller.style.overflowX).toBe('auto')
    // Tool column header is translated from i18n keys, not hardcoded.
    const headers = scroller.querySelectorAll('th')
    expect(headers[0].textContent).toBe('tool')
    expect(headers.length).toBe(6)
  })

  it('renders Spanish strings when the language is es (NEXUS_MOTTO stays English)', () => {
    __setLangForTests('es')
    render(<NexusLearningPanel />)
    expect(screen.getByText('NEXUS · APRENDIZAJE RECURSIVO')).not.toBeNull()
    expect(screen.getByText('Registrados')).not.toBeNull()
    expect(screen.getByText('Lecciones devueltas al agente')).not.toBeNull()
    expect(screen.getByText('ACTUALIZAR')).not.toBeNull()
    expect(screen.getAllByText('RECHAZAR').length).toBe(2)
    // Brand line is deliberately not translated.
    expect(screen.queryByText('My Logic Is Undeniable')).not.toBeNull()
    expect(screen.queryByText('Mi Lógica Es Innegable')).toBeNull()
  })
})

describe('what NEXUS added by itself is visible and removable', () => {
  const auto = { id: 'candidate-auto', timestamp: '2026-10-21T20:00:00.000Z', source: 'learning:chat', model: 'k2', input: 'how many open PRs', generatedResult: 'Two.', admissionStatus: 'approved', metadata: { outcome: 'verified', channel: 'chat', actor: 'user', admittedBy: 'nexus-convergence', phase: 'first_principles', admittedAt: '2026-10-21T20:00:01.000Z' } } as unknown as LearningCandidate
  it('is badged AUTO-ADDED with its phase and time, and offers REMOVE', () => {
    seeded.push(auto)
    try {
      __setLangForTests('en')
      render(<NexusLearningPanel />)
      expect(screen.getByText(/AUTO-ADDED · First Principles · 2026-10-21 20:00/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'REMOVE' })).toBeTruthy()
    } finally { seeded.splice(seeded.indexOf(auto), 1) }
  })
})

describe('your heuristics are active without approval', () => {
  // 2026-10-21 (owner): "I don't have to approve or admit anything manually". A rule the owner states twice is given to
  // every model at once; "remove" takes it out, and that sticks across a reload.
  const rule = 'do not claim success unless the file was actually created and committed'
  const said = (id: string): LearningCandidate => ({ id, timestamp: '2026-10-05T00:00:00.000Z', source: 'learning:chat', model: 'm', input: rule, generatedResult: 'ok', approved: false, metadata: { outcome: 'completed', channel: 'chat', actor: 'user' } } as unknown as LearningCandidate)
  it('lists a mined rule as active with no APPROVE button, and remove sticks after a reload', async () => {
    const { fireEvent } = await import('@testing-library/react')
    localStorage.clear()
    seeded.push(said('h1'), said('h2'))
    try {
      __setLangForTests('en')
      render(<NexusLearningPanel />)
      const list = screen.getByLabelText('Active heuristics')
      expect(list.textContent).toContain('ACTIVE · given to every model (1)')
      expect(list.textContent).toContain(rule)
      expect(screen.queryByRole('button', { name: 'APPROVE' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'remove' }))
      expect(screen.queryByLabelText('Active heuristics')).toBeNull()
      cleanup()
      render(<NexusLearningPanel />)
      expect(screen.queryByLabelText('Active heuristics')).toBeNull()
    } finally {
      seeded.splice(seeded.length - 2, 2)
      localStorage.clear()
    }
  })
})
