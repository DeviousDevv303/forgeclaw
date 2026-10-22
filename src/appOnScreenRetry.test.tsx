// @vitest-environment jsdom
// 2026-10-22 (owner's capture): "Run failed: Failed to fetch" while ForgeClaw stayed on screen. The reconnect retry only
// fired after the owner had left the app, so a network blip with the app open ended the run with nothing to recover it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let failures = 0
let kimiCalls = 0

beforeEach(() => {
  localStorage.clear()
  kimiCalls = 0
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== KIMI_URL) return new Response('{}', { status: 404 })
    kimiCalls += 1
    if (kimiCalls <= failures) throw new TypeError('Failed to fetch')
    return Response.json({ choices: [{ message: { content: 'Back online and answered.' }, finish_reason: 'stop' }] })
  }))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete window.forgeCore })

async function ask() {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'tell me a short fact about cubes' } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('a dropped connection while the app stays open', () => {
  it('is retried and the answer arrives, with no error in the chat', async () => {
    failures = 1
    await ask()
    await waitFor(() => expect(screen.getAllByText(/Back online and answered\./).length).toBeGreaterThan(0), { timeout: 10000 })
    expect(kimiCalls).toBe(2)
    expect(screen.queryByText(/temporary connection problem/)).toBeNull()
  }, 30_000)

  it('is bounded: after the retries it still reports the failure instead of retrying forever', async () => {
    failures = 99
    await ask()
    await waitFor(() => expect(screen.getAllByText(/temporary connection problem/).length).toBeGreaterThan(0), { timeout: 15000 })
    expect(kimiCalls).toBeLessThanOrEqual(4)
  }, 30_000)
})
