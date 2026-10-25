// @vitest-environment jsdom
// 2026-10-25 (owner): "I do want to see the illustration in my ForgeClaw chat UI. I want to see everything from ForgeClaw."
// A sim asked for in the chat offers the sim tools, and a finished sim's world is shown in the reply bubble; the model only
// ever reads the text summary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
type Body = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> }
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><title>MiroFish swarm</title></svg>'
const TICKER = 'KXUFCFIGHT-26OCT24YANDVA-YAN'
const RECORD = {
  attempt: 2, status: 'completed', reason: '', invocation_id: 'spike2-20261025-2', sides: ['Petr Yan', 'Merab Dvalishvili'], yes_side: 'Petr Yan',
  key: { card_id: 'SPIKE2-UFC333', market_ticker: TICKER }, config: { agents_prepared: 4, rounds_run: 12, active_rounds_run: 4, simulated_actions: 6 },
  extraction: { n: 4, picks: { A: 3, B: 1 }, median_p_a: 53.5, iqr_p_a: 9.8, unparsed: 0 }, lean_for_yes_side: 53.5,
  usage: { cost_usd: 0.298718, calls: 58, ceiling_usd: 0.4 }, zep: { deleted: true },
  artifacts: { world_svg: `${TICKER}.2.world.svg`, report: `${TICKER}.2.report.md` },
}
let fetchMock: ReturnType<typeof vi.fn>
let kimiTurn = 0

function github(url: string): Response {
  const content = url.match(/\/contents\/(.+)\?ref=sim-results$/)
  if (!content) return new Response('{}', { status: 404 })
  const path = decodeURIComponent(content[1])
  if (path === 'SPIKE2-UFC333') return Response.json([{ name: `${TICKER}.2.run-record.json`, type: 'file' }, { name: `${TICKER}.2.world.svg`, type: 'file' }])
  if (path.endsWith('.run-record.json')) return new Response(JSON.stringify(RECORD))
  if (path.endsWith('.world.svg')) return new Response(SVG)
  if (path.endsWith('.report.md')) return new Response('# Report\n\nThe crowd leaned Yan.')
  return new Response('', { status: 404 })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiTurn = 0
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url !== KIMI_URL) return github(url)
    kimiTurn += 1
    return kimiTurn === 1
      ? Response.json({ choices: [{ message: { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'mirofish_sim_result', arguments: JSON.stringify({ card_id: 'SPIKE2-UFC333', market_ticker: TICKER }) } }] }, finish_reason: 'tool_calls' }] })
      : Response.json({ choices: [{ message: { content: 'Here is the sim: the crowd leaned Yan, 3 to 1.' }, finish_reason: 'stop' }] })
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

async function send(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const kimiBodies = (): Body[] => fetchMock.mock.calls.filter(([url]) => String(url) === KIMI_URL).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body)

describe('MiroFish sims from the ForgeClaw chat', () => {
  it('asking for a sim offers both sim tools', async () => {
    await send('run the mirofish sim on Bonfim vs Brady')
    await waitFor(() => expect(kimiBodies().length).toBeGreaterThan(0), { timeout: 8000 })
    const names = (kimiBodies()[0].tools ?? []).map(t => t.function.name)
    expect(names).toContain('mirofish_sim')
    expect(names).toContain('mirofish_sim_result')
  }, 30_000)

  it('shows the world in the reply, full width and without taste buttons, while the model reads only the summary', async () => {
    await send('show me the last mirofish sim for SPIKE2-UFC333')
    const img = await screen.findByAltText(/MiroFish sim world/, undefined, { timeout: 15_000 }) as HTMLImageElement
    expect(img.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(img.style.width).toBe('100%')
    expect(screen.queryByTitle('Taste: fire')).toBeNull()
    await screen.findByText(/the crowd leaned Yan, 3 to 1/)
    const followUp = kimiBodies()[1]
    const toolResult = followUp.messages.find(m => m.role === 'tool')?.content ?? ''
    expect(toolResult).toContain('Final poll: 4 answered · Petr Yan 3 / Merab Dvalishvili 1')
    expect(toolResult).not.toContain('<svg')
    expect(JSON.stringify(followUp)).not.toContain('data:image/svg+xml')
  }, 30_000)
})
