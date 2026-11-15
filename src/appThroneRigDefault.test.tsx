// @vitest-environment jsdom
// Owner order 2026-11-10: the throne swarm is the default scene. Before this change ThroneRig mounted in
// App.tsx only behind ?rig=1, so the plain app never showed the rig at all. These tests pin the new law at
// the App level: with NO query params the rig mounts in live mode (spiders bound to the real event stream),
// and demo still requires its explicit ?spiders=demo override (labelled DEMO, fed by scripted events only).
//
// Timeouts: the explicit 30s test / 10s find timeouts are an instrument adjustment, not weaker assertions.
// The first test in a file pays the cold transform + import of the whole App module graph, which on this
// shared 1.5-CPU VM exceeds vitest's 5s default while other lanes run (the same load shape flaked
// appKeyStaysVerified / appLanguage in earlier gates and cleared on solo re-runs). The DOM assertions are
// unchanged: if the rig did not mount, findByTestId still fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); window.history.pushState({}, '', '/') })

describe('throne rig is the default scene', () => {
  it('mounts the rig in live mode with no query params at all', async () => {
    expect(window.location.search).toBe('')
    const { default: App } = await import('./App')
    render(<App />)
    const panel = await screen.findByTestId('spider-panel', undefined, { timeout: 10000 })
    expect(panel.getAttribute('data-source')).toBe('live')
    expect(screen.queryByTestId('spider-demo-flag')).toBeNull()
  }, 30000)

  it('keeps demo behind its explicit ?spiders=demo override', async () => {
    window.history.pushState({}, '', '/?spiders=demo')
    const { default: App } = await import('./App')
    render(<App />)
    const panel = await screen.findByTestId('spider-panel', undefined, { timeout: 10000 })
    expect(panel.getAttribute('data-source')).toBe('demo')
    expect(screen.getByTestId('spider-demo-flag')).toBeTruthy()
  }, 30000)

  it('ignores the retired ?rig=1 flag: live mode either way', async () => {
    window.history.pushState({}, '', '/?rig=1')
    const { default: App } = await import('./App')
    render(<App />)
    const panel = await screen.findByTestId('spider-panel', undefined, { timeout: 10000 })
    expect(panel.getAttribute('data-source')).toBe('live')
    expect(screen.queryByTestId('spider-demo-flag')).toBeNull()
  }, 30000)
})
