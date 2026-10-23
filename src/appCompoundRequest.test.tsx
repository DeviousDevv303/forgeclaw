// @vitest-environment jsdom
// 2026-10-23 repro: a repo-state report with five numbered sections ran github_repo_state, rendered section 1 and
// presented as complete. The loop ended on the first reply without tool calls; nothing tracked the sections still owed,
// and the HEAD-question shortcut replaced the reply with "Current main commit SHA: X". The request's numbered items
// are now a ledger (requestLedger.ts): the run continues while items are owed and settles every item, rendered or named
// unavailable. These tests read the settled ledger (the reply's data-report-ledger), not the reply's wording.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettledItem } from './lib/requestLedger'

type KimiBody = { messages: Array<{ role: string; content: string }> }
const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
let fetchMock: ReturnType<typeof vi.fn>
let kimiReplies: unknown[]
let repoMetaStatus = 200

const REPORT = [
  'Repo state report, all five sections:',
  '1. Current main HEAD commit SHA (github_repo_state)',
  '2. README (github_read_file README.md)',
  '3. package.json (github_read_file package.json)',
  '4. docs/a.md (github_read_file docs/a.md)',
  '5. docs/b.md (github_read_file docs/b.md)',
].join('\n')
const SHA = 'a'.repeat(40)

const toolCalls = (...calls: Array<[string, string, Record<string, unknown>]>) => ({
  choices: [{ message: { content: '', tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, finish_reason: 'tool_calls' }],
})
const text = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })
const readFour = () => toolCalls(
  ['c2', 'github_read_file', { path: 'README.md' }],
  ['c3', 'github_read_file', { path: 'package.json' }],
  ['c4', 'github_read_file', { path: 'docs/a.md' }],
  ['c5', 'github_read_file', { path: 'docs/b.md' }],
)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiReplies = []
  repoMetaStatus = 200
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === KIMI_URL) return Response.json(kimiReplies.shift() ?? text('Done.'))
    if (url.includes('/contents/')) return Response.json({ content: btoa('file body'), encoding: 'base64', size: 9 })
    if (url.includes('/commits/')) return Response.json({ sha: SHA, html_url: '', commit: { message: 'msg', author: { date: '2026-10-23T00:00:00Z' } } })
    if (/api\.github\.com\/repos\/[^/]+\/[^/?]+$/.test(url)) {
      return repoMetaStatus === 200
        ? Response.json({ default_branch: 'main', html_url: '', private: false, pushed_at: '2026-10-23T00:00:00Z' })
        : new Response('{"message":"Server Error"}', { status: repoMetaStatus })
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

const kimiBodies = (): KimiBody[] => fetchMock.mock.calls
  .filter(([url]) => String(url) === KIMI_URL)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as KimiBody)

const phase = () => document.querySelector('[data-report-ledger]')?.getAttribute('data-agent-phase')

async function runReport(): Promise<SettledItem[]> {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: REPORT } })
  fireEvent.keyDown(box, { key: 'Enter' })
  let ledger: SettledItem[] = []
  await waitFor(() => {
    const node = document.querySelector('[data-report-ledger]')
    expect(node).not.toBeNull()
    ledger = JSON.parse(node!.getAttribute('data-report-ledger')!) as SettledItem[]
  }, { timeout: 10_000 })
  return ledger
}

describe('a numbered request is a ledger the run pays off', () => {
  it('renders all five sections in one run when the model stops after section 1', async () => {
    kimiReplies.push(
      toolCalls(['c1', 'github_repo_state', {}]),
      // The defect: one tool answer rendered, then a reply with no tool calls.
      text(`## 1. Current main HEAD commit SHA\nHEAD: ${SHA}`),
      readFour(),
      text('## 2. README\nfile body\n## 3. package.json\nfile body\n## 4. docs/a.md\nfile body\n## 5. docs/b.md\nfile body'),
    )
    const ledger = await runReport()
    expect(ledger.map(item => [item.n, item.status])).toEqual([[1, 'rendered'], [2, 'rendered'], [3, 'rendered'], [4, 'rendered'], [5, 'rendered']])
    expect(ledger[0].evidence[0]).toBe('github_repo_state ✓')
    expect(phase()).not.toBe('BLOCKED')
    const bodies = kimiBodies()
    expect(bodies).toHaveLength(4)
    // The continuation named exactly the owed sections.
    const nudge = bodies[2].messages.filter(m => m.role === 'user').pop()!.content
    expect(nudge).toMatch(/^REQUEST LEDGER/)
    expect(nudge).toContain('2. README')
    expect(nudge).toContain('5. docs/b.md')
    expect(nudge).not.toContain('1. Current main')
    // The HEAD shortcut no longer stands in for the report.
    expect(screen.queryByText(`Current main commit SHA: ${SHA}`)).toBeNull()
  }, 30_000)

  it('a section whose tool failed renders its unavailable line; the run is not complete', async () => {
    repoMetaStatus = 500
    kimiReplies.push(
      toolCalls(['c1', 'github_repo_state', {}]),
      readFour(),
      // Section 1 is claimed anyway; with its only tool failed, that prose is not evidence.
      text(`## 1. HEAD\nHEAD: ${SHA}\n## 2. README\nfile body\n## 3. package.json\nfile body\n## 4. docs/a.md\nfile body\n## 5. docs/b.md\nfile body`),
    )
    const ledger = await runReport()
    expect(ledger.map(item => item.status)).toEqual(['unavailable', 'rendered', 'rendered', 'rendered', 'rendered'])
    expect(ledger[0].reason).toMatch(/^github_repo_state failed: /)
    expect(phase()).toBe('BLOCKED')
    await waitFor(() => expect(document.body.textContent).toContain('section 1: unavailable — github_repo_state failed'))
    expect(document.body.textContent).toContain('1 of 5 sections unavailable')
  }, 30_000)

  it('a model that never renders the owed sections is asked a bounded number of times, then each one is named', async () => {
    kimiReplies.push(toolCalls(['c1', 'github_repo_state', {}]), text(`## 1. HEAD\nHEAD: ${SHA}`), text('Done.'), text('Done.'))
    const ledger = await runReport()
    expect(ledger.map(item => item.status)).toEqual(['rendered', 'unavailable', 'unavailable', 'unavailable', 'unavailable'])
    expect(ledger[1].reason).toBe('github_read_file was not called')
    // No tool failed, so only the ledger stops this from reading COMPLETE.
    expect(phase()).toBe('BLOCKED')
    // One tool round, one first answer, then MAX_LEDGER_CONTINUATIONS (2) re-asks.
    expect(kimiBodies()).toHaveLength(4)
  }, 30_000)

  it('prose that renders no numbered section is kept, with every item named under it', async () => {
    kimiReplies.push(text('All five look healthy.'), text('All five look healthy.'), text('All five look healthy.'))
    const ledger = await runReport()
    expect(ledger.every(item => item.status === 'unavailable')).toBe(true)
    await waitFor(() => expect(document.body.textContent).toContain('All five look healthy.'))
    expect(phase()).toBe('BLOCKED')
  }, 30_000)
})
