// @vitest-environment jsdom
// 2026-10-22: a task still running when the page closed (iPhone killing a backgrounded tab, a reload) was marked
// "Interrupted. Send it again" and dropped. The latest one now resumes by itself when the owner is back, once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
const TASK = 'Build an English-learning website for my mom'
let kimiBodies: string[] = []

function seed(userExtra: Record<string, unknown> = {}, ageMs = 10 * 60_000) {
  const t = Date.now() - ageMs
  localStorage.setItem('forgemind_history', JSON.stringify([
    { id: 'u1', role: 'user', content: TASK, timestamp: t, ...userExtra },
    { id: 'a1', role: 'assistant', content: 'Processing…', streaming: true, timestamp: t },
  ]))
}
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}
const saved = () => JSON.parse(localStorage.getItem('forgemind_history') || '[]') as Array<{ role: string; content: string; resumedAfterInterrupt?: boolean }>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiBodies = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === KIMI_URL) {
      kimiBodies.push(String(init?.body ?? ''))
      return Response.json({ choices: [{ message: { content: 'Picked it back up.' }, finish_reason: 'stop' }] })
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

describe('a task interrupted by the page closing', () => {
  it('resumes by itself on return, once, telling the model to check what already exists', { timeout: 30000 }, async () => {
    seed()
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Picked it back up\./)).toBeTruthy(), { timeout: 20000 })
    expect(kimiBodies).toHaveLength(1)
    expect(kimiBodies[0]).toContain('Resumed task: an earlier attempt at this request was interrupted')
    // The dead attempt is replaced: the task appears once, marked as a resume.
    await waitFor(() => expect(saved().filter(m => m.role === 'user' && m.content === TASK)).toHaveLength(1))
    expect(saved().find(m => m.role === 'user')?.resumedAfterInterrupt).toBe(true)
    expect(screen.queryByText(/Interrupted: ForgeClaw was closed/)).toBeNull()
    expect(screen.getByText(/resumed after ForgeClaw was closed/)).toBeTruthy()
  })

  it('waits until the page is visible', { timeout: 30000 }, async () => {
    seed()
    setHidden(true)
    const { default: App } = await import('./App')
    render(<App />)
    await new Promise(r => setTimeout(r, 300))
    expect(kimiBodies).toHaveLength(0)
    setHidden(false)
    await waitFor(() => expect(screen.getByText(/Picked it back up\./)).toBeTruthy(), { timeout: 20000 })
    expect(kimiBodies).toHaveLength(1)
  })

  it('does not re-run a resume by itself; RESUME runs it on a tap', { timeout: 30000 }, async () => {
    seed({ resumedAfterInterrupt: true })
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/Tap RESUME to run it again/)).toBeTruthy()
    await new Promise(r => setTimeout(r, 300))
    expect(kimiBodies).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /RESUME$/ }))
    await waitFor(() => expect(screen.getByText(/Picked it back up\./)).toBeTruthy(), { timeout: 20000 })
    expect(kimiBodies).toHaveLength(1)
  })
})
