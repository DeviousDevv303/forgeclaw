// @vitest-environment jsdom
// 2026-10-23: "Look for the best bet on Kalshi for profit. Do your research well" priced high-temperature markets with
// no weather_forecast (the prompt never said "weather"), and a money question without a listed keyword got no market
// tools at all. Kimi and Claude now always get the read-only market, ledger and forecast reads; the proposal tool, which
// can place an order under the owner's autoapprove limit, is still offered only by the existing keyword lists.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
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

async function offeredTools(prompt: string): Promise<string[]> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let names: string[] = []
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url]) => String(url) === KIMI_URL)
    expect(call).toBeTruthy()
    names = ((JSON.parse(String((call![1] as RequestInit).body)).tools ?? []) as Array<{ function: { name: string } }>).map(t => t.function.name)
  }, { timeout: 8000 })
  return names
}

describe('money questions in any wording reach the market reads', () => {
  it('the 2026-10-23 "best bet on Kalshi" prompt now has the forecast its weather markets need', async () => {
    expect(await offeredTools('Look for the best bet on Kalshi for profit. Do your research well')).toEqual(expect.arrayContaining(['kalshi_markets', 'funds_status', 'weather_forecast']))
  }, 15_000)

  it('a question with none of the listed keywords still gets the read-only reads, and no proposal tool', async () => {
    const names = await offeredTools('where should I put $50 this weekend for the best return?')
    expect(names).toEqual(expect.arrayContaining(['kalshi_markets', 'funds_status', 'weather_forecast']))
    expect(names).not.toContain('funds_propose')
    expect(names).not.toContain('funds_settle')
  }, 15_000)
})
