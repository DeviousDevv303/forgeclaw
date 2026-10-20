// @vitest-environment jsdom
// Public visitor mode: a browser with no GitHub token, on a build with a relay configured, gets the
// hosted model through the relay. The owner's token is never involved, and the owner's own browser
// (which has a token) never uses the relay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const RELAY = 'https://relay.example'
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_PUBLIC_RELAY_URL', RELAY)
  vi.stubEnv('VITE_GITHUB_TOKEN', '')
  vi.stubEnv('VITE_GH_TOKEN', '')
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === `${RELAY}/v1/reason` && init?.method === 'POST') return Response.json({ invocation_id: 'public-abc123-0123456789', status: 'queued' }, { status: 202 })
    if (url === `${RELAY}/v1/reason/public-abc123-0123456789`) return Response.json({ status: 'done', result: 'Recursion is when a function calls itself.', model: 'Qwen/Qwen3-8B' })
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

async function ask(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('public visitor mode', () => {
  it('answers a visitor through the relay with the hosted model, and says so', async () => {
    await ask('explain recursion to a ten year old')
    expect(screen.getByRole('note').textContent).toMatch(/^Public mode: .*Do not enter private information/)
    await waitFor(() => expect(screen.getByText(/Recursion is when a function calls itself\./)).toBeTruthy(), { timeout: 8000 })
    const post = fetchMock.mock.calls.find(([url, init]) => String(url) === `${RELAY}/v1/reason` && (init as RequestInit)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body)).task).toContain('explain recursion to a ten year old')
    // No GitHub dispatch from the visitor's browser, and no token anywhere in what it sent.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/dispatches'))).toBe(false)
    for (const [, init] of fetchMock.mock.calls) expect(JSON.stringify((init as RequestInit | undefined)?.headers ?? {})).not.toMatch(/Authorization/i)
    // Nothing personal to the owner is shown to a visitor.
    expect(document.body.textContent).not.toContain("Cristian's Computer")
  }, 20_000)

  it('never uses the relay in the owner\'s browser, which has a token', async () => {
    localStorage.setItem('gh_token', 'ghp_owner_token_for_test_only_000000000000')
    await ask('explain recursion to a ten year old')
    expect(screen.queryByRole('note')).toBeNull()
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/deepseek-16b.yml/dispatches'))).toBe(true), { timeout: 8000 })
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(RELAY))).toBe(false)
  }, 20_000)
})
