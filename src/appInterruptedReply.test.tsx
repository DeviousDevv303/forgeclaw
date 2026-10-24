// @vitest-environment jsdom
// 2026-10-20: two image requests showed "Still working · 424:55" for hours. A reply that was still running when
// the page closed is restored as running forever, because its request died with the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('replies interrupted by a reload', () => {
  it('are marked interrupted instead of "Still working" forever', async () => {
    // Older than the auto-resume window (interruptedTask.ts), so it waits for a tap instead of re-running.
    const t = Date.now() - 13 * 3600_000
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'Generate me an image of a mirador', timestamp: t },
      { id: '2', role: 'assistant', content: '', streaming: true, timestamp: t },
    ]))
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/Interrupted: Nexus Intelligence was closed or reloaded before this finished/)).toBeTruthy()
    expect(screen.queryByText(/Still working/)).toBeNull()
    expect(screen.getByText(/Tap RESUME to run it again/)).toBeTruthy()
  })
})
