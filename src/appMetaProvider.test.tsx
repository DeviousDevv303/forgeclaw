// @vitest-environment jsdom
// The Meta (Muse) provider in the real Settings surface: with fm_provider=muse saved, the
// provider select carries the Muse · Meta option, the Meta Model API key section renders,
// and a typed key persists to fm_meta_key (the localStorage key the app reads back on load).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

describe('Meta (Muse) provider in Settings', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('gh_token', 'test-token')
    localStorage.setItem('fm_provider', 'muse')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    Element.prototype.scrollIntoView = () => {}
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

  it('is selectable, shows its key section, and the key persists to fm_meta_key', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))

    // The provider select offers Muse · Meta and it is the active selection.
    const option = await screen.findByRole('option', { name: 'Muse · Meta' })
    const select = option.closest('select') as HTMLSelectElement
    expect(select.value).toBe('muse')

    // The Meta key section: LLM_ placeholder, dev.meta.ai helper, test button.
    const input = screen.getByPlaceholderText('LLM_...') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(screen.getByText(/dev\.meta\.ai/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /TEST META KEY/i })).toBeTruthy()

    // Typing the key persists it under its own storage key, in the house style.
    fireEvent.change(input, { target: { value: 'LLM_test-key-1234567890abcdef' } })
    expect(localStorage.getItem('fm_meta_key')).toBe('LLM_test-key-1234567890abcdef')
  }, 20_000)

  it('loads a saved key back into the box on the next mount', async () => {
    localStorage.setItem('fm_meta_key', 'LLM_test-key-1234567890abcdef')
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))
    const input = (await screen.findByPlaceholderText('LLM_...')) as HTMLInputElement
    expect(input.value).toBe('LLM_test-key-1234567890abcdef')
  }, 20_000)
})
