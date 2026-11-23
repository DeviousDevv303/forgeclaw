// @vitest-environment jsdom
// "Search the web, then make me an image": the chat must run the web search FIRST and send what it found to the image
// generator, instead of handing the whole sentence (search instruction included) to the diffusion model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const GITHUB = 'https://api.github.com/'
const DDG_INSTANT = 'https://api.duckduckgo.com/'
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
const ASK = 'search the web for what a quokka looks like, then make me an image of one on a beach'
let fetchMock: ReturnType<typeof vi.fn>
let order: string[]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  order = []
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith(DDG_INSTANT)) { order.push('search'); return Response.json({ AbstractText: 'The quokka is a small marsupial with round ears and a short, broad face.' }) }
    if (url.includes('/generate-image.yml/dispatches')) { order.push('image'); return new Response('{"message":"stop here"}', { status: 422 }) }
    if (url.startsWith(GITHUB)) return new Response('{}', { status: 404 })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

describe('search first, then image', () => {
  it('runs web_search before generate_image and gives the generator the findings, not the search instruction', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: ASK } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(order).toContain('image'), { timeout: 20_000 })
    expect(order.indexOf('search')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('search')).toBeLessThan(order.indexOf('image'))
    const dispatch = fetchMock.mock.calls.find(([url]) => String(url).includes('/generate-image.yml/dispatches'))!
    const prompt = String(JSON.parse(String((dispatch[1] as RequestInit).body)).inputs.prompt)
    expect(prompt).toMatch(/image of one on a beach/)
    expect(prompt).toMatch(/small marsupial/)
    expect(prompt).not.toMatch(/search the web/i)
    // The router ran both steps itself: Kimi was never asked to decide, and no file/shell tool ran.
    expect(fetchMock.mock.calls.some(([url]) => String(url) === KIMI_URL)).toBe(false)
  }, 40_000)
})
