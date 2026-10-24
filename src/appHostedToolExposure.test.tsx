// @vitest-environment jsdom
// 2026-10-19: with the Anthropic provider, "look through my GitHub repo and look for efficiency
// improvements on workflows" reached Claude with NO tools (the keyword gate matched nothing), so
// Claude said it had no GitHub access; on earlier no-tool turns it invented commit IDs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type AnthropicBody = { tools?: Array<{ name: string }>; system?: string }
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_anthropic_key', 'sk-ant-test-key-0123456789abcdef')
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('https://api.anthropic.com/v1/messages')) {
      return Response.json({ content: [{ type: 'text', text: 'Reviewed.' }], stop_reason: 'end_turn' })
    }
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

async function firstAnthropicBody(provider: string, prompt: string): Promise<AnthropicBody> {
  localStorage.setItem('fm_provider', provider)
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let body: AnthropicBody = {}
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://api.anthropic.com/v1/messages'))
    expect(call).toBeTruthy()
    body = JSON.parse(String((call![1] as RequestInit).body))
  }, { timeout: 5000 })
  return body
}

describe('hosted tool-calling providers get read-only repo tools', () => {
  it('offers Claude the GitHub read tools for an ordinary repo request', async () => {
    const body = await firstAnthropicBody('anthropic', 'look through my GitHub repo and look for efficiency improvements on workflows')
    const names = (body.tools ?? []).map(tool => tool.name)
    for (const name of ['github_repo_state', 'github_read_file', 'github_list_files', 'github_search_code', 'github_get_run_status', 'github_get_run_logs', 'web_search']) {
      expect(names, name).toContain(name)
    }
    // Writes stay gated: nothing in this message asks to change the repo.
    expect(names).not.toContain('github_write_file')
    // The finished reply in the chat carries the Nexus Intelligence sign-off.
    await waitFor(() => expect(screen.getByText(/Reviewed\.\s*— Nexus Intelligence/)).toBeTruthy(), { timeout: 5000 })
    // #139: Claude can run ForgeClaw shell commands (through executeTool + Guardian).
    expect(names).toContain('shell_exec')
    // ...and is told where they run, so it stops cloning the repo it is already in.
    expect(body.system ?? '').toContain('never git clone it')
    expect(body.system ?? '').toContain('github_search_code (seconds)')
  }, 15_000)

  it('never hands Claude the slow DeepSeek workflow, even for "review"/"analyze" wording or a coding task', async () => {
    for (const prompt of ['review and analyze the efficiency of my GitHub workflows', 'check the repo and fix the failing build-gate test']) {
      cleanup(); vi.resetModules(); fetchMock.mockClear()
      const body = await firstAnthropicBody('anthropic', prompt)
      const names = (body.tools ?? []).map(tool => tool.name)
      expect(names, prompt).not.toContain('deepseek_reason')
      expect(names, prompt).not.toContain('ask_deepseek')
      expect(body.system ?? '', prompt).not.toMatch(/Use deepseek_reason/)
      expect(names, prompt).toContain('github_read_file')
      // Claude is told to use shell_exec; a coding task used to drop it (and web_search) entirely.
      expect(names, prompt).toContain('shell_exec')
      expect(names, prompt).toContain('web_search')
    }
  }, 30_000)

  it('tells a tool-less turn it has no tools, so it cannot claim it read or committed anything', async () => {
    // The local llama.cpp provider keeps the keyword gate; a plain question gets no tools.
    localStorage.setItem('fm_provider', 'local')
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/chat/completions')) return Response.json({ choices: [{ message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' }] })
      return new Response('{}', { status: 404 })
    })
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'What is a good name for a dog?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    let body: { messages?: Array<{ role: string; content: string }>; tools?: unknown[] } = {}
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'))
      expect(call).toBeTruthy()
      body = JSON.parse(String((call![1] as RequestInit).body))
    }, { timeout: 5000 })
    expect(body.tools ?? []).toHaveLength(0)
    const system = body.messages?.find(message => message.role === 'system')?.content ?? ''
    expect(system).toContain('No tools are available in this message')
    expect(system).toMatch(/never invent commit IDs/i)
  }, 15_000)
})
