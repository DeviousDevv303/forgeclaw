// @vitest-environment jsdom
// Family access on a phone (owner's report from Layla's iPhone, 2026-11-22): in the locked
// state there was no visible place to enter the family code (it lived only inside a collapsed
// Settings section), the tab bar scrolled its tabs off the visible edge with ~30px targets,
// and the app root double-declared the viewport height under the safe-area padding. jsdom has
// no layout engine, so — like appPhoneLayout.test.tsx — this pins the rules that fix each
// defect, plus the behaviour: the code can be entered from the chat surface a family member
// lands on, every tab answers a tap in the locked state, and the lock itself is unchanged
// (a no-code visitor still sees none of the owner's surfaces).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const RELAY = 'https://relay.example'
beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_PUBLIC_RELAY_URL', RELAY)
  vi.stubEnv('VITE_GITHUB_TOKEN', '')
  vi.stubEnv('VITE_GH_TOKEN', '')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

async function renderApp() {
  const { default: App } = await import('./App')
  return render(<App />)
}

describe('family access (locked phone)', () => {
  it('shows the family-code entry on the chat surface itself, no Settings trip needed', async () => {
    await renderApp()
    expect(screen.getByTestId('family-code-entry')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Enter the family code$/ })).toBeTruthy()
    // The entry starts as a button: the locked chat keeps exactly one text box (the composer).
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    // Still locked: the free-mode notice is up and the owner's NEXUS tab is nowhere.
    expect(screen.getByRole('note').textContent).toMatch(/^Free mode:/)
    expect(screen.queryByRole('button', { name: /^NEXUS$/ })).toBeNull()
  })

  it('unlocks from that entry: notice and entry go away, NEXUS appears, code persists', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Enter the family code$/ }))
    fireEvent.change(screen.getByPlaceholderText('Enter the family code'), { target: { value: 'lighthouse-test' } })
    fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }))
    await waitFor(() => expect(screen.queryByTestId('family-code-entry')).toBeNull())
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('button', { name: /^NEXUS$/ })).toBeTruthy()
    expect(localStorage.getItem('forgeclaw_family_code')).toBe('lighthouse-test')
  })

  it('every tab answers a tap in the locked state', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^SETTINGS$/i }))
    // Settings renders its sections (the GitHub section holds the same family field).
    expect(await screen.findByText('Founder / Guardian Principles')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^ACTIVITY$/i }))
    expect(await screen.findByText('EXECUTION LOG')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^FORGE$/i }))
    expect(await screen.findByTestId('family-code-entry')).toBeTruthy()
  })

  it('keeps the lock: a no-code visitor sees none of the owner-only settings content', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^SETTINGS$/i }))
    expect(await screen.findByText('Founder / Guardian Principles')).toBeTruthy()
    // Kalshi trading keys stay hidden in visitor mode.
    expect(screen.queryByText('Kalshi Trading — API Key')).toBeNull()
  })

  it('family mode reaches the owner surfaces a visitor cannot: NEXUS tab and Kalshi section', async () => {
    localStorage.setItem('forgeclaw_family_code', 'lighthouse-test')
    await renderApp()
    expect(screen.getByRole('button', { name: /^NEXUS$/ })).toBeTruthy()
    expect(screen.queryByTestId('family-code-entry')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^SETTINGS$/i }))
    expect(await screen.findByText('Kalshi Trading — API Key')).toBeTruthy()
  })

  it('owner-token browser never sees the family entry (it is already unlocked)', async () => {
    localStorage.setItem('gh_token', 'ghp_owner_token_for_test_only_000000000000')
    await renderApp()
    expect(screen.queryByTestId('family-code-entry')).toBeNull()
    expect(screen.getByRole('button', { name: /^NEXUS$/ })).toBeTruthy()
  })
})

describe('phone navigation rules (pinned styles)', () => {
  it('tab bar wraps so no tab can scroll off the visible edge, with real touch targets', async () => {
    const { container } = await renderApp()
    const settingsTab = screen.getByRole('button', { name: /^SETTINGS$/i })
    const tabBar = settingsTab.parentElement as HTMLElement
    expect(tabBar.style.flexWrap).toBe('wrap')
    expect(settingsTab.style.minHeight).toBe('40px')
    expect(settingsTab.style.touchAction).toBe('manipulation')
    // The app root fills the safe-area-padded #root box instead of re-declaring 100dvh
    // (which double-counted the viewport height and pushed content past the screen).
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe('100%')
  })
})
