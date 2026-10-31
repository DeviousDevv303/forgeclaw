// @vitest-environment jsdom
// Thread B: a DeepSeek run dispatched from MAIN CHAT (deepseek_reason inside the agent loop) was never persisted, because the
// main-chat tool context had no onDeepSeekDispatch (only the direct /deepseek path saved its run). If the page closed mid-run
// the reply could not re-attach to the running workflow; it fell back to the whole-task resend, which starts a SECOND 9-23 minute
// workflow. The fix persists the run on dispatch and clears it when the run ends. These tests pin both halves, including the
// path the design depends on: a crash (no finally) followed by a reload re-attaches to the SAME run and does not dispatch again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const RUN_KEY = 'forgeclaw_active_deepseek_run'
const HISTORY_KEY = 'forgemind_history'
const QUESTION = 'What causes rainbows to form after rain?'

type Dispatch = { inputs: { invocation_id: string; task?: string } }
let dispatches: Dispatch[]

/** Mirrors the lib-level DeepSeek flow (dispatch -> run list -> completed run -> mirror text). `mode` decides how the run ends. */
function installFetch(mode: 'never-finishes' | 'hangs-until-aborted' | 'completes', invocationOverride?: string): ReturnType<typeof vi.fn> {
  dispatches = []
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/deepseek-16b.yml/dispatches') && init?.method === 'POST') {
      dispatches.push(JSON.parse(String(init.body)))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (url.includes('/deepseek-16b.yml/runs?')) {
      // never-finishes: the read hangs and ignores abort (a killed page gets no abort and no finally).
      if (mode === 'never-finishes') return new Promise<Response>(() => {})
      // hangs-until-aborted: like a real fetch, rejects when the app aborts it (STOP).
      if (mode === 'hangs-until-aborted') return new Promise<Response>((_, reject) => {
        const sig = init?.signal
        if (sig?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        sig?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
      // After a reload nothing is dispatched, so the run to find is the one the PAGE SAVED, not a new dispatch.
      const id = invocationOverride ?? dispatches.at(-1)?.inputs.invocation_id
      return Promise.resolve(Response.json({ workflow_runs: [{ id: 84, name: `Qwen/Qwen3-8B ${id}`, display_title: `Qwen/Qwen3-8B ${id}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84 }] }))
    }
    if (url.endsWith('/actions/runs/84')) return Promise.resolve(Response.json({ id: 84, status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/84', run_number: 84, name: 'Qwen/Qwen3-8B', display_title: 'Qwen/Qwen3-8B', event: 'workflow_dispatch' }))
    if (url.includes('raw.githubusercontent.com') && url.endsWith('.meta.txt')) return Promise.resolve(new Response('model=Qwen/Qwen3-8B\nrole=primary checkpoint\nelapsed_seconds=8.2\n', { status: 200 }))
    if (url.includes('raw.githubusercontent.com')) return Promise.resolve(new Response('Rainbows form when sunlight is refracted and reflected inside raindrops.', { status: 200 }))
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

async function ask(): Promise<void> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: QUESTION } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const savedRun = () => { const raw = localStorage.getItem(RUN_KEY); return raw ? JSON.parse(raw) as { invocationId: string; dispatchedAt: number; messageId: string; question: string } : null }

describe('a DeepSeek run dispatched from main chat is persisted so a closed page can re-attach', { timeout: 30_000 }, () => {
  it('saves the dispatched run (invocation id, reply id, question) as soon as the workflow is dispatched', async () => {
    installFetch('never-finishes')
    await ask()
    await waitFor(() => expect(dispatches.length).toBe(1), { timeout: 5000 })
    await waitFor(() => expect(savedRun()).not.toBeNull(), { timeout: 5000 })
    const run = savedRun()!
    expect(run.invocationId).toBe(dispatches[0].inputs.invocation_id)
    expect(run.question).toContain(QUESTION)
    expect(run.messageId.length).toBeGreaterThan(0)
  })

  it('clears the saved run when the run finishes (a leftover would re-attach to a finished run on the next load)', async () => {
    // Not vacuous: record that the run WAS saved at some point, so "cleared" cannot pass merely because nothing was ever saved.
    const saves: string[] = []
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) { if (k === RUN_KEY) saves.push(v); return realSet.call(this, k, v) })
    installFetch('completes')
    await ask()
    await waitFor(() => expect(screen.getByText(/refracted and reflected inside raindrops/)).toBeTruthy(), { timeout: 8000 })
    await waitFor(() => expect(savedRun()).toBeNull(), { timeout: 5000 })
    expect(saves.length).toBeGreaterThan(0)
  })

  it('clears the saved run when the owner presses STOP (STOP nulls the active run before the finally runs)', async () => {
    installFetch('hangs-until-aborted')
    await ask()
    await waitFor(() => expect(savedRun()).not.toBeNull(), { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    await waitFor(() => expect(savedRun()).toBeNull(), { timeout: 5000 })
  })

  it('CRASH PATH: a page killed mid-run (no finally) re-attaches to the SAME run on reload and never dispatches a second workflow', async () => {
    installFetch('never-finishes')
    await ask()
    await waitFor(() => expect(savedRun()).not.toBeNull(), { timeout: 5000 })
    await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).toContain('"streaming":true'), { timeout: 5000 })
    // Snapshot exactly what a killed page leaves behind, then discard the old app without letting its finally run.
    const snapshot = { run: localStorage.getItem(RUN_KEY)!, history: localStorage.getItem(HISTORY_KEY)! }
    const originalInvocation = dispatches[0].inputs.invocation_id
    cleanup(); vi.unstubAllGlobals(); vi.resetModules(); localStorage.clear()
    localStorage.setItem('gh_token', 'test-token'); browserStubs()
    localStorage.setItem(RUN_KEY, snapshot.run); localStorage.setItem(HISTORY_KEY, snapshot.history)

    installFetch('completes', originalInvocation) // the workflow kept running on GitHub and has finished by the time the page is back
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/refracted and reflected inside raindrops/)).toBeTruthy(), { timeout: 8000 })
    expect(dispatches.length).toBe(0)                                  // no second 9-23 minute workflow
    expect(screen.queryByText(/Interrupted: ForgeClaw was closed or reloaded before this finished/)).toBeNull() // not left for a whole-task resend
    await waitFor(() => expect(savedRun()).toBeNull(), { timeout: 5000 }) // and the re-attached run is cleaned up
    expect(originalInvocation.length).toBeGreaterThan(0)
  })
})
