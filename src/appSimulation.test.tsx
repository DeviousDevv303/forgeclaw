// @vitest-environment jsdom
// Owner report 2026-11-14 (screenshot): under the Nexus provider, "Run a simulation of josh hokit vs ciryl gane ufc Match this
// Saturday tomorrows ufc bout" printed word salad, and the owner's order was "fix this to work correctly". The in-house fight
// simulation now runs it: on a HOSTED model chosen by the keys in Settings, with the Nexus checkpoint never asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
const OWNER_MESSAGE = 'Run a simulation of josh hokit vs ciryl gane ufc Match this Saturday tomorrows ufc bout'
let fetchMock: ReturnType<typeof vi.fn>
let personaReplies: number[]

type KimiBody = { tools?: unknown[]; messages: Array<{ role: string; content: string }> }
const kimiBodies = (): KimiBody[] => fetchMock.mock.calls.filter(([url]) => String(url) === KIMI_URL).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as KimiBody)
const isPersona = (b: KimiBody) => (b.messages.find(m => m.role === 'system')?.content ?? '').includes('five-agent fight simulation')

function stubNetwork() {
  personaReplies = [0.6, 0.55, 0.7, 0.5, 0.62]
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === KIMI_URL) {
      const body = JSON.parse(String(init?.body)) as KimiBody
      if (isPersona(body)) {
        const p = personaReplies.shift() ?? 0.5
        return Response.json({ choices: [{ message: { content: JSON.stringify({ winner: p > 0.5 ? 'A' : 'B', probability_a: p, reason: 'scripted' }) }, finish_reason: 'stop' }] })
      }
      // the research step: a plain factual packet, no tool call
      return Response.json({ choices: [{ message: { content: 'Josh Hokit is 6-0 with all wins by finish. Ciryl Gane is 13-2, a former interim champion. Scheduled for five rounds.' }, finish_reason: 'stop' }] })
    }
    return init?.method === 'POST' ? new Response(null, { status: 204 }) : new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'nexus-intelligence')
  stubNetwork()
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
  it('RUNS: with a Kimi key set, the personas run on Kimi and the report is shown; Nexus is never dispatched', async () => {
    localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
    await send(OWNER_MESSAGE)
    await screen.findByText(/Fight simulation: Josh Hokit vs Ciryl Gane/, {}, { timeout: 20000 })
    expect(screen.getByText(/Median Josh Hokit 60% \/ Ciryl Gane 40%/)).toBeTruthy()
    expect(screen.getByText(/not evidence about the fight/i)).toBeTruthy()
    expect(screen.queryByText(/checkpoint answering alone/)).toBeNull()
    expect(nexusDispatches()).toHaveLength(0)
    // one research call (with tools) and five persona calls (no tools), all to Kimi
    const bodies = kimiBodies()
    expect(bodies.filter(isPersona)).toHaveLength(5)
    expect(bodies.filter(b => !isPersona(b)).length).toBeGreaterThanOrEqual(1)
    for (const persona of bodies.filter(isPersona)) {
      expect(persona.tools ?? []).toHaveLength(0)
      // every persona saw the same facts and both fighters
      expect(persona.messages.map(m => m.content).join('\n')).toContain('Josh Hokit is 6-0')
    }
  }, 40_000)

  it('with no hosted key, says what is missing, runs nothing, and does not ask Nexus', async () => {
    await send(OWNER_MESSAGE)
    await waitFor(() => expect(screen.getAllByText(/add a Kimi or OpenRouter key/).length).toBeGreaterThanOrEqual(1), { timeout: 15000 })
    expect(kimiBodies()).toHaveLength(0)
    expect(nexusDispatches()).toHaveLength(0)
  }, 30_000)

  it('with no two sides named, asks for them and runs nothing', async () => {
    localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
    await send('run a simulation')
    await waitFor(() => expect(screen.getAllByText(/I could not tell who fights whom/).length).toBeGreaterThanOrEqual(1), { timeout: 15000 })
    expect(kimiBodies()).toHaveLength(0)
    expect(nexusDispatches()).toHaveLength(0)
  }, 30_000)

  it('control: an ordinary message under Nexus still dispatches the checkpoint', async () => {
    await send('what time is it in Tokyo')
    await waitFor(() => expect(nexusDispatches().length).toBeGreaterThanOrEqual(1), { timeout: 10000 })
    expect(screen.queryByText(/Fight simulation/)).toBeNull()
  }, 30_000)
})
