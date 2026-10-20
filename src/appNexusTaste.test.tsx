// @vitest-environment jsdom
// 2026-10-20: NEXUS Taste asked the owner for a port and a key (a separate service on 127.0.0.1:8377, "offline" on
// a phone). It is part of NEXUS now: reactions to any picture teach it, the NEXUS tab shows it, nothing to configure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('./lib/nexusTaste', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/nexusTaste')>()
  return { ...mod, imageTasteSample: vi.fn(async () => ({ features: { brightness: 0.8, contrast: 0.4, saturation: 0.7, warmth: 0.8 }, palette: ['#f80808'] })) }
})

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

describe('NEXUS taste is built in', () => {
  it('learns from a reaction to a generated picture, and shows it on the NEXUS tab', async () => {
    const t = Date.now()
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'draw a mountain viewpoint', timestamp: t - 2000 },
      { id: '2', role: 'assistant', content: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', timestamp: t - 1000, agentPhase: 'COMPLETE' },
    ]))
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByTitle('Taste: fire'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('nexus_taste_v1') || '{}').liked?.n).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: /^NEXUS$/ }))
    expect(await screen.findByLabelText('Your taste')).toBeTruthy()
    expect(screen.getByLabelText('Your taste').textContent).toMatch(/2 liked · 0 disliked · 1 more liked to start steering/)
  })

  it('no longer asks for a port, a key or a service anywhere', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^SETTINGS$/i }))
    await screen.findByText(/SELF-SCULPT KEY/i)
    expect(document.body.textContent).not.toMatch(/NEXUS Taste|127\.0\.0\.1:8377|SAVE \/ CHECK/i)
  })

  it('hides the reactions from a free-mode visitor, who has no NEXUS tab', async () => {
    vi.stubEnv('VITE_PUBLIC_RELAY_URL', 'https://relay.example')
    localStorage.removeItem('gh_token')
    const t = Date.now()
    localStorage.setItem('forgemind_history', JSON.stringify([{ id: '2', role: 'assistant', content: 'here', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', timestamp: t, agentPhase: 'COMPLETE' }]))
    const { default: App } = await import('./App')
    render(<App />)
    await screen.findByText(/here/)
    expect(screen.queryByTitle('Taste: fire')).toBeNull()
    vi.unstubAllEnvs()
  })
})

describe('taste reactions look like the reply thumbs', () => {
  it('a chosen reaction is blue, not orange', async () => {
    const t = Date.now()
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'hi', timestamp: t - 2000 },
      { id: '2', role: 'assistant', content: '', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', timestamp: t - 1000, agentPhase: 'COMPLETE' },
    ]))
    const { default: App } = await import('./App')
    render(<App />)
    const up = await screen.findByTitle('Taste: up')
    fireEvent.click(up)
    await waitFor(() => expect((screen.getByTitle('Taste: up') as HTMLElement).style.background).toBe('rgb(37, 99, 235)'))
    expect((screen.getByTitle('Taste: up') as HTMLElement).outerHTML).not.toMatch(/f97316|249, 115, 22/i)
  })
})
