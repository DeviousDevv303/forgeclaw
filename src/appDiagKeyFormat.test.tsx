// @vitest-environment jsdom
// F-017: the Diagnostics panel's "Key format valid" hint must read the provider's own
// format gate (isConfigured — the exact check send() enforces by throwing
// 'Invalid ... API key format'), not mere presence. The Settings inputs write raw
// keystrokes into state, so a malformed key is reachable in-session while the provider
// treats it as no key at all; the panel must not call it format-valid.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { diagKeyFormat, diagKeyFormatValid } from './lib/diagKeyFormat'
import { keyFormatProblem } from './lib/ai/keyFormat'
import { ANTHROPIC_KEY_FORMAT, anthropicProvider } from './lib/ai/providers/anthropicProvider'
import { MOONSHOT_KEY_FORMAT, moonshotProvider } from './lib/ai/providers/moonshotProvider'

describe('diagKeyFormatValid (F-017)', () => {
  it('rejects a malformed anthropic key the provider would refuse', () => {
    expect(diagKeyFormatValid('anthropic', 'abc', '', true)).toBe(false)
  })

  it('accepts a well-formed anthropic key', () => {
    expect(diagKeyFormatValid('anthropic', 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx', '', true)).toBe(true)
  })

  it('rejects a malformed moonshot key the provider would refuse', () => {
    expect(diagKeyFormatValid('moonshot', '', 'abc', true)).toBe(false)
  })

  it('accepts a well-formed moonshot key', () => {
    expect(diagKeyFormatValid('moonshot', '', 'sk-xxxxxxxxxxxxxxxxxxxxxxxx', true)).toBe(true)
  })

  it('falls back to presence for providers with no key-format gate', () => {
    expect(diagKeyFormatValid('local', '', '', true)).toBe(true)
    expect(diagKeyFormatValid('local', '', '', false)).toBe(false)
  })
})

// Follow-up: the verdict came from the provider's gate, but the reason kept its own prefix-only copy of a
// prefix-and-length rule, so a short sk-ant- key was told "expected sk-ant-...". Reason and verdict now share one rule.
describe('the reason comes from the same rule as the verdict', () => {
  const KEYS = ['', 'abc', 'sk-', 'sk-short', 'sk-ant-', 'sk-ant-short', `sk-${'x'.repeat(17)}`, `sk-${'x'.repeat(18)}`, `sk-ant-${'x'.repeat(14)}`, `  sk-ant-${'x'.repeat(14)}  `, `sk-ant-${'x'.repeat(13)}`]
  it('isConfigured is exactly "no format problem", for both providers', () => {
    for (const key of KEYS) {
      expect(anthropicProvider.isConfigured(key), key).toBe(keyFormatProblem(key, ANTHROPIC_KEY_FORMAT) === null)
      expect(moonshotProvider.isConfigured(key), key).toBe(keyFormatProblem(key, MOONSHOT_KEY_FORMAT) === null)
    }
  })
  it('a short key with the right prefix is too short, not missing its prefix', () => {
    expect(diagKeyFormat('anthropic', 'sk-ant-short', '', true)).toEqual({ valid: false, problem: { kind: 'length', prefix: 'sk-ant-', length: 12, minLength: 21 } })
    expect(diagKeyFormat('moonshot', '', 'abc', true)).toEqual({ valid: false, problem: { kind: 'prefix', prefix: 'sk-' } })
    expect(diagKeyFormat('moonshot', '', `sk-${'x'.repeat(18)}`, true)).toEqual({ valid: true, problem: null })
  })
})

describe('the Diagnostics panel never calls a malformed key valid (render)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('gh_token', 'test-token')
    localStorage.setItem('fm_provider', 'moonshot')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    Element.prototype.scrollIntoView = () => {}
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

  it('garbage, then a short sk- key, then a real-format key: the hint follows the gate each time', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))
    const input = screen.getByPlaceholderText('sk-...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(await screen.findByText('Key format invalid — expected sk-...')).toBeTruthy()
    expect(screen.queryByText('Key format valid')).toBeNull()
    fireEvent.change(input, { target: { value: 'sk-short' } })
    expect(await screen.findByText('Key format invalid — 8 characters; a sk- key needs at least 21')).toBeTruthy()
    expect(screen.queryByText('Key format valid')).toBeNull()
    fireEvent.change(input, { target: { value: `sk-${'x'.repeat(18)}` } })
    expect(await screen.findByText('Key format valid')).toBeTruthy()
  }, 20_000)
})
