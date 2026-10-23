// @vitest-environment jsdom
// 2026-10-22 (owner): "I want to be able to add the funds to forgeclaw directly". /funds is the owner's ledger:
// it runs in the app with no model and no provider key, and its result is the ledger's own text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchCalls: string[] = []

beforeEach(() => {
  localStorage.clear()
  fetchCalls.length = 0
  // Kimi selected but no key: a model turn would be blocked, a /funds command must not be.
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

describe('/funds in the chat', () => {
  it('records funds without a model or key, shows the ledger, and ends the run', async () => {
    const states: Array<{ state: string }> = []
    const onState = (e: Event) => states.push((e as CustomEvent).detail)
    window.addEventListener('forgeclaw:state', onState)
    const { default: App } = await import('./App')
    render(<App />)
    await send('/funds add 500 kalshi account')
    await waitFor(() => expect(screen.getAllByText(/Recorded deposit of \$500\.00 \(kalshi account\)\. Bankroll \$500\.00\./).length).toBeGreaterThan(0), { timeout: 8000 })
    await send('/funds limits cap=1000')
    await waitFor(() => expect(screen.getAllByText(/Limits: cap \$1000\.00/).length).toBeGreaterThan(0), { timeout: 8000 })
    await send('/funds add 500 kalshi account')
    await waitFor(() => expect(screen.getAllByText(/Recorded deposit of \$500\.00 \(kalshi account\)\. Bankroll \$1000\.00\./).length).toBeGreaterThan(0), { timeout: 8000 })
    expect(JSON.parse(localStorage.getItem('forgeclaw_funds_v1')!).movements).toHaveLength(2)
    await send('/funds approve p9')
    await waitFor(() => expect(screen.getAllByText(/Not done: No position p9\./).length).toBeGreaterThan(0), { timeout: 8000 })
    expect(fetchCalls.some(u => u.includes('moonshot'))).toBe(false)
    expect(screen.queryByText(/no API key/)).toBeNull()
    await waitFor(() => expect(['running', 'thinking']).not.toContain(states[states.length - 1]?.state))
    window.removeEventListener('forgeclaw:state', onState)
  }, 30_000)

  it('a "multiply my funds" request reaches the model with the funds tools, live data, research and the plan rules', async () => {
    localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
    localStorage.setItem('forgeclaw_funds_v1', JSON.stringify({ version: 1, movements: [], positions: [], limits: {}, nextId: 1, rules: ['never bet on games my own team plays'] }))
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('moonshot')) { bodies.push(String(init?.body ?? '')); throw new TypeError('Failed to fetch') }
      return new Response('{}', { status: 404 })
    }))
    const { default: App } = await import('./App')
    render(<App />)
    await send('Research and make a master plan to multiply my funds')
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0), { timeout: 8000 })
    const body = JSON.parse(bodies[0]) as { tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ content?: unknown }> }
    const tools = (body.tools ?? []).map(t => t.function?.name)
    for (const name of ['funds_status', 'funds_propose', 'funds_settle', 'kalshi_markets', 'deep_research', 'web_search']) expect(tools).toContain(name)
    expect(JSON.stringify(body.messages)).toContain('Funds plan: you are planning with the owner')
    expect(JSON.stringify(body.messages)).toContain('Only the owner approves, places orders or moves money')
    expect(JSON.stringify(body.messages)).toContain('do not re-propose that market')
    expect(JSON.stringify(body.messages)).toContain('1. never bet on games my own team plays')
  }, 30_000)
})
