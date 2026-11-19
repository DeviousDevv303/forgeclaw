// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// The NEXUS page against the REAL corpus store (no mock): what it shows must equal what is stored. Owner ask 2026-11-15:
// "make sure that Nexus tab is a correct representation of the state of Nexus Intelligence".
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { __setLangForTests } from '../lib/i18n'
import { corpusRepository } from '../lib/corpus'
import { heuristicsForPrompt } from '../lib/nexusHeuristics'
import { lessonsForPrompt, PROMPT_CANDIDATE_WINDOW, summarizeLearning } from '../lib/nexusLearning'
import { NEXUS_MODEL_STATE } from '../lib/nexusModelState'

vi.mock('../lib/nexusIntake', () => ({ syncNexusIntake: () => Promise.resolve({ status: 'unavailable', fetched: 0, added: 0, admitted: 0 }) }))
const { NexusLearningPanel } = await import('./NexusLearningPanel')

const TOOL_RECORDS = 1_060
const TOTAL = TOOL_RECORDS + 3
beforeAll(async () => {
  localStorage.clear()
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  // Three owner chat turns first, so they are the oldest: one explicit rule, and one rule said twice.
  for (const input of ['rule: always name the file you changed', 'Make sure the tests ran before you say done.', 'Make sure the tests ran before you say done. Thanks.']) {
    await corpusRepository.appendInteraction({ input, context: '', result: 'ok', runtime: 'test', model: 'test-model', source: 'learning:chat', metadata: { outcome: 'completed', channel: 'chat', actor: 'user' } })
  }
  // 1,060 tool records with no evidence (so none converge): the first 40 failed, 20 attempted, the rest completed.
  for (let i = 0; i < TOOL_RECORDS; i++) {
    const outcome = i < 40 ? 'failed' : i < 60 ? 'attempted' : 'completed'
    await corpusRepository.appendInteraction({
      input: `request ${i}`, context: '', result: i < 40 ? `[TOOL ERROR] upstream said no ${i}` : `result ${i}`, runtime: 'test', model: 'test-model',
      source: 'learning:tool', metadata: { outcome, tool: 'web_search', channel: 'tool' },
    })
  }
}, 120_000)
afterEach(() => { cleanup(); __setLangForTests('en') })

describe('NEXUS page against the real store', () => {
  it('counts every stored record, not the newest 1,000', () => {
    expect(corpusRepository.getCandidateCount()).toBe(TOTAL)
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    expect(screen.getByTestId('nexus-recorded').textContent).toContain(String(TOTAL))
    expect(screen.getByTestId('nexus-stored-note').textContent).toContain('1,063 record(s) stored in this browser now')
    // The 40 failures are the OLDEST records: with the old 1,000 cap, 60 of the oldest fell off and the card read 0.
    expect(screen.getByRole('button', { name: /failed/i, pressed: false }).textContent).toContain('40')
    expect(screen.getByText(/recorded \(1063\)/)).toBeTruthy()
  })

  it('the tools table keeps attempted apart from ok, and the cards sum to the total', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const row = within(screen.getByTestId('nexus-tools-scroll')).getByText('web_search').closest('tr')!
    expect([...row.querySelectorAll('td')].map(td => td.textContent)).toEqual(['web_search', '1060', '1000', '20', '40', '0', '0', '94%'])
  })

  it('admitted reads one source: the card, the knowledge heading and the graph agree', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const k = corpusRepository.getApprovedCount()
    expect(screen.getByTestId('nexus-knowledge').textContent).toContain(`what NEXUS treats as known (${k})`)
    expect(screen.getByText(new RegExp(`admitted \\(${k}\\)`))).toBeTruthy()
    expect(screen.getByTestId('nexus-llm-road').textContent).toContain(`${k} admitted in all`)
  })

  it('labels tool coverage as recorded candidate data, not all knowledge or training data', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    expect(screen.getByTestId('nexus-llm-road').textContent).toContain('stored candidate data covers 1 recorded tool')
    expect(screen.getByTestId('nexus-knowledge').textContent).toContain('Only evidence-backed auto-added entries are counted as training data above')
  })

  it('"fed back" and "given to every model" list exactly what a prompt carries', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const window = corpusRepository.listCandidates(PROMPT_CANDIDATE_WINDOW)
    // The 40 recurring failures and the three rule statements are all older than the newest 500 records.
    expect(lessonsForPrompt(summarizeLearning(window), ['web_search'])).toBe('')
    expect(heuristicsForPrompt()).toBe('')
    // So the page must not present them as reaching a model.
    const lessons = screen.getByRole('region', { name: 'Lessons' })
    expect(lessons.querySelectorAll('li').length).toBe(0)
    expect(screen.getByTestId('nexus-lessons-note').textContent).toContain('1 other recurring failure(s) are recorded but not fed back')
    expect(screen.getByTestId('nexus-heuristics').textContent).toContain('No heuristics yet')
    expect(screen.getByTestId('nexus-heuristics-outside').textContent).toContain('2 more rule(s) are in older records and are NOT given to the models')
    // And the loop's Assumptions / Heuristics counters are the same in-force numbers.
    const phases = screen.getByTestId('nexus-phases').textContent ?? ''
    expect(phases).toContain('ASSUMPTIONS0')
    expect(phases).toContain('HEURISTICS0')
  })

  it('describes the model the app serves, and no longer says NEXUS is not a model', () => {
    __setLangForTests('en')
    render(<NexusLearningPanel />)
    const model = screen.getByTestId('nexus-model').textContent ?? ''
    expect(model).toContain(NEXUS_MODEL_STATE.label)
    expect(model).toContain('4.48M parameters · 640-token window')
    expect(model).toContain('v1 59/84 (70.2%) · domains 41/47 (87.2%) · closed loop 16/18 · fabrication 0.0%')
    expect(model).toContain(`sha256 ${NEXUS_MODEL_STATE.sha256.slice(0, 16)}`)
    const page = screen.getByTestId('nexus-page').textContent ?? ''
    expect(page).not.toMatch(/not a model yet|LoRA|fine-tune/i)
  })
})
