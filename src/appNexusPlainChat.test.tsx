// @vitest-environment jsdom
// NEXUS walks with every provider to the chat response: a turn with no tools used a prompt that dropped the owner's
// approved heuristics, so plain-chat answers ignored what the owner had taught NEXUS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const LOCAL_URL = 'http://127.0.0.1:8080/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'local')
  localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: ['say plainly when a step failed'], rejected: [] }))
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === LOCAL_URL
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

async function systemPromptFor(prompt: string): Promise<string> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === LOCAL_URL)).toBe(true), { timeout: 8000 })
  const call = fetchMock.mock.calls.find(([url]) => String(url) === LOCAL_URL)!
  return (JSON.parse(String((call[1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }> }).messages.find(m => m.role === 'system')!.content
}

describe('NEXUS on a tool-less chat turn', () => {
  it('puts the owner\'s approved heuristics in the system prompt of a plain conversation', async () => {
    const system = await systemPromptFor('what is two plus two')
    expect(system).toContain('You are ForgeClaw, a concise and helpful AI assistant.')
    expect(system).toContain('OWNER HEURISTICS')
    expect(system).toContain('say plainly when a step failed')
  })
})
