// @vitest-environment jsdom
// 2026-10-20: the MIC button (unused, and blocked on his phone) is now a button that copies the screen as text.
// 2026-11-14: it copies only what is VISIBLE on screen (owner's requirement), so these tests give jsdom, which has no layout, a
// layout: every text node sits at ON_SCREEN unless a test moves it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const ON_SCREEN = { top: 100, bottom: 120, left: 10, right: 300 }
const OFF_SCREEN = { top: -900, bottom: -880, left: 10, right: 300 }
/** Where a text node is laid out. Default: on screen. A test can send some text far above it. */
let placeText: (text: string) => typeof ON_SCREEN = () => ON_SCREEN
function installLayout() {
  Range.prototype.selectNodeContents = function (this: Range & { _t?: string }, node: Node) { this._t = (node as Text).data }
  // jsdom gives every element a zero-size box, which would clip everything inside an overflow-hidden container: make each
  // element as big as the screen (the real browser run, in the PR, covers real clipping).
  Element.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: 768, left: 0, right: 1024, width: 1024, height: 768, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
  Range.prototype.setStart = function () {}
  Range.prototype.setEnd = function () {}
  Range.prototype.getBoundingClientRect = function (this: Range & { _t?: string }) {
    const r = placeText(this._t ?? '')
    return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect
  }
}

beforeEach(() => {
  placeText = () => ON_SCREEN
  installLayout()
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('screen text button', () => {
  it('replaces MIC and copies what is on screen', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    localStorage.setItem('forgemind_history', JSON.stringify([{ id: '1', role: 'user', content: 'a distinctive question', timestamp: Date.now() }]))
    const { default: App } = await import('./App')
    render(<App />)
    expect(screen.queryByRole('button', { name: 'MIC' })).toBeNull()
    fireEvent.click(await screen.findByTitle(/Copy what is on screen right now as text/))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(copied).toContain('ForgeClaw screen text')
    expect(copied).toContain('Scope: only what is visible on screen')
    expect(copied).toContain('a distinctive question')
    await waitFor(() => expect(screen.getByText('COPIED')).toBeTruthy())
  })

  it('leaves out a message that is scrolled off screen and keeps what is visible', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'an old question scrolled away', timestamp: Date.now() - 2000 },
      { id: '2', role: 'user', content: 'a question on screen now', timestamp: Date.now() },
    ]))
    placeText = text => (text.includes('scrolled away') ? OFF_SCREEN : ON_SCREEN)
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByTitle(/Copy what is on screen right now as text/))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(copied).toContain('a question on screen now')
    expect(copied).not.toContain('an old question scrolled away')
  })

  it('shows the text for manual copy when the browser blocks the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked') } } })
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByTitle(/Copy what is on screen right now as text/))
    const box = await screen.findByRole('dialog')
    expect((box.querySelector('textarea') as HTMLTextAreaElement).value).toContain('ForgeClaw screen text')
  })
})
