// @vitest-environment jsdom
// 2026-10-22: on an iPhone, switching to another app (browser still open) killed the in-flight model request. The run
// ended with "I hit a temporary connection problem ... (Failed to fetch)": only one whole-task retry was allowed, and
// it started over from scratch. Now the cut-off step is asked again on return, every time, keeping the run's progress.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
type KimiBody = { messages: Array<{ role: string; tool_call_id?: string }> }
let kimiBodies: KimiBody[] = []
let readmeReads = 0
let replies: Array<'leave' | object> = []

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiBodies = []; readmeReads = 0
  replies = [
    { choices: [{ message: { content: '', tool_calls: [{ id: 'call_r', type: 'function', function: { name: 'github_read_file', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }] },
    'leave',
    'leave',
    { choices: [{ message: { content: 'All done reading.' }, finish_reason: 'stop' }] },
  ]
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === KIMI_URL) {
      kimiBodies.push(JSON.parse(String(init?.body)) as KimiBody)
      const next = replies.shift() ?? { choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] }
      if (next === 'leave') {
        // The owner switches apps: the page is hidden and the request dies; they come back shortly after.
        setHidden(true)
        setTimeout(() => setHidden(false), 30)
        throw new TypeError('Failed to fetch')
      }
      return Response.json(next)
    }
    if (url.includes('/contents/README.md') && (!init?.method || init.method === 'GET')) {
      readmeReads++
      return Response.json({ content: btoa('# ForgeClaw'), encoding: 'base64', size: 11 })
    }
    return new Response('{}', { status: 404 })
  }))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }) })

describe('leaving the app mid-run', () => {
  it('picks the run back up on every return, without redoing finished steps', { timeout: 30000 }, async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = await screen.findByPlaceholderText(/Ask anything/i)
    fireEvent.change(box, { target: { value: 'read the README file in the repo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/All done reading\./)).toBeTruthy(), { timeout: 20000 })
    expect(screen.queryByText(/temporary connection problem/)).toBeNull()
    expect(kimiBodies).toHaveLength(4)
    // The step already done is kept, not redone: the README was read once and its result went back to the model.
    expect(readmeReads).toBe(1)
    expect(kimiBodies[3].messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_r')).toBe(true)
    const saved = JSON.parse(localStorage.getItem('forgemind_history') || '[]') as Array<{ role: string; content: string }>
    expect(saved.filter(m => m.role === 'user' && m.content === 'read the README file in the repo')).toHaveLength(1)
  })
})
