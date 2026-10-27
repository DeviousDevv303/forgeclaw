// @vitest-environment jsdom
// 2026-10-27 (owner): "make sure the key stays saved once I input it". The app used to read each saved key through its provider's
// format check on load and return '' when it failed; the persistence effect then overwrote storage with '', so a key with a stray
// character in it (a cut-off paste, a key in the wrong field) was silently erased on the next reload. A saved key now stays saved,
// whatever its shape: the format is judged where the key is used (send/test) and in Diagnostics, never by discarding it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

// Built from parts so no key-shaped literal sits in source (the protected-path guard refuses one). None of these is a valid key for its slot.
const WRONG_SHAPE = ['not', 'a', 'key', 'for', 'any', 'provider'].join('-')
const SLOTS = ['fm_anthropic_key', 'fm_moonshot_key', 'fm_meta_key', 'fm_openrouter_key'] as const

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('a saved key stays saved', () => {
  it.each(SLOTS)('%s survives a reload even when it is not in the expected shape', async (slot) => {
    const saved = `${WRONG_SHAPE}-${slot}`
    localStorage.setItem(slot, saved)
    const { default: App } = await import('./App')
    render(<App />)
    // The persistence effects have run once the app has mounted and settled; the saved value must still be there.
    await waitFor(() => expect(document.body.textContent).not.toBe(''))
    expect(localStorage.getItem(slot)).toBe(saved)
  }, 20_000)
})
