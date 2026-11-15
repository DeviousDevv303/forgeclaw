// @vitest-environment jsdom
// The owner's live Nexus call (2026-11-13) was github_read_file {path ":", owner ".", start_line 257257207}. A call like that
// is refused before dispatch with a legible reason (githubArgCheck.ts). What must also hold, and what only a real turn shows:
//  - the refusal is a call that NEVER RAN, so a later corrected call resolves it and the turn completes (the completion
//    guard pairs a failure with a later success only when the inputs match, unless the attempt is marked never-run), and
//  - when the model gives up after the refusal and answers in prose, the turn still ends BLOCKED, as the owner requires.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type KimiBody = { messages: Array<{ role: string; content: string; tool_call_id?: string }> }
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>
let kimiReplies: unknown[]

const call = (id: string, args: Record<string, unknown>) => ({
  choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name: 'github_read_file', arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }],
})
const say = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiReplies = []
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === KIMI_URL) return Response.json(kimiReplies.shift() ?? say('Done.'))
    if (url.includes('/contents/README.md')) return Response.json({ content: btoa('# ForgeClaw\n'), encoding: 'base64', size: 12 })
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

const kimiBodies = (): KimiBody[] => fetchMock.mock.calls
  .filter(([url]) => String(url) === KIMI_URL)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as KimiBody)
// The app also reads a few directories on its own (war-room, whatsapp-inbox); those are not the model's reads.
const githubReads = () => fetchMock.mock.calls.map(([url]) => String(url))
  .filter(url => url.includes('api.github.com') && url.includes('/contents/') && !/\/contents\/(?:war-room|whatsapp-inbox)/.test(url))

async function ask(prompt: string, expectedKimiCalls: number) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(kimiBodies().length).toBeGreaterThanOrEqual(expectedKimiCalls), { timeout: 10000 })
}

const BAD = { path: ':', owner: '.', start_line: 257257207 }
const PROMPT = 'read README.md in the repo and tell me its first line'

describe('a refused GitHub read in a real turn', () => {
  it('sends no request for the refused call, tells the model why, and a corrected call completes the turn', async () => {
    kimiReplies.push(call('c1', BAD), call('c2', { path: 'README.md' }), say('The first line of README.md is "# ForgeClaw".'))
    await ask(PROMPT, 3)
    await screen.findByText(/first line of README\.md is/, {}, { timeout: 10000 })
    // Only the corrected read reached GitHub: nothing for path ":" or owner ".".
    expect(githubReads()).toHaveLength(1)
    expect(githubReads()[0]).toContain('/contents/README.md')
    // The model was told, legibly, what was wrong with its first call.
    const refusal = kimiBodies()[1].messages.find(m => m.role === 'tool' && m.tool_call_id === 'c1')
    expect(refusal?.content).toMatch(/^\[TOOL ERROR\]/)
    for (const field of ['owner', 'path', 'start_line']) expect(refusal?.content).toContain(field)
    // The refusal never ran, so the corrected call resolves it: the turn is not marked BLOCKED, for either reason.
    expect(screen.queryByText(/was not successfully resolved/)).toBeNull()
    expect(screen.queryByText(/STATUS: BLOCKED/)).toBeNull()
    expect(screen.queryByText(/Repository evidence was not obtained/)).toBeNull()
  }, 40_000)

  it('when the model answers in prose after the refusal, the turn still ends BLOCKED', async () => {
    kimiReplies.push(call('c1', BAD), say('It starts with a heading, I believe.'))
    await ask(PROMPT, 2)
    // The owner's exact observed outcome: the guard refuses a completion with no real GitHub tool result behind it.
    await screen.findByText(/Repository evidence was not obtained from an actual GitHub tool result/, {}, { timeout: 10000 })
    expect(githubReads()).toHaveLength(0)
  }, 40_000)
})
