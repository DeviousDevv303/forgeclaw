// @vitest-environment jsdom
// The language chosen in the header must reach DeepSeek, whose workflow builds its
// own system prompt and only receives the dispatched `task` text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  fetchMock = vi.fn(async () => new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function dispatchedTask(lang: 'en' | 'es', prompt = '/deepseek ¿Cómo funciona ForgeClaw?'): Promise<string> {
  const { default: App } = await import('./App')
  render(<App />)
  fireEvent.change(screen.getByLabelText(/^(Language|Idioma)$/), { target: { value: lang } })
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let body: { inputs?: { task?: string } } = {}
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes('deepseek-16b.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')
    expect(call).toBeTruthy()
    body = JSON.parse(String((call![1] as RequestInit).body))
  }, { timeout: 5000 })
  return body.inputs?.task ?? ''
}

describe('reply language follows the header selector', () => {
  it('sends the Spanish reply instruction to DeepSeek when Español is selected', async () => {
    const task = await dispatchedTask('es')
    expect(task.startsWith('¿Cómo funciona ForgeClaw?')).toBe(true)
    expect(task).toContain('Reply language: Respond in Spanish (Latin American')
  })

  it('leaves the task unchanged in English', async () => {
    expect(await dispatchedTask('en')).toBe('¿Cómo funciona ForgeClaw?')
  })

  it('sends it on ordinary chat with the Qwen/Qwen3-8B provider too (router path)', async () => {
    localStorage.setItem('fm_provider', 'corpus')
    const task = await dispatchedTask('es', 'Explica cómo se forman los arcoíris')
    expect(task.startsWith('Explica cómo se forman los arcoíris')).toBe(true)
    expect(task).toContain('Reply language: Respond in Spanish (Latin American')
  })
})
