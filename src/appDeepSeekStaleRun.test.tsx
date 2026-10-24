// @vitest-environment jsdom
// 2026-10-22: a DeepSeek reply whose saved run had passed the 30-minute workflow window kept "Still working" on screen
// forever: the saved run was cleared on load but the reply stayed "running". It now ends as interrupted, with the
// saved run cleared and nothing started on its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const RUN_KEY = 'forgeclaw_active_deepseek_run'
let fetchMock: ReturnType<typeof vi.fn>

function seed(dispatchedAgoMs: number) {
  const t = Date.now() - dispatchedAgoMs
  localStorage.setItem('forgemind_history', JSON.stringify([
    { id: 'u1', role: 'user', content: '/deepseek what is two plus two', timestamp: t },
    { id: 'a1', role: 'assistant', content: 'Dispatching through the DeepSeek reasoning workflow…', streaming: true, timestamp: t },
  ]))
  localStorage.setItem(RUN_KEY, JSON.stringify({ invocationId: 'inv-1', dispatchedAt: t, messageId: 'a1', question: 'what is two plus two' }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  fetchMock = vi.fn(async () => new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('a DeepSeek run past the workflow window', () => {
  it('ends as interrupted instead of "Still working" forever, and its saved run is cleared', async () => {
    seed(3 * 3600_000)
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/Interrupted: Nexus Intelligence was closed or reloaded before this finished/)).toBeTruthy()
    expect(screen.queryByText(/Still working/)).toBeNull()
    expect(screen.queryByText(/Resuming — reconnecting/)).toBeNull()
    expect(localStorage.getItem(RUN_KEY)).toBeNull()
  })

  it('is not re-run unasked (a DeepSeek workflow takes 9-23 minutes)', async () => {
    seed(3 * 3600_000)
    const { default: App } = await import('./App')
    render(<App />)
    await screen.findByText(/Interrupted: Nexus Intelligence was closed or reloaded before this finished/)
    await new Promise(r => setTimeout(r, 300))
    expect(fetchMock.mock.calls.some(([u]) => /api\.github\.com\/repos\/.*\/dispatches/.test(String(u)))).toBe(false)
    expect(screen.getByText(/Send it again to retry/)).toBeTruthy()
  })

  it('keeps a run inside the window attached (reconnecting, not interrupted)', async () => {
    seed(5 * 60_000)
    const { default: App } = await import('./App')
    render(<App />)
    await new Promise(r => setTimeout(r, 300))
    expect(screen.queryByText(/Interrupted: Nexus Intelligence was closed or reloaded before this finished/)).toBeNull()
  })
})
