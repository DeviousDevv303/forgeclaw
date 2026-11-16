// @vitest-environment jsdom
// Owner ask 2026-11-15: "finish off that swarm so it's usable, connected, wired". /swarm through the real app, under the Nexus
// provider: a hosted model plans it, read-only agents run, the reply says Nexus did not form it, and each agent's work is
// recorded for CORPUS attributed to the model that ran it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>
type KimiBody = { tools?: Array<{ function?: { name: string }; name?: string }>; messages: Array<{ role: string; content: string }> }
const systemOf = (b: KimiBody) => b.messages.find(m => m.role === 'system')?.content ?? ''
const kimiBodies = (): KimiBody[] => fetchMock.mock.calls.filter(([url]) => String(url) === KIMI_URL).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as KimiBody)
const PLAN = { agents: [
  { role: 'Builder reader', task: 'Read src/lib/forgeTools.ts and report where the learning warning text is built.', tools: ['github_read_file'] },
  { role: 'UI reader', task: 'Read src/App.tsx and report where the learning warning text is shown.', tools: ['github_read_file', 'shell_exec'] },
] }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'nexus-intelligence')
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === KIMI_URL) {
      const system = systemOf(JSON.parse(String(init?.body)) as KimiBody)
      const text = system.includes('split one task') ? JSON.stringify(PLAN)
        : system.includes('Builder reader') ? 'The warning is assigned in src/lib/forgeTools.ts.'
        : system.includes('UI reader') ? 'The warning is extracted and shown in src/App.tsx.'
        : 'Built in forgeTools.ts (agent 1), shown in App.tsx (agent 2).'
      return Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })
    }
    return init?.method === 'POST' ? new Response(null, { status: 204 }) : new Response('{}', { status: 404 })
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

const nexusDispatches = () => fetchMock.mock.calls.filter(([url, init]) =>
  String(url).includes('/actions/workflows/nexus-intelligence.yml/dispatches') && (init as RequestInit | undefined)?.method === 'POST')

async function send(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('/swarm under the Nexus provider, through the real app', () => {
  it('RUNS on Kimi: plan, two read-only agents, combined answer; Nexus is never dispatched', async () => {
    localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
    await send('/swarm find where the image learning warning is built and where it is shown')
    await screen.findByText(/Swarm: 2 of 2 agents returned\./, {}, { timeout: 20000 })
    expect(screen.getByText(/The Nexus checkpoint did not form this swarm and was not asked/)).toBeTruthy()
    expect(screen.getByText(/Built in forgeTools\.ts \(agent 1\), shown in App\.tsx \(agent 2\)\./)).toBeTruthy()
    expect(screen.getByText(/not granted: shell_exec/)).toBeTruthy()
    expect(nexusDispatches()).toHaveLength(0)
    const bodies = kimiBodies()
    expect(bodies.filter(b => systemOf(b).includes('split one task'))).toHaveLength(1)
    const children = bodies.filter(b => systemOf(b).includes('one agent in a swarm'))
    expect(children).toHaveLength(2)
    // Each child was offered exactly its granted read-only tool, and nothing else.
    for (const c of children) expect((c.tools ?? []).map(t => t.function?.name ?? t.name)).toEqual(['github_read_file'])
    // Each agent's work is a learning record attributed to the model that ran it, not to the selected Nexus provider.
    const { corpusRepository } = await import('./lib/corpus')
    await waitFor(() => {
      const recs = corpusRepository.listCandidates().filter(c => c.metadata?.tool === 'spawn_agent')
      expect(recs).toHaveLength(2)
      for (const r of recs) { expect(r.runtime).toBe('moonshot'); expect(r.input).toMatch(/^\[swarm agent: /); expect(r.metadata?.outcome).toBe('completed') }
    }, { timeout: 8000 })
  }, 40_000)

  it('with no hosted key nothing runs and the reply says what to add', async () => {
    await send('/swarm find where the image learning warning is built and where it is shown')
    await screen.findAllByText(/No swarm was run\. The swarm needs a hosted model/, {}, { timeout: 20000 })
    expect(kimiBodies()).toHaveLength(0)
    expect(nexusDispatches()).toHaveLength(0)
  }, 40_000)

  it('/swarm with no task shows the usage line', async () => {
    await send('/swarm')
    await screen.findAllByText(/Usage: \/swarm <task>/, {}, { timeout: 20000 })
    expect(kimiBodies()).toHaveLength(0)
  }, 40_000)
})
