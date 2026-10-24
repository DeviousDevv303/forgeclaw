// @vitest-environment jsdom
/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Item 6 coverage: the panel lists waiting proposals, its buttons send the exact owner
 * commands a typed `/funds` would, and it stays hidden when nothing is waiting.
 * Item 10 adds: the Approve all button appears only with 2+ proposals waiting.
 */

import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FundsPanel } from './FundsPanel'
import { applyFundsCommand, emptyFunds, loadFunds, proposePosition, saveFunds, type ProposalInput } from '../lib/fundsLedger'
import { KALSHI_KEY_ID_STORAGE, KALSHI_PRIVATE_KEY_STORAGE } from '../lib/kalshiAuth'

// jsdom's WebCrypto has no Ed25519; sign with Node's, as in kalshiAuth.test.ts.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const NOW = Date.parse('2026-10-22T15:00:00Z')

function seedProposal(market = 'KX-RAIN-OCT'): string {
  const existing = loadFunds()
  let s = existing.positions.length || existing.movements.length
    ? existing
    : applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 100000 } }, NOW).state
  if (!s.movements.length) s = applyFundsCommand(s, { kind: 'deposit', amount: 1000 }, NOW).state
  const input: ProposalInput = {
    venue: 'kalshi', market, side: 'yes', price: 0.4, probability: 0.55,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }
  const r = proposePosition(s, input, NOW)
  saveFunds(r.state)
  return r.position.id
}

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('FundsPanel', () => {
  it('renders nothing when no proposal is waiting', () => {
    const { container } = render(<FundsPanel onCommand={() => {}} refreshKey={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the Kalshi (live) balance with no proposal waiting, when credentials are saved (balance plan, 2026-10-23)', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    localStorage.setItem(KALSHI_KEY_ID_STORAGE, 'panel-test-key')
    localStorage.setItem(KALSHI_PRIVATE_KEY_STORAGE, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      balance: 2500, balance_dollars: '25.0000', portfolio_value: 2500, updated_ts: 1761240000,
      balance_breakdown: [
        { exchange_index: 0, balance: '25.0000' },
        { exchange_index: 3, balance: '0.0000' },
      ],
    }), { status: 200 })))
    render(<FundsPanel onCommand={() => {}} refreshKey={0} />)
    expect(await screen.findByText(/Total across shards — orders spend from one shard: \$25\.00/)).toBeTruthy()
    expect(screen.getByText(/shard 3 \(sports\): \$0\.00/)).toBeTruthy()
    expect(screen.queryByText('Funds — proposals waiting')).toBeNull()
  })

  it('lists the proposal and sends the exact approve / reject commands', () => {
    const id = seedProposal()
    const onCommand = vi.fn()
    render(<FundsPanel onCommand={onCommand} refreshKey={0} />)
    expect(screen.getByText(/KX-RAIN-OCT/)).toBeTruthy()
    fireEvent.click(screen.getByText('OK'))
    expect(onCommand).toHaveBeenCalledWith(`/funds approve ${id}`)
    fireEvent.click(screen.getByText('No'))
    expect(onCommand).toHaveBeenCalledWith(`/funds reject ${id}`)
  })

  it('adds funds with the typed amount and clears the box; invalid amounts cannot send', () => {
    seedProposal()
    const onCommand = vi.fn()
    render(<FundsPanel onCommand={onCommand} refreshKey={0} />)
    const input = screen.getByLabelText('Add funds amount') as HTMLInputElement
    const button = screen.getByText('Add funds') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '250' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onCommand).toHaveBeenCalledWith('/funds add 250')
    expect(input.value).toBe('')
  })

  it('shows Approve all only with 2+ proposals, sending the exact command', () => {
    seedProposal()
    const onCommand = vi.fn()
    const { rerender } = render(<FundsPanel onCommand={onCommand} refreshKey={0} />)
    expect(screen.queryByText('Approve all')).toBeNull()
    seedProposal('KX-SNOW-NOV')
    rerender(<FundsPanel onCommand={onCommand} refreshKey={1} />)
    fireEvent.click(screen.getByText('Approve all'))
    expect(onCommand).toHaveBeenCalledWith('/funds approve-all')
  })

  it('shows a proposal saved outside a /funds command, with no refreshKey change or tab switch', () => {
    // S1: a model tool's funds_propose saves mid-run, outside any /funds command — App
    // never bumps refreshKey for that save, so the panel must learn it from the ledger.
    const onCommand = vi.fn()
    render(<FundsPanel onCommand={onCommand} refreshKey={0} />)
    expect(screen.queryByText('OK')).toBeNull()
    let id = ''
    act(() => { id = seedProposal() }) // seedProposal saves via saveFunds, exactly like the tool path
    expect(screen.getByText('OK')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
    fireEvent.click(screen.getByText('OK'))
    expect(onCommand).toHaveBeenCalledWith(`/funds approve ${id}`)
  })
})
