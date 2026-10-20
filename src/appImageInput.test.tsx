// @vitest-environment jsdom
// 2026-10-20: a picture sent with Kimi selected got an answer about ForgeClaw. The image never reached
// the model: its base64 was pasted into the prompt text and analyze_image (a URL-only workflow that
// never returns its result) was the only "vision". Claude and Kimi now receive the picture itself;
// providers that can't see pictures say so instead of answering blind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
type Part = { type: string; text?: string; image_url?: { url: string } }
type KimiBody = { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string | Part[] }> }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === KIMI_URL) return Response.json({ choices: [{ message: { content: 'A particle detector at CERN.' }, finish_reason: 'stop' }] })
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

async function sendPicture(caption: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const file = new File([Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0))], 'cern.png', { type: 'image/png' })
  const picker = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => { fireEvent.change(picker, { target: { files: [file] } }) })
  await waitFor(() => expect(screen.getByText(/cern\.png/)).toBeTruthy())
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: caption } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('picture attachments', () => {
  it('sends the picture itself to Kimi, with no base64 in the prompt text', async () => {
    localStorage.setItem('fm_provider', 'moonshot')
    localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
    await sendPicture('what is this?')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === KIMI_URL)).toBe(true), { timeout: 8000 })
    const body = JSON.parse(String((fetchMock.mock.calls.find(([url]) => String(url) === KIMI_URL)![1] as RequestInit).body)) as KimiBody
    const last = body.messages[body.messages.length - 1]
    expect(Array.isArray(last.content)).toBe(true)
    const parts = last.content as Part[]
    expect(parts[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_BASE64}` } })
    expect(parts[1].text).toContain('what is this?')
    expect(parts[1].text).not.toContain('base64')
    expect(body.messages[0].content).toMatch(/attached an image/)
    // The URL-only vision workflow is not offered when the model can see the picture.
    expect((body.tools ?? []).map(tool => tool.function.name)).not.toContain('analyze_image')
    await waitFor(() => expect(screen.getByText(/A particle detector at CERN\./)).toBeTruthy(), { timeout: 8000 })
  }, 20_000)

  it('has DeepSeek look at the picture on Actions and answer from what the vision model saw', async () => {
    localStorage.setItem('fm_provider', 'deepseek-16b')
    const API = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'
    let id = ''
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === `${API}/git/ref/heads/vision-inputs`) return new Response('{}', { status: 404 })
      if (url === `${API}/git/blobs` || url === `${API}/git/trees` || url === `${API}/git/commits`) return Response.json({ sha: 'sha1' })
      if (url === `${API}/git/refs` && method === 'POST') return Response.json({}, { status: 201 })
      if (url.endsWith('/actions/workflows/image-analyze.yml/dispatches')) { id = JSON.parse(String(init!.body)).inputs.invocation_id; return new Response(null, { status: 204 }) }
      if (url.includes('/actions/workflows/image-analyze.yml/runs')) return Response.json({ workflow_runs: [{ id: 5, event: 'workflow_dispatch', head_branch: 'main', display_title: `Analyze Image ${id}`, created_at: new Date().toISOString(), status: 'in_progress', run_number: 3, html_url: 'https://github.com/run/5' }] })
      if (url === `${API}/actions/runs/5`) return Response.json({ id: 5, status: 'completed', conclusion: 'success', run_number: 3, html_url: 'https://github.com/run/5' })
      if (id && url.includes(`/contents/vision-results/${id}.txt`)) return new Response('A huge particle detector inside a tunnel at CERN.')
      if (id && url.includes(`/contents/vision-results/${id}.meta.txt`)) return new Response('model=Qwen/Qwen2-VL-2B-Instruct\n')
      return new Response('{}', { status: 404 })
    })
    await sendPicture('what is this?')
    await waitFor(() => expect(screen.getByText(/A huge particle detector inside a tunnel at CERN\./)).toBeTruthy(), { timeout: 30_000 })
    const dispatch = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/image-analyze.yml/dispatches'))!
    expect(JSON.parse(String((dispatch[1] as RequestInit).body)).inputs).toMatchObject({ image_ref: `vision-inputs/${id}.png`, prompt: expect.stringContaining('what is this?') })
    // The picture went to the vision workflow; the text model was not asked to describe it, and no repository summary ran.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/deepseek-16b.yml/dispatches'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`${API}/commits/`))).toBe(false)
  }, 45_000)

  it('tells a free-mode visitor plainly that pictures are not supported, and dispatches nothing', async () => {
    localStorage.removeItem('gh_token')
    vi.stubEnv('VITE_PUBLIC_RELAY_URL', 'https://relay.example')
    vi.stubEnv('VITE_GITHUB_TOKEN', '')
    vi.stubEnv('VITE_GH_TOKEN', '')
    await sendPicture('what is this?')
    await waitFor(() => expect(screen.getByText(/Free mode can't read pictures yet/)).toBeTruthy(), { timeout: 8000 })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('relay.example') || String(url).includes('/dispatches'))).toBe(false)
    vi.unstubAllEnvs()
  }, 20_000)
})
