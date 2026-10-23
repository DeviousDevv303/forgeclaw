// @vitest-environment jsdom
/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Item 6 at the app level: with a proposal waiting, the real App renders the funds panel;
 * tapping OK runs the same owner command as typing it (here: no Kalshi key in this browser,
 * so the execution layer refuses safely and the proposal stands), and tapping No rejects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { applyFundsCommand, emptyFunds, loadFunds, proposePosition, saveFunds, type ProposalInput } from './lib/fundsLedger'

const NOW = Date.parse('2026-10-22T15:00:00Z')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('fm_provider', 'moonshot')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete (window as unknown as Record<string, unknown>).forgeCore })

function seedProposal(): string {
  let s = applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 100000 } }, NOW).state
  s = applyFundsCommand(s, { kind: 'deposit', amount: 1000 }, NOW).state
  const input: ProposalInput = {
    venue: 'kalshi', market: 'KX-RAIN-OCT', side: 'yes', price: 0.4, probability: 0.55,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }
  const r = proposePosition(s, input, NOW)
  saveFunds(r.state)
  return r.position.id
}

describe('funds panel in the chat', () => {
  it('OK tap runs the owner approve command; with no Kalshi key the proposal stands', async () => {
    const id = seedProposal()
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/KX-RAIN-OCT/)).toBeTruthy(), { timeout: 8000 })
    fireEvent.click(screen.getByText('OK'))
    await waitFor(() => expect(screen.getAllByText(/Not placed: no Kalshi API key/).length).toBeGreaterThan(0), { timeout: 8000 })
    expect(loadFunds().positions.find(p => p.id === id)?.status).toBe('proposed')
  }, 30_000)

  it('No tap rejects the proposal and the panel row goes away', async () => {
    const id = seedProposal()
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/KX-RAIN-OCT/)).toBeTruthy(), { timeout: 8000 })
    fireEvent.click(screen.getByText('No'))
    await waitFor(() => expect(loadFunds().positions.find(p => p.id === id)?.status).toBe('rejected'), { timeout: 8000 })
    await waitFor(() => expect(screen.queryByText(/KX-RAIN-OCT/)).toBeNull(), { timeout: 8000 })
  }, 30_000)
})
