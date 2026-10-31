// @vitest-environment jsdom
// Live-data answers (owner, 2026-10-31): a live-data question ("who won today in boxing?") used to
// resolve with the RAW web_search dump as the reply — a [parser note] prefix, the "DuckDuckGo web
// search — ..." tool header, and the hit list, with a months-old recap ranked first and nobody
// turning the hits into the answer. The fix: the note never reaches the bubble on this path, one
// provider hop synthesizes the answer from the hits, and if that hop fails the fallback is the hit
// list with the plumbing stripped. These tests pin all three behaviors end to end through App.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const QUESTION = 'Who won today in boxing, Munguia or the Russian guy?'
const ANSWER = 'Munguia won, beating Nikita Zon by unanimous decision.'
const DDG_LINE = 'FORGECLAW_SEARCH_JSON ' + JSON.stringify([{
  query: 'any',
  results: [
    { title: 'Result: Munguia Dominates Reséndiz', href: 'https://fightnews.com/old', body: 'May 3, 2026 · Boxing well and displaying superior speed, Munguia took it to Reséndiz.' },
    { title: 'Canelo Alvarez vs Christian Mbilli live results', href: 'https://sports.yahoo.com/live', body: 'Live results from Riyadh: Jaime Munguia def. Nikita Zon by unanimous decision.' },
  ],
}])

type Dispatch = { inputs: { invocation_id: string } }
let ddgDispatches: Dispatch[]
let qwenDispatches: Dispatch[]

/** mode: 'completes' — the synthesis hop returns ANSWER. 'qwen-fails' — its dispatch 500s, forcing the cleaned-list fallback. */
function installFetch(mode: 'completes' | 'qwen-fails'): ReturnType<typeof vi.fn> {
  ddgDispatches = []
  qwenDispatches = []
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/ddg_search.yml/dispatches') && init?.method === 'POST') {
      ddgDispatches.push(JSON.parse(String(init.body)))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (url.includes('/ddg_search.yml/runs?')) {
      const id = ddgDispatches.at(-1)?.inputs.invocation_id
      return Promise.resolve(Response.json({ workflow_runs: [{ id: 77, name: `DuckDuckGo search ${id}`, display_title: `DuckDuckGo search ${id}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/77', run_number: 77 }] }))
    }
    if (url.endsWith('/actions/runs/77/jobs?per_page=10')) {
      return Promise.resolve(Response.json({ jobs: [{ id: 91 }] }))
    }
    if (url.endsWith('/actions/jobs/91/logs')) {
      return Promise.resolve(new Response(`log line\n${DDG_LINE}\n`, { status: 200 }))
    }
    if (url.endsWith('/deepseek-16b.yml/dispatches') && init?.method === 'POST') {
      if (mode === 'qwen-fails') return Promise.resolve(new Response('nope', { status: 500 }))
      qwenDispatches.push(JSON.parse(String(init.body)))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (url.includes('/deepseek-16b.yml/runs?')) {
      const id = qwenDispatches.at(-1)?.inputs.invocation_id
      return Promise.resolve(Response.json({ workflow_runs: [{ id: 84, name: `Qwen/Qwen3-8B ${id}`, display_title: `Qwen/Qwen3-8B ${id}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84 }] }))
    }
    if (url.endsWith('/actions/runs/84')) return Promise.resolve(Response.json({ id: 84, status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84, name: 'Qwen/Qwen3-8B', display_title: 'Qwen/Qwen3-8B', event: 'workflow_dispatch' }))
    if (url.includes('raw.githubusercontent.com') && url.endsWith('.meta.txt')) return Promise.resolve(new Response('model=Qwen/Qwen3-8B\nrole=primary checkpoint\nelapsed_seconds=8.2\n', { status: 200 }))
    if (url.includes('raw.githubusercontent.com')) return Promise.resolve(new Response(ANSWER, { status: 200 }))
    return Promise.resolve(new Response('{}', { status: 404 }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function browserStubs() {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('gh_token', 'test-token'); browserStubs() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

async function ask(text: string = QUESTION): Promise<void> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('a live-data question is answered, not dumped', { timeout: 30_000 }, () => {
  it('shows the synthesized answer — no parser note, no search header, no hit list', async () => {
    installFetch('completes')
    await ask()
    await waitFor(() => expect(document.body.textContent).toContain(ANSWER), { timeout: 15_000 })
    expect(document.body.textContent).not.toContain('parser note')
    expect(document.body.textContent).not.toContain('DuckDuckGo web search')
    expect(ddgDispatches).toHaveLength(1)
    expect(qwenDispatches).toHaveLength(1)
  })

  it('answers a hand-typed web_search the same way — the ruling covers any web search', async () => {
    installFetch('completes')
    await ask('web_search query="who won today in boxing"')
    await waitFor(() => expect(document.body.textContent).toContain(ANSWER), { timeout: 15_000 })
    expect(document.body.textContent).not.toContain('parser note')
    expect(document.body.textContent).not.toContain('DuckDuckGo web search')
    expect(ddgDispatches).toHaveLength(1)
    expect(qwenDispatches).toHaveLength(1)
  })

  it('falls back to the hit list with the plumbing stripped when the synthesis hop fails', async () => {
    installFetch('qwen-fails')
    await ask()
    await waitFor(() => expect(document.body.textContent).toContain('Canelo Alvarez vs Christian Mbilli live results'), { timeout: 15_000 })
    expect(document.body.textContent).not.toContain('parser note')
    expect(document.body.textContent).not.toContain('DuckDuckGo web search')
    expect(document.body.textContent).not.toContain('untrusted web content')
  })
})
