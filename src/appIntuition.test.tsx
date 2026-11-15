// @vitest-environment jsdom
/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */
// Synthetic Intuition end to end, up to the UI: a graded ledger in storage -> the real App -> the owner types /intuition ->
// the read-only panel shows denominators, lower bound, bucket and whether each journaled packet resolves. No model, no key,
// no fetch to a provider: the command is owner-typed and moves nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { addGrade, addRecord, saveLedger } from './lib/intuition/ledger'
import { buildPacket, journalPacket } from './lib/intuition/packet'
import { ACTIVE_REGISTRY } from './lib/intuition/patternClasses'
import { grade, ledgerWith, pre } from './lib/intuition/fixtures'

const fetchCalls: string[] = []

beforeEach(() => {
  localStorage.clear()
  fetchCalls.length = 0
  localStorage.setItem('fm_provider', 'moonshot')
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => { fetchCalls.push(String(url)); return new Response('{}', { status: 404 }) }))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete window.forgeCore })

async function send(text: string) {
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

// The draft registry's version is what records must carry for their evidence to count under it.
const V = ACTIVE_REGISTRY.version
const live = (id: string) => pre(id, { patternClassVersion: V })

function seed() {
  let l = ledgerWith(0, 0)
  for (let i = 0; i < 10; i++) {
    const id = `h${i}`; l = addRecord(l, live(id)); l = addGrade(l, grade(id, l.records[id].hash, 'correct'))
  }
  l = addRecord(l, live('miss')); l = addGrade(l, grade('miss', l.records.miss.hash, 'incorrect'))
  l = addRecord(l, pre('syn', { patternClassVersion: V, source: 'synthetic' }))
  l = addGrade(l, grade('syn', l.records.syn.hash, 'correct'))
  const built = buildPacket(l, ACTIVE_REGISTRY, { patternClassId: 'tape.drift-consistent', regime: 'weekday-us', hypothesisRank: 1, falsifierRegistered: true, pressureEvents: 0, now: '2026-11-15T12:00:00Z', allowDraft: true })
  l = journalPacket(l, built)
  saveLedger(l)
  return { built, l }
}

describe('/intuition in the chat', () => {
  it('shows nothing until asked, then the ledger with denominators, lower bound, bucket and exclusions', async () => {
    const { built } = seed()
    const { default: App } = await import('./App')
    render(<App />)
    expect(screen.queryByLabelText('Synthetic Intuition ledger')).toBeNull()
    await send('/intuition')
    const panel = await screen.findByLabelText('Synthetic Intuition ledger', {}, { timeout: 8000 })
    expect(within(panel).getByText(/read-only/)).toBeTruthy()
    expect(within(panel).getByText(/registry draft-0 · draft/)).toBeTruthy()
    expect(within(panel).getByRole('note').textContent).toMatch(/not issued to a model until the pattern-class list is frozen/)
    const row = within(panel).getByText('tape.drift-consistent').closest('tr')!
    // 10 hits of 11 live graded; the synthetic record is listed as excluded, never counted.
    expect(row.textContent).toContain('10/11')
    expect(row.textContent).toContain('1 synthetic')
    expect(row.textContent).toMatch(/0\.6\d/) // Wilson lower bound for 10/11
    expect(within(panel).getByText(built.text)).toBeTruthy()
    expect(within(panel).getByText('RESOLVES')).toBeTruthy()
    // The chat reply carries the same numbers as text.
    await waitFor(() => expect(screen.getAllByText(/10\/11 graded, lower bound 0\.6\d, bucket 5/).length).toBeGreaterThan(0), { timeout: 8000 })
    // Owner-typed and local: no provider call was made.
    expect(fetchCalls.filter(u => /moonshot|openrouter|anthropic|openai/.test(u))).toEqual([])
  }, 30_000)

  it('a tampered record turns the journaled packet into FAILS CLOSED in the UI', async () => {
    const { l } = seed()
    const tampered = { ...l, records: { ...l.records, h3: { ...l.records.h3, hypothesis: 'knew it all along' } } }
    saveLedger(tampered)
    const { default: App } = await import('./App')
    render(<App />)
    await send('/intuition')
    const panel = await screen.findByLabelText('Synthetic Intuition ledger', {}, { timeout: 8000 })
    await waitFor(() => expect(within(panel).getByText(/FAILS CLOSED: record h3 no longer resolves/)).toBeTruthy())
    expect(within(panel).queryByText('RESOLVES')).toBeNull()
    expect(within(panel).getByText('tape.drift-consistent').closest('tr')!.textContent).toContain('1 tampered')
  }, 30_000)

  it('cold start shows bucket 0 and no evidence, and /intuition close hides the panel', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    await send('/intuition')
    const panel = await screen.findByLabelText('Synthetic Intuition ledger', {}, { timeout: 8000 })
    expect(within(panel).getByText(/No graded evidence yet/)).toBeTruthy()
    await send('/intuition close')
    await waitFor(() => expect(screen.queryByLabelText('Synthetic Intuition ledger')).toBeNull(), { timeout: 8000 })
  }, 30_000)
})
