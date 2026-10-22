// @vitest-environment jsdom
// 2026-10-20: leaving the app mid-request on a phone killed the Kimi/Claude request and left "temporary connection
// problem" (with the real cause hidden). A request that dies while the page was hidden is now asked once more on return.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { formatUserFacingError, isTransientNetworkError } from './lib/userFacingErrors'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let kimiCalls = 0
let failFirst = true

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiCalls = 0; failFirst = true
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === KIMI_URL) {
      kimiCalls++
      if (failFirst && kimiCalls === 1) {
        // The phone pauses the page: it becomes hidden, then the request dies.
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
        setTimeout(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) }, 20)
        throw new TypeError('Failed to fetch')
      }
      return Response.json({ choices: [{ message: { content: 'Back and answered.' }, finish_reason: 'stop' }] })
    }
    return new Response('{}', { status: 404 })
  }))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }) })

describe('resume on return', () => {
  it('asks again once when the request died while the app was in the background', { timeout: 30000 }, async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = await screen.findByPlaceholderText(/Ask anything/i)
    fireEvent.change(box, { target: { value: 'tell me a short fact' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Back and answered\./)).toBeTruthy(), { timeout: 20000 })
    expect(kimiCalls).toBe(2)
    // The whole-task resend tells her it is connected again and working, as a pop-up.
    expect(screen.getByText(/Connected again — working on it/)).toBeTruthy()
    expect(screen.queryByText(/temporary connection problem/)).toBeNull()
    // The dropped attempt is removed: the conversation holds the question once.
    const saved = JSON.parse(localStorage.getItem('forgemind_history') || '[]') as Array<{ role: string; content: string }>
    expect(saved.filter(m => m.role === 'user' && m.content === 'tell me a short fact')).toHaveLength(1)
  })

  it('does not retry a failure that happened while the app was in front', async () => {
    failFirst = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === KIMI_URL) { kimiCalls++; throw new TypeError('Failed to fetch') }
      return new Response('{}', { status: 404 })
    }))
    const { default: App } = await import('./App')
    render(<App />)
    const box = await screen.findByPlaceholderText(/Ask anything/i)
    fireEvent.change(box, { target: { value: 'tell me a short fact' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/temporary connection problem/)).toBeTruthy(), { timeout: 8000 })
    expect(kimiCalls).toBe(1)
  })
})

describe('errors say what happened', () => {
  it('shows the cause, with token-shaped text removed', () => {
    expect(formatUserFacingError('Failed to fetch')).toContain('(Failed to fetch)')
    expect(formatUserFacingError('boom sk-abcdefghijklmnop1234 exploded')).not.toMatch(/sk-abcdefgh/)
    expect(formatUserFacingError('Moonshot 400: image too large')).toContain('image too large')
  })
  it('recognises dropped connections', () => {
    expect(isTransientNetworkError('Load failed')).toBe(true)
    expect(isTransientNetworkError('Moonshot 400: bad request')).toBe(false)
  })
})
