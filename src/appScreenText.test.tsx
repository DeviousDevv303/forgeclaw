// @vitest-environment jsdom
// 2026-10-20: the MIC button (unused, and blocked on his phone) is now a button that copies the screen as text.
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('screen text button', () => {
  it('replaces MIC and copies what is on screen', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    localStorage.setItem('forgemind_history', JSON.stringify([{ id: '1', role: 'user', content: 'a distinctive question', timestamp: Date.now() }]))
    const { default: App } = await import('./App')
    render(<App />)
    expect(screen.queryByRole('button', { name: 'MIC' })).toBeNull()
    fireEvent.click(await screen.findByTitle(/Copy everything on screen as text/))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(copied).toContain('ForgeClaw screen text')
    expect(copied).toContain('a distinctive question')
    await waitFor(() => expect(screen.getByText('COPIED')).toBeTruthy())
  })

  it('shows the text for manual copy when the browser blocks the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked') } } })
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByTitle(/Copy everything on screen as text/))
    const box = await screen.findByRole('dialog')
    expect((box.querySelector('textarea') as HTMLTextAreaElement).value).toContain('ForgeClaw screen text')
  })
})
