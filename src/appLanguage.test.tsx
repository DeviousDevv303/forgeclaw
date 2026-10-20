// @vitest-environment jsdom
// End-to-end check of the user-visible requirement: choosing a language in the header selector
// changes the interface, in both directions, and the choice survives a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function mountApp() {
  const { default: App } = await import('./App')
  return render(<App />)
}
const selector = () => screen.getByLabelText(/^(Language|Idioma)$/) as HTMLSelectElement
const tabs = () => ['FORGE', 'AGENTS', 'NEXUS', 'ACTIVITY', 'SETTINGS']

describe('language selector in the header', () => {
  it('opens in English, switches the whole chrome to Spanish, and switches back', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    await mountApp()
    for (const label of tabs()) expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.getByPlaceholderText(/Ask anything/)).toBeTruthy()
    expect(selector().value).toBe('en')

    fireEvent.change(selector(), { target: { value: 'es' } })
    for (const label of ['FORJA', 'AGENTES', 'NEXUS', 'ACTIVIDAD', 'AJUSTES']) expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.getByPlaceholderText(/Pregunta lo que quieras/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ENVIAR' })).toBeTruthy()
    expect(screen.getByText('Sistema iniciado. Esperando instrucciones...')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'BORRAR' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('es-MX')
    expect(localStorage.getItem('fc_lang')).toBe('es')
    expect(screen.queryByRole('button', { name: 'SETTINGS' })).toBeNull()

    fireEvent.change(selector(), { target: { value: 'en' } })
    for (const label of tabs()) expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.getByText('System initialized. Awaiting input...')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('translates the Settings and Activity screens too', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    await mountApp()
    fireEvent.change(selector(), { target: { value: 'es' } })
    fireEvent.click(screen.getByRole('button', { name: 'AJUSTES' }))
    expect(screen.getByText('Proveedor de ejecución')).toBeTruthy()
    expect(screen.getByText('ESTADO DEL OPERADOR')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ACTIVIDAD' }))
    expect(screen.getByText('AÚN NO HAY ACTIVIDAD')).toBeTruthy()
    // The MIC tab became the NEXUS Recursive Learning page (2026-10-20); voice input stays on the chat bar.
    fireEvent.click(screen.getByRole('button', { name: 'NEXUS' }))
    expect(screen.getByText('My Logic Is Undeniable')).toBeTruthy()
  })

  it('remembers Spanish after a reload', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    localStorage.setItem('fc_lang', 'es')
    await mountApp()
    expect(selector().value).toBe('es')
    expect(screen.getByRole('button', { name: 'AJUSTES' })).toBeTruthy()
  })

  it('opens in Spanish on a phone whose language is Mexican Spanish, until the user chooses otherwise', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['es-MX', 'en-US'], configurable: true })
    await mountApp()
    expect(selector().value).toBe('es')
    expect(screen.getByRole('button', { name: 'ENVIAR' })).toBeTruthy()
  })
})
