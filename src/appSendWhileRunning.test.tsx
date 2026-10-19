// @vitest-environment jsdom
// Run 157 (2026-10-19): a DeepSeek question was still generating on GitHub when Enter sent it again.
// The second send took over the active run without stopping the first, so the first answer was
// discarded when it arrived and its bubble never rendered, while a duplicate run (158) was dispatched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  // Dispatch is accepted; the run never shows up, so the first request stays in flight.
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/dispatches') && init?.method === 'POST') return new Response(null, { status: 204 })
    if (url.includes('/runs?')) return Response.json({ workflow_runs: [] })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

const dispatches = () => fetchMock.mock.calls.filter(([url, init]) => String(url).includes('deepseek-16b.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')

describe('sending while a request is still running', () => {
  it('does not start a second run or abandon the first, and keeps the typed text', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Good morning, give me a calisthenics workout for today' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(dispatches()).toHaveLength(1), { timeout: 5000 })

    fireEvent.change(box, { target: { value: 'Good morning, give me a calisthenics workout for today' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await new Promise(resolve => setTimeout(resolve, 1500))

    expect(dispatches()).toHaveLength(1)
    expect(box.value).toBe('Good morning, give me a calisthenics workout for today')
  }, 15_000)

  it('accepts a new send after STOP, so the guard can never lock the chat', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'What causes rainbows to form after rain?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(dispatches()).toHaveLength(1), { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    fireEvent.change(box, { target: { value: 'Why is the sky blue during the day?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(dispatches()).toHaveLength(2), { timeout: 5000 })
  }, 15_000)
})
