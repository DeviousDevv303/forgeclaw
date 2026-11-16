// @vitest-environment jsdom
// Bundled skills (src/skills, skills.ts): a request that matches a skill's triggers carries that skill's
// procedure in the system prompt, and an unrelated request carries none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const LOCAL_URL = 'http://127.0.0.1:8080/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'local')
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

describe('bundled skills in the chat turn', () => {
  it('adds the code-review skill to the system prompt of a review request', async () => {
    const system = await systemPromptFor('review my changes: function add(a, b) { return a - b }')
    expect(system).toContain('SKILL: evidence-code-review')
    expect(system).toContain('Try to knock down each candidate')
  })

  it('adds it when the request also offers the review tool', async () => {
    const system = await systemPromptFor('do a code review of function add(a, b) { return a - b }')
    expect(system).toContain('SKILL: evidence-code-review')
  })

  it('adds no skill to an unrelated request', async () => {
    expect(await systemPromptFor('what is two plus two')).not.toContain('SKILL:')
  })
})
