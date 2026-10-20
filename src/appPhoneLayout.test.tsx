// @vitest-environment jsdom
// 2026-10-20 (phone screenshot): a long URL ran past the edge of the reply box, and the header pushed EXPORT off
// the screen. jsdom has no layout engine, so this pins the rules that prevent both; the real measurement
// (nothing wider than the screen at 412 and 360 px) was done in headless Chromium on the production build.
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

describe('phone layout rules', () => {
  it('wraps long links inside the reply and makes them tappable', async () => {
    const url = 'https://github.com/DeviousDevv303/forgeclaw/pull/185'
    const t = Date.now()
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'hi', timestamp: t - 2000 },
      { id: '2', role: 'assistant', content: `Proposed as PR #185: ${url}\n— ForgeClaw`, timestamp: t - 1000, agentPhase: 'COMPLETE' },
    ]))
    const { default: App } = await import('./App')
    render(<App />)
    const link = (await screen.findByRole('link', { name: url })) as HTMLAnchorElement
    expect(link.href).toBe(url)
    expect(link.style.overflowWrap).toBe('anywhere')
    expect(link.parentElement!.style.overflowWrap).toBe('anywhere')
    const bubble = link.closest('div[style*="border-radius: 10px"]') as HTMLElement
    expect(bubble.style.overflowWrap).toBe('anywhere')
    expect(parseFloat(bubble.style.minWidth)).toBe(0)
  })

  it('lets the header and tab bar wrap or scroll instead of running off the screen', async () => {
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    const header = container.querySelector('header') as HTMLElement
    expect(header.style.flexWrap).toBe('wrap')
    const tabs = screen.getByRole('button', { name: /^SETTINGS$/i }).parentElement as HTMLElement
    expect(tabs.style.overflowX).toBe('auto')
  })
})
