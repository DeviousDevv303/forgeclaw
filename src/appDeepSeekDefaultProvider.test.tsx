// @vitest-environment jsdom
// DEFAULT_PROVIDER is 'deepseek' (#124) while the settings selector stores 'corpus'. Both are the
// DeepSeek 16B GitHub Actions runtime, so an ordinary question must dispatch the workflow under
// either id. Before this was fixed, 'deepseek' only offered the deepseek_reason tool for prompts
// containing a complexity keyword; every other question failed without contacting GitHub.
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

// No complexity keyword (explain, analyze, design, ...) and no repository/coding words.
const ORDINARY_QUESTION = 'What causes rainbows to form after rain?'

async function sendAndFindDispatch(): Promise<{ inputs?: { task?: string } }> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: ORDINARY_QUESTION } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let body: { inputs?: { task?: string } } = {}
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).includes('deepseek-16b.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')
    expect(call).toBeTruthy()
    body = JSON.parse(String((call![1] as RequestInit).body))
  }, { timeout: 5000 })
  return body
}

describe('ordinary questions on the DeepSeek provider dispatch the workflow', () => {
  it('with no saved provider (the default, deepseek)', async () => {
    expect((await sendAndFindDispatch()).inputs?.task).toContain(ORDINARY_QUESTION)
  })

  it('with the provider saved as deepseek', async () => {
    localStorage.setItem('fm_provider', 'deepseek')
    expect((await sendAndFindDispatch()).inputs?.task).toContain(ORDINARY_QUESTION)
  })

  it('with the provider saved as corpus (the settings selector value)', async () => {
    localStorage.setItem('fm_provider', 'corpus')
    expect((await sendAndFindDispatch()).inputs?.task).toContain(ORDINARY_QUESTION)
  })
})
