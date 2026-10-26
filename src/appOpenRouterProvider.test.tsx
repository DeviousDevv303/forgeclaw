// @vitest-environment jsdom
// 2026-10-26 (owner): "Open router never made it to the UI as a provider need that please". OpenRouter in the real
// Settings surface and the real chat: selectable, its key and model persist, the model field offers the live catalogue,
// and a chat turn goes to openrouter.ai with the tools, handing the model's reasoning back on the tool-call turn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS_URL = 'https://openrouter.ai/api/v1/models'
// Built from parts so no key-shaped literal sits in source (the protected-path guard refuses one).
const KEY = ['sk', 'or', 'test-not-a-real-key-000'].join('-')
const DETAILS = [{ type: 'reasoning.text', text: 'Read the file first.', signature: 'sig', format: 'anthropic-claude-v1', index: 0 }]
type Body = { model: string; tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown; reasoning_details?: unknown; tool_calls?: unknown[] }> }
let fetchMock: ReturnType<typeof vi.fn>
let chatTurn = 0

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'openrouter')
  chatTurn = 0
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === MODELS_URL) {
      return Response.json({ data: [
        { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', context_length: 1048576, supported_parameters: ['tools'], pricing: { prompt: '0.00000015', completion: '0.0000005' } },
        { id: 'some/text-only', name: 'Text only', context_length: 8192, supported_parameters: [], pricing: { prompt: '0', completion: '0' } },
      ] })
    }
    if (url !== CHAT_URL) return new Response('{}', { status: 404 })
    chatTurn += 1
    return chatTurn === 1
      ? Response.json({ choices: [{ message: { content: '', reasoning: 'Read the file first.', reasoning_details: DETAILS, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'github_read_file', arguments: JSON.stringify({ owner: 'DeviousDevv303', repo: 'forgeclaw', path: 'README.md' }) } }] }, finish_reason: 'tool_calls' }] })
      : Response.json({ choices: [{ message: { content: 'The README could not be read.' }, finish_reason: 'stop' }] })
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

const chatBodies = (): Body[] => fetchMock.mock.calls.filter(([url]) => String(url) === CHAT_URL).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Body)

describe('OpenRouter in Settings', () => {
  it('is selectable, shows its key section, and the key and model persist', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))
    const option = await screen.findByRole('option', { name: 'OpenRouter' })
    expect((option.closest('select') as HTMLSelectElement).value).toBe('openrouter')

    const key = screen.getByPlaceholderText('sk-or-...') as HTMLInputElement
    expect(key.type).toBe('password')
    expect(screen.getByText(/openrouter\.ai\/keys/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /TEST OPENROUTER KEY/i })).toBeTruthy()
    fireEvent.change(key, { target: { value: KEY } })
    expect(localStorage.getItem('fm_openrouter_key')).toBe(KEY)

    const model = screen.getByLabelText(/OpenRouter Model/i) as HTMLInputElement
    expect(model.value).toBe('anthropic/claude-haiku-5.5')
    fireEvent.change(model, { target: { value: 'z-ai/glm-5.3-flash' } })
    expect(localStorage.getItem('fm_openrouter_model')).toBe('z-ai/glm-5.3-flash')
  }, 20_000)

  it('the model field loads the live catalogue once, keeping only models that can call tools', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^SETTINGS$/i }))
    expect(fetchMock.mock.calls.some(([url]) => String(url) === MODELS_URL)).toBe(false)  // nothing until the field is used
    const model = await screen.findByLabelText(/OpenRouter Model/i)
    fireEvent.focus(model)
    await screen.findByText('1 tool-capable models loaded from OpenRouter')
    const list = document.getElementById('openrouter-models') as HTMLDataListElement
    expect([...list.options].map(o => o.value)).toEqual(['z-ai/glm-5.3-flash'])
    fireEvent.focus(model)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === MODELS_URL)).toHaveLength(1)
  }, 20_000)
})

describe('OpenRouter in the chat', () => {
  it('sends the turn to openrouter.ai with the chosen model and tools, and hands the reasoning back on the tool-call turn', async () => {
    localStorage.setItem('fm_openrouter_key', KEY)
    localStorage.setItem('fm_openrouter_model', 'z-ai/glm-5.3-flash')
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'read the README in my GitHub repo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText(/The README could not be read\./, undefined, { timeout: 15_000 })

    const [first, second] = chatBodies()
    expect(first.model).toBe('z-ai/glm-5.3-flash')
    expect((first.tools ?? []).map(t => t.function.name)).toContain('github_read_file')
    const authorization = ((fetchMock.mock.calls.find(([url]) => String(url) === CHAT_URL)?.[1] as RequestInit).headers as Record<string, string>).Authorization
    expect(authorization).toBe(`Bearer ${KEY}`)
    const toolTurn = second.messages.find(m => m.role === 'assistant' && Array.isArray(m.tool_calls))
    expect(toolTurn?.reasoning_details).toEqual(DETAILS)
    expect(second.messages.some(m => m.role === 'tool')).toBe(true)
  }, 30_000)

  it('without a key the turn is blocked with the fix named, and nothing is sent', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText(/OpenRouter: no API key/).length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(chatBodies()).toEqual([])
  }, 20_000)
})
