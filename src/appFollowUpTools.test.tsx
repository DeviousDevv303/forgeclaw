// @vitest-environment jsdom
// 2026-10-21: the owner asked ForgeClaw to merge the open pull requests, then said "Resume". Tools were chosen from the
// new message alone, so github_merge_pr was not offered and ForgeClaw reported "no merge tool is exposed in this session".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
type Body = { tools?: Array<{ function: { name: string } }> }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  // The owner's self-sculpt key is unlocked (the merge tool is offered only then).
  vi.doMock('./lib/sculptKey', async (load) => ({ ...(await load<typeof import('./lib/sculptKey')>()), isSculptUnlocked: () => true }))
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input) === KIMI_URL
    ? Response.json({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] })
    : new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('./lib/sculptKey'); vi.resetModules() })

async function systemPromptFor(prompt: string): Promise<string> {
  await requestFor(prompt)
  const call = fetchMock.mock.calls.find(([url]) => String(url) === KIMI_URL)!
  return (JSON.parse(String((call[1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }> }).messages.find(m => m.role === 'system')!.content
}

async function requestFor(prompt: string): Promise<string[]> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === KIMI_URL)).toBe(true), { timeout: 8000 })
  const call = fetchMock.mock.calls.find(([url]) => String(url) === KIMI_URL)!
  return ((JSON.parse(String((call[1] as RequestInit).body)) as Body).tools ?? []).map(t => t.function.name)
}

describe('the owner\'s private reasoning framework reaches the prompt', () => {
  it('with one set in this browser it replaces the default loop, privately and briefly', async () => {
    localStorage.setItem('fc_owner_scaffold_v1', 'Phase A: TESTFRAMEWORK look first.')
    const system = await systemPromptFor('fix the failing build')
    expect(system).toContain('TESTFRAMEWORK look first.')
    expect(system).toMatch(/private reasoning, one or two lines per phase, never in the visible answer/)
    expect(system).not.toContain('CORE OPERATING LOOP\nFor every task:')
  }, 30_000)
  it('a free-mode visitor (no GitHub token) never gets it, even with the text in storage', async () => {
    localStorage.setItem('fc_owner_scaffold_v1', 'Phase A: TESTFRAMEWORK look first.')
    localStorage.removeItem('gh_token')
    vi.stubEnv('VITE_PUBLIC_RELAY_URL', 'https://relay.test') // the production build: a relay is configured
    vi.resetModules()
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'fix the failing build' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await new Promise(resolve => setTimeout(resolve, 1500))
    const bodies = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit | undefined)?.body ?? ''))
    expect(bodies.some(body => body.includes('TESTFRAMEWORK'))).toBe(false)
  }, 30_000)
  it('with none set the default loop is unchanged', async () => {
    const system = await systemPromptFor('fix the failing build')
    expect(system).toContain('CORE OPERATING LOOP\nFor every task:')
    expect(system).not.toContain('OWN REASONING FRAMEWORK')
  }, 30_000)
})

describe('a command with a request after it goes to the model, not straight to the shell', () => {
  // 2026-10-21: "run cat nonexistent.txt, then tell me how many open PRs there are" was run as a command; the question was lost.
  it.each([
    'Run `cat nonexistent.txt`, then tell me how many open PRs there are',
    'cat nonexistent.txt and then tell me how many PRs are open',
  ])('%s', async prompt => {
    const tools = await requestFor(prompt)
    expect(tools).toContain('shell_exec')
    expect(tools).toContain('github_list_prs')
  }, 30_000)
})

describe('a follow-up keeps the tools of the task it continues', () => {
  it('"Resume" after "merge the open PRs" still offers the merge tool', async () => {
    localStorage.setItem('forgemind_history', JSON.stringify([
      { id: '1', role: 'user', content: 'list the open PRs and merge pr #205', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'STATUS: BLOCKED', timestamp: 2 },
    ]))
    expect(await requestFor('Resume')).toContain('github_merge_pr')
  }, 30_000)
  it('"merge 208" (no "pr" in it) offers the merge tool', async () => {
    const tools = await requestFor('merge 208')
    expect(tools).toContain('github_merge_pr')
    expect(tools).toContain('github_pr_info')
  }, 30_000)
  it('with no such task in the conversation, "Resume" alone does not offer it', async () => {
    expect(await requestFor('Resume')).not.toContain('github_merge_pr')
  }, 30_000)
})
