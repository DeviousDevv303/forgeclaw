// @vitest-environment jsdom
// 2026-10-21 (owner): after "I hit a temporary connection problem" the neurals were still running, so it looked as if
// ForgeClaw were still working. The error path never told the reactive layer the run had ended.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === KIMI_URL) throw new TypeError('Failed to fetch')
    return new Response('{}', { status: 404 })
  }))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete window.forgeCore })

describe('a failed request ends the run', () => {
  it('the reactive layer ends in an error state, not "running", after a connection failure', async () => {
    const states: Array<{ state: string }> = []
    const onState = (e: Event) => states.push((e as CustomEvent).detail)
    window.addEventListener('forgeclaw:state', onState)
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'tell me a short fact about cubes' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText(/temporary connection problem/).length).toBeGreaterThan(0), { timeout: 15000 })
    await waitFor(() => expect(states[states.length - 1]?.state).toBe('error'))
    expect(states.some(s => s.state === 'running' || s.state === 'thinking')).toBe(true)
    window.removeEventListener('forgeclaw:state', onState)
  }, 30_000)
})
