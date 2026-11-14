// @vitest-environment jsdom
// Owner report 2026-11-14 (screenshot): under the Nexus provider, "Run a simulation of josh hokit vs ciryl gane ufc Match this
// Saturday tomorrows ufc bout" printed word salad from the checkpoint. MiroFish is gone and the checkpoint cannot run the
// swarm, so the app now answers honestly and spends no Actions run. A control message must still reach the checkpoint.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'nexus-intelligence')
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'POST' ? new Response(null, { status: 204 }) : new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

const nexusDispatches = () => fetchMock.mock.calls.filter(([url, init]) =>
  String(url).includes('/actions/workflows/nexus-intelligence.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')

async function send(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('a simulation request under the Nexus provider, through the real app', () => {
  it('shows the honest notice and dispatches nothing to GitHub Actions', async () => {
    await send('Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday tomorrows ufc bout')
    await screen.findByText(/No simulation was run/, {}, { timeout: 10000 })
    expect(screen.getByText(/MiroFish swarm simulation was removed/)).toBeTruthy()
    expect(screen.queryByText(/checkpoint answering alone/)).toBeNull()
    expect(nexusDispatches()).toHaveLength(0)
  }, 30_000)

  it('control: an ordinary message still dispatches the Nexus checkpoint', async () => {
    await send('what time is it in Tokyo')
    await waitFor(() => expect(nexusDispatches().length).toBeGreaterThanOrEqual(1), { timeout: 10000 })
    expect(screen.queryByText(/No simulation was run/)).toBeNull()
  }, 30_000)
})
