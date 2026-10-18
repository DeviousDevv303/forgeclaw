// @vitest-environment jsdom
// The real app must feed window.forgeCore from its ForgeOps stream, so the cube
// visual layer receives `forgeclaw:state` events (docs/INTEGRATION.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); delete window.forgeCore })

describe('reactive core wiring in App', () => {
  it('broadcasts forgeclaw:state from real app activity', async () => {
    const states: Array<{ state: string; source: string }> = []
    const onState = (e: Event) => states.push((e as CustomEvent).detail)
    window.addEventListener('forgeclaw:state', onState)
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '/deepseek what is ForgeClaw?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(states.some(s => s.state === 'running')).toBe(true), { timeout: 5000 })
    expect(states[0].state).toBe('thinking')
    expect(window.forgeCore?.getSnapshot()).toBeTruthy()
    window.removeEventListener('forgeclaw:state', onState)
  })
})
