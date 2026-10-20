// @vitest-environment jsdom
// 2026-10-20 (Muse's diagnosis): a finished reply showed a present-tense activity label taken from its
// last tool, e.g. a generated image's bubble ended with " · Generating image" after the image was done.
// A finished bubble shows its content (and signature) only.
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

describe('finished replies', () => {
  it('show no leftover activity label from their last tool', async () => {
    const now = Date.now()
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'draw a red fox', timestamp: now - 2000 },
      { id: '2', role: 'assistant', content: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', timestamp: now - 1000, agentPhase: 'COMPLETE', toolResults: [{ toolCallId: 'a', name: 'generate_image', output: 'ok' }] },
      { id: '3', role: 'user', content: 'run ls', timestamp: now - 900 },
      { id: '4', role: 'assistant', content: 'Done.', timestamp: now - 800, agentPhase: 'COMPLETE', toolResults: [{ toolCallId: 'b', name: 'shell_exec', output: 'ok' }] },
    ]))
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/Done\./)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/·\s*(Generating image|Running shell command)/)
  })
})
