// @vitest-environment jsdom
// 2026-10-21: a pull request URL plus "tell me what you see" got a summary from memory and was BLOCKED for having no
// repository evidence: no tool read a pull request, and a bare address offered neither the GitHub tools nor the browser.
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
const names = (b: Body) => (b.tools ?? []).map(t => t.function.name)

describe('a pasted address gets the right tool', () => {
  it('a pull request of this repository: the pull request reader, not the anonymous browser', async () => {
    const body = await firstRequest('https://github.com/DeviousDevv303/forgeclaw/pull/202 tell me what you see')
    expect(names(body)).toContain('github_pr_info')
    expect(names(body)).not.toContain('browser_run')
  }, 30_000)
  it('any other page: the cloud browser', async () => {
    const body = await firstRequest('https://example.com tell me what you see')
    expect(names(body)).toContain('browser_run')
  }, 30_000)
  it('"what does PR #202 do" offers the reader with no address at all', async () => {
    const body = await firstRequest('what does pr #202 do and is it ready?')
    expect(names(body)).toContain('github_pr_info')
  }, 30_000)
})
