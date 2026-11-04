// @vitest-environment jsdom
// 2026-11-04: ForgeClaw answered "Run a simulation of Makachev vs Nurmagomedov" with a trading answer from a chat two weeks old.
// The saved chat has no expiry and every Qwen dispatch carried its last 6 messages as "the conversation so far". These tests
// drive the real App from saved history to the body of the workflow dispatch, the last place the app controls what Qwen sees.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let fetchMock: ReturnType<typeof vi.fn>
const OLD_TRADING_ANSWER = 'The best time to trade is during periods of high liquidity and volatility, around major market events.'
const FIGHT = 'Run a simulation of Islam Makachev vs Khabib Nurmagomedov'

function seedChat(ageMs: number, turns: Array<[role: 'user' | 'assistant', content: string]>) {
  const base = Date.now() - ageMs
  localStorage.setItem('forgemind_history', JSON.stringify(turns.map(([role, content], i) => ({ id: `seed-${i}`, role, content, timestamp: base + i * 1000, streaming: false }))))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  fetchMock = vi.fn(async () => new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function dispatchedFor(prompt: string): Promise<{ task: string; context: string }> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let inputs: { task?: string; context?: string } = {}
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes('qwen3-8b.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')
    expect(call).toBeTruthy()
    inputs = JSON.parse(String((call![1] as RequestInit).body)).inputs
  }, { timeout: 8000 })
  return { task: inputs.task ?? '', context: inputs.context ?? '' }
}

const DAY = 24 * 3600_000
const tradingThread: Array<['user' | 'assistant', string]> = [['user', 'What is the best time to trade?'], ['assistant', OLD_TRADING_ANSWER]]

describe('what Qwen is sent after a long gap in the saved chat', () => {
  it('a new topic after a two-week-old thread carries none of it', async () => {
    seedChat(14 * DAY, tradingThread)
    const sent = await dispatchedFor(FIGHT)
    expect(sent.task).toContain(FIGHT)
    expect(sent.context).not.toMatch(/best time to trade|liquidity|volatility/i)
  })

  it('a follow-up that refers back ("that") to a two-week-old thread still carries none of it: the age cutoff, not the topic gate', async () => {
    seedChat(14 * DAY, tradingThread)
    const sent = await dispatchedFor('Now simulate that fight again with Makachev at lightweight')
    expect(sent.context).not.toMatch(/best time to trade|liquidity|volatility/i)
  })

  it('question, answer, follow-up, answer, then another follow-up: the live thread arrives whole and the two-week-old one does not', async () => {
    const old = Date.now() - 14 * DAY
    const recent = Date.now() - 10 * 60_000
    const turn = (id: string, role: 'user' | 'assistant', content: string, timestamp: number) => ({ id, role, content, timestamp, streaming: false })
    localStorage.setItem('forgemind_history', JSON.stringify([
      turn('old-q', 'user', 'What is the best time to trade?', old),
      turn('old-a', 'assistant', OLD_TRADING_ANSWER, old + 1000),
      turn('q1', 'user', 'Compare the wrestling of Makachev and Nurmagomedov', recent),
      turn('a1', 'assistant', 'Nurmagomedov relied on chain wrestling and sustained cage control; Makachev adds sharper striking entries.', recent + 1000),
      turn('q2', 'user', 'Who wins the clinch exchanges?', recent + 2000),
      turn('a2', 'assistant', 'Nurmagomedov, by smothering pressure against the fence.', recent + 3000),
    ]))
    const sent = await dispatchedFor('And why would that matter on the feet?')
    expect(sent.context).toContain('Compare the wrestling of Makachev and Nurmagomedov')
    expect(sent.context).toContain('smothering pressure against the fence')
    expect(sent.context).not.toMatch(/best time to trade|liquidity|volatility/i)
  })

  it('a thread from minutes ago still reaches a short follow-up (the gate does not over-filter)', async () => {
    seedChat(5 * 60_000, tradingThread)
    const sent = await dispatchedFor('and why?')
    expect(sent.context).toContain(OLD_TRADING_ANSWER)
  })
})
