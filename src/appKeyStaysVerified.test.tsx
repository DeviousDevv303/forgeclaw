// @vitest-environment jsdom
// 2026-10-21 (owner): the Kimi key tested green, then after leaving the tab and coming back it was yellow again.
// "Verified" lived only in memory. It is remembered now, per exact key, until evidence says otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { keyFingerprint } from './lib/keyVerification'

const KEY = 'sk-test-kimi-key-0123456789abcdef'
let probe: 'ok' | 'offline' | 'rejected' = 'ok'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', KEY)
  probe = 'ok'
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('moonshot')) {
      if (probe === 'offline') throw new TypeError('Failed to fetch')
      if (probe === 'rejected') return new Response(JSON.stringify({ error: { message: 'Invalid Authentication' } }), { status: 401 })
      return Response.json({ data: [{ id: 'kimi-k2.7-code' }], choices: [{ message: { content: 'ok' } }] })
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function openSettings() {
  const { default: App } = await import('./App')
  const view = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))
  return view
}
const status = () => document.querySelector('[data-key-status]')?.getAttribute('data-key-status')

describe('the Kimi key stays verified', () => {
  it('shows verified after a successful test, and still after the page is closed and reopened', async () => {
    const first = await openSettings()
    expect(status()).toBe('unverified')
    fireEvent.click(screen.getByRole('button', { name: /TEST KIMI KEY/i }))
    await waitFor(() => expect(status()).toBe('verified'))
    expect(localStorage.getItem('fm_key_verified_moonshot')).toBe(keyFingerprint(KEY))
    first.unmount(); cleanup(); vi.resetModules()
    await openSettings()
    expect(status()).toBe('verified')
    expect(screen.getByText('Moonshot/Kimi API key verified')).toBeTruthy()
  })
  it('a network failure on a re-test does not take the verified state away, but says what happened', async () => {
    localStorage.setItem('fm_key_verified_moonshot', keyFingerprint(KEY))
    await openSettings()
    expect(status()).toBe('verified')
    probe = 'offline'
    fireEvent.click(screen.getByRole('button', { name: /TEST KIMI KEY/i }))
    await waitFor(() => expect(screen.getByText(/Failed to fetch|fetch/i)).toBeTruthy())
    expect(status()).toBe('verified')
  })
  it('a rejected key (401) is no longer verified', async () => {
    localStorage.setItem('fm_key_verified_moonshot', keyFingerprint(KEY))
    await openSettings()
    probe = 'rejected'
    fireEvent.click(screen.getByRole('button', { name: /TEST KIMI KEY/i }))
    await waitFor(() => expect(status()).toBe('unverified'))
    expect(localStorage.getItem('fm_key_verified_moonshot')).toBeNull()
  })
  it('a different key is unverified, and the original key is verified again when it is put back', async () => {
    localStorage.setItem('fm_key_verified_moonshot', keyFingerprint(KEY))
    await openSettings()
    const box = screen.getByPlaceholderText('sk-...') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'sk-another-key-000000000000000000' } })
    expect(status()).toBe('unverified')
    fireEvent.change(box, { target: { value: KEY } })
    expect(status()).toBe('verified')
  })
})

describe('the Claude key too', () => {
  it('shows verified on a fresh load when that exact key tested fine before', async () => {
    const claudeKey = 'sk-ant-api03-' + 'a'.repeat(40)
    localStorage.setItem('fm_provider', 'anthropic')
    localStorage.setItem('fm_anthropic_key', claudeKey)
    localStorage.setItem('fm_key_verified_anthropic', keyFingerprint(claudeKey))
    await openSettings()
    expect(screen.getByText('Claude API key verified')).toBeTruthy()
  })
})
