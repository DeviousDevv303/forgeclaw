// @vitest-environment jsdom
/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Item 8 at the app level: a typed /funds approve in the real App places a real (demo)
 * order through the whole stack — Settings credentials, WebCrypto signing, re-quote,
 * balance gate, the recorded client_order_id in the POST body, the fill in the ledger —
 * and a refusal lands in the failure ledger with its run id and stage.
 */

import { generateKeyPairSync, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { applyFundsCommand, emptyFunds, loadFunds, proposePosition, saveFunds } from './lib/fundsLedger'

// jsdom's WebCrypto has no Ed25519; Node's does (the app signs with it in a real browser).
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const NOW = Date.parse('2026-10-23T15:00:00Z')
const DEMO = 'https://external-api.demo.kalshi.co/trade-api/v2'
const { privateKey } = generateKeyPairSync('ed25519')
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

let orderPosts: Array<Record<string, unknown>>
let yesAsk = '0.4200'

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === `${DEMO}/markets/KX-TEST`) {
      // Kalshi market records carry their exchange_index; since the shard lock
      // (2026-10-23) a record without one is refused, not defaulted — so the
      // fixture names shard 0, as the real record for a general-exchange market does.
      return Response.json({ market: { yes_ask_dollars: yesAsk, no_ask_dollars: '0.4400', status: 'active', exchange_index: 0 } })
    }
    // The balance endpoint also serves the approve flow's per-shard read, which adds
    // ?exchange_index=N to the same path — match the endpoint, not the exact URL.
    if (url.startsWith(`${DEMO}/portfolio/balance`)) {
      return Response.json({ balance: 50000, balance_dollars: '500.0000', portfolio_value: 0 })
    }
    if (url === `${DEMO}/portfolio/events/orders` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      orderPosts.push(body)
      return Response.json({
        order_id: 'ord-app', client_order_id: body.client_order_id,
        fill_count: body.count, remaining_count: '0.00', average_fill_price: '0.4200', average_fee_paid: '0.0171',
      }, { status: 201 })
    }
    if (url.startsWith(`${DEMO}/portfolio/settlements`)) return Response.json({ settlements: [] })
    return new Response('{}', { status: 404 })
  }))
}

function seedProposal(): string {
  localStorage.setItem('fc_kalshi_key_id', 'app-test-key')
  localStorage.setItem('fc_kalshi_private_key', PEM)
  localStorage.setItem('fc_kalshi_env', 'demo')
  let s = applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 100000 } }, NOW).state
  s = applyFundsCommand(s, { kind: 'deposit', amount: 1000 }, NOW).state
  const r = proposePosition(s, {
    venue: 'kalshi', market: 'KX-TEST', side: 'yes', price: 0.4, probability: 0.55,
    rationale: 'NWS forecast gives 60% rain for the window and three models agree; market lags the update.',
    sources: ['https://weather.gov/forecast'],
  }, NOW)
  saveFunds(r.state)
  return r.position.id
}

beforeEach(() => {
  localStorage.clear()
  orderPosts = []
  yesAsk = '0.4200'
  localStorage.setItem('fm_provider', 'moonshot')
  stubFetch()
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete (window as unknown as Record<string, unknown>).forgeCore })

async function send(text: string) {
  // The chat box is the page's TEXTAREA; the funds panel adds a text INPUT (its
  // add-funds box) whenever a proposal waits, so role alone is ambiguous (PR B).
  const box = screen.getAllByRole('textbox').find(el => el.tagName === 'TEXTAREA') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('/funds approve executes in the app (PR #240 item 8)', () => {
  it('places the order: POST body carries fc-<id>-1, the ledger records the real fill', async () => {
    const id = seedProposal()
    const { default: App } = await import('./App')
    render(<App />)
    await send(`/funds approve ${id}`)
    await waitFor(() => expect(screen.getAllByText(/Placed .*bought .*YES on KX-TEST/).length).toBeGreaterThan(0), { timeout: 10000 })
    expect(orderPosts).toHaveLength(1)
    expect(orderPosts[0].client_order_id).toBe(`fc-${id}-1`)
    expect(orderPosts[0].ticker).toBe('KX-TEST')
    const p = loadFunds().positions.find(x => x.id === id)!
    expect(p.status).toBe('placed')
    expect(p.kalshiOrderId).toBe('ord-app')
    expect(p.clientOrderId).toBe(`fc-${id}-1`)
    expect(typeof p.runId).toBe('string')
  }, 30_000)

  it('a refusal (edge gone at the live price) posts nothing and lands in the failure ledger with run + stage', async () => {
    yesAsk = '0.6000'
    const id = seedProposal()
    const { default: App } = await import('./App')
    render(<App />)
    await send(`/funds approve ${id}`)
    await waitFor(() => expect(screen.getAllByText(/after fees there is no edge/).length).toBeGreaterThan(0), { timeout: 10000 })
    expect(orderPosts).toHaveLength(0)
    const ledger = JSON.parse(localStorage.getItem('forgeclaw_failure_ledger') ?? '[]') as Array<{ source: string; context?: Record<string, unknown> }>
    const entry = ledger.find(e => e.source === 'kalshi')
    expect(entry).toBeTruthy()
    expect(entry!.context?.stage).toBe('quote')
    expect(entry!.context?.positionId).toBe(id)
    expect(typeof entry!.context?.runId).toBe('string')
  }, 30_000)
})
