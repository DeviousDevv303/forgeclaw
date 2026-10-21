// @vitest-environment jsdom
// 2026-10-21 (owner): "make me a real URL instead of me having to give it one". Asking to do something on the web
// without naming a site offers the browser together with web_search, and the guidance says to find the real URL first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
type Body = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === KIMI_URL
    ? Response.json({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] })
    : new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function firstRequest(prompt: string): Promise<Body> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === KIMI_URL)).toBe(true), { timeout: 8000 })
  const call = fetchMock.mock.calls.find(([url]) => String(url) === KIMI_URL)!
  return JSON.parse(String((call[1] as RequestInit).body)) as Body
}

describe('browsing without a URL from the owner', () => {
  it('offers the browser together with web_search, and tells the model to find the real site first', async () => {
    const body = await firstRequest('go online and find out how much the cheapest 3x3 speed cube costs')
    const names = (body.tools ?? []).map(t => t.function.name)
    expect(names).toContain('browser_run')
    expect(names).toContain('web_search')
    const system = body.messages.find(m => m.role === 'system')?.content ?? ''
    expect(system).toMatch(/do not need the owner to give you a URL/)
  }, 30_000)
})
