// @vitest-environment jsdom
// 2026-11-13 owner report: after ForgeClaw rendered a UFC picture, a follow-up that asked it to search the web and then
// make the fighters "look like the actual fighters" ended in an error. generate_image is offered only when the message
// itself contains an image keyword, so on the follow-up the model had web_search but not generate_image, and its
// generate_image call was refused as "not offered for this request".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type KimiBody = {
  tools?: Array<{ function: { name: string } }>
  messages: Array<{ role: string; content: string; tool_call_id?: string }>
}
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>
let kimiReplies: unknown[]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiReplies = []
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === KIMI_URL) return Response.json(kimiReplies.shift() ?? { choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] })
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

const kimiBodies = (): KimiBody[] => fetchMock.mock.calls
  .filter(([url]) => String(url) === KIMI_URL)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as KimiBody)
const offered = (b: KimiBody) => (b.tools ?? []).map(t => t.function.name)

const PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const FOLLOW_UP = 'search the web and then make them look like the actual fighters'

/** A conversation as the app persists it: the owner asked for a picture and the assistant rendered it. */
function seedConversation(last: Record<string, unknown>) {
  localStorage.setItem('forgemind_history', JSON.stringify([
    { id: '1', role: 'user', content: 'Make me a UFC picture', timestamp: 1 },
    { id: '2', role: 'assistant', content: 'Here is your picture.', timestamp: 2, ...last },
  ]))
}

async function send(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(kimiBodies().length).toBeGreaterThanOrEqual(1), { timeout: 8000 })
  return kimiBodies()[0]
}

describe('which tools a hosted turn is offered when the message asks for pictures', () => {
  it('after a rendered picture, the owner\'s follow-up is offered generate_image as well as web_search', async () => {
    seedConversation({ imageUrl: PICTURE })
    const body = await send(FOLLOW_UP)
    expect(offered(body)).toContain('web_search')
    expect(offered(body)).toContain('generate_image')
  }, 30_000)

  it('the same wording with no picture before it is NOT offered generate_image (no new false offers)', async () => {
    const body = await send(FOLLOW_UP)
    expect(offered(body)).toContain('web_search')
    expect(offered(body)).not.toContain('generate_image')
  }, 30_000)

  it('a previous reply that rendered no picture does not offer it either', async () => {
    seedConversation({})
    const body = await send(FOLLOW_UP)
    expect(offered(body)).not.toContain('generate_image')
  }, 30_000)

  it('"photo" is a picture word: "make me a UFC photo" is offered generate_image', async () => {
    const body = await send('make me a UFC photo of two fighters')
    expect(offered(body)).toContain('generate_image')
  }, 30_000)

  it('the model\'s generate_image call after the follow-up is run, not refused as "not offered for this request"', async () => {
    seedConversation({ imageUrl: PICTURE })
    kimiReplies.push({ choices: [{ message: { content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'two UFC fighters, realistic', style: 'realistic' }) } }] }, finish_reason: 'tool_calls' }] })
    await send(FOLLOW_UP)
    await waitFor(() => expect(kimiBodies().length).toBeGreaterThanOrEqual(2), { timeout: 8000 })
    const toolResult = kimiBodies()[1].messages.find(m => m.role === 'tool' && m.tool_call_id === 'call_1')
    expect(toolResult).toBeDefined()
    expect(toolResult!.content).not.toMatch(/was not offered for this request/)
  }, 30_000)
})
