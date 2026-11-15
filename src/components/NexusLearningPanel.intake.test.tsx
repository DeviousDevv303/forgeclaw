// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
// Stage 3b: an externally-sourced intake candidate renders in the Nexus tab as
// PENDING (labeled external intake, routed to the existing reject flow) — never
// as admitted knowledge, and the growth graph's admitted count stays at zero.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../lib/i18n'
import type { LearningCandidate } from '../lib/corpus'

const intakeCandidate = {
  id: 'candidate-intake-1',
  corpusId: 'nexus-local',
  timestamp: '2026-10-24T10:10:02.359Z',
  source: 'nexus-intake',
  content: 'kalshi-snapshot.yml last successful run 2026-10-24T07:17:32Z, 172 min old > 60 min silence tripwire',
  version: 1,
  recordType: 'learning_candidate',
  integrity: 'sha256-test',
  admissionStatus: 'candidate',
  sourceInteractionId: 'interaction-intake-1',
  runtime: 'nexus-intake',
  model: 'canary',
  input: 'suspect-new: scheduler-silence',
  context: 'nexus-intake record: source=canary; run_id=f5338bb1-5cab-457d-b20b-fb68ecfcb4b7; kind=suspect-new; ts=2026-10-24T10:10:02.359Z',
  generatedResult: 'kalshi-snapshot.yml last successful run 2026-10-24T07:17:32Z, 172 min old > 60 min silence tripwire',
  metadata: {
    outcome: 'completed',
    origin: 'external-intake',
    channel: 'external intake',
    tool: 'suspect-new',
    run: 'f5338bb1-5cab-457d-b20b-fb68ecfcb4b7',
    intakeKey: 'f5338bb1-5cab-457d-b20b-fb68ecfcb4b7|suspect-new|scheduler-silence',
    intakeSource: 'canary',
    kind: 'suspect-new',
    subject: 'scheduler-silence',
    provenance: 'forgeclaw-canary v1',
  },
} as unknown as LearningCandidate

vi.mock('../lib/corpus', () => ({
  corpusRepository: {
    listCandidates: () => [intakeCandidate],
    getApprovedCount: () => 0,
    getConvergedCounts: () => ({}),
    listKnowledge: () => [],
    getTrainingCount: () => 0,
    removeKnowledge: () => true,
    rejectCandidate: () => Promise.resolve(null),
  },
}))

vi.mock('../lib/nexusIntake', () => ({
  syncNexusIntake: () => Promise.resolve({ status: 'unavailable', fetched: 0, added: 0, admitted: 0 }),
}))

const { NexusLearningPanel } = await import('./NexusLearningPanel')

afterEach(() => { cleanup(); __setLangForTests('en') })

describe('NexusLearningPanel external intake candidates', () => {
  it('renders a fetched intake candidate as PENDING with its external-intake label, never as admitted', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)

    // The candidate itself is listed with its evidence.
    expect(screen.getByText('suspect-new: scheduler-silence')).toBeTruthy()
    expect(screen.getAllByText(/kalshi-snapshot\.yml last successful run/).length).toBeGreaterThan(0)

    // Labeled as external intake with source, kind, run_id and provenance.
    const label = screen.getByText(/EXTERNAL INTAKE/)
    expect(label.textContent).toContain('canary')
    expect(label.textContent).toContain('suspect-new')
    expect(label.textContent).toContain('f5338bb1-5cab-457d-b20b-fb68ecfcb4b7')
    expect(label.textContent).toContain('forgeclaw-canary v1')

    // Pending, not admitted: it routes into the existing reject flow…
    expect(screen.getByTitle('Hold to reject this candidate')).toBeTruthy()
    // …the knowledge section stays empty…
    expect(screen.getByText('Nothing yet.')).toBeTruthy()
    // …and the growth graph counts it as recorded but NOT admitted.
    expect(screen.getByText(/Nexus has admitted 0 of 1 recorded entry/)).toBeTruthy()
  })
})
