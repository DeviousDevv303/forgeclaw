// @vitest-environment jsdom
// Link attestation at the bubble: a URL the model invents must render as plain text,
// never as an official-looking anchor; a URL a tool result produced, or one on a
// trusted host (github.com), renders as a link. Scaffold gate: a normal answer that
// merely opens with one label ("Plan:") survives whole, while a genuine scaffold
// report is still cleaned down to its execution/verification content.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

function seedHistory(messages: unknown[]) {
  localStorage.setItem('forgemind_history', JSON.stringify(messages))
}

describe('link attestation in a rendered bubble', () => {
  it('links attested and trusted-host URLs, leaves invented URLs as plain text', async () => {
    const now = Date.now()
    seedHistory([
      { id: '1', role: 'user', content: 'check that run for me', timestamp: now - 3000 },
      {
        id: '2', role: 'assistant', timestamp: now - 2000, agentPhase: 'COMPLETE',
        content: 'The run finished: https://tracker.example.net/runs/12345 — the PR is https://github.com/DeviousDevv303/forgeclaw/pull/9999 and the file is at https://forgeclaw-files.example.com/src/App.tsx with [the report](https://reports.example.org/q3) attached.',
        toolResults: [{ toolCallId: 't1', name: 'github_actions', output: 'Run https://tracker.example.net/runs/12345 completed successfully' }],
      },
    ])
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    await screen.findByText(/The run finished/)
    const bubble = container.querySelector('[data-agent-phase]')
    expect(bubble).toBeTruthy()
    const hrefs = [...bubble!.querySelectorAll('a')].map(a => a.getAttribute('href'))
    // Attested via the tool result, and trusted-host github.com: real anchors.
    expect(hrefs).toContain('https://tracker.example.net/runs/12345')
    expect(hrefs).toContain('https://github.com/DeviousDevv303/forgeclaw/pull/9999')
    // Invented URLs: no anchor at all, but the text stays readable/copyable.
    expect(hrefs).not.toContain('https://forgeclaw-files.example.com/src/App.tsx')
    expect(hrefs).not.toContain('https://reports.example.org/q3')
    expect(bubble!.textContent).toContain('https://forgeclaw-files.example.com/src/App.tsx')
    expect(bubble!.textContent).toContain('the report (https://reports.example.org/q3)')
  })
})

describe('scaffold gate at the bubble', () => {
  it('still cleans a genuine scaffold report down to execution/verification', async () => {
    const now = Date.now()
    seedHistory([
      { id: '1', role: 'user', content: 'tidy the vault', timestamp: now - 2000 },
      {
        id: '2', role: 'assistant', timestamp: now - 1000, agentPhase: 'COMPLETE',
        content: 'OBJECTIVE:\ntidy the vault completely\nPLAN:\nsweep the shelves first\nEXECUTION:\nswept the shelves\nVERIFICATION:\nshelves confirmed clean',
      },
    ])
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    await screen.findByText(/swept the shelves/)
    const bubble = container.querySelector('[data-agent-phase]')
    expect(bubble).toBeTruthy()
    expect(bubble!.textContent).toContain('swept the shelves')
    expect(bubble!.textContent).toContain('shelves confirmed clean')
    expect(bubble!.textContent).not.toContain('tidy the vault completely')
    expect(bubble!.textContent).not.toContain('sweep the shelves first')
  })

  it('shows a normal answer that merely opens with "Plan:" whole', async () => {
    const now = Date.now()
    seedHistory([
      { id: '1', role: 'user', content: 'what is the plan for the reserves?', timestamp: now - 2000 },
      {
        id: '2', role: 'assistant', timestamp: now - 1000, agentPhase: 'COMPLETE',
        content: 'Plan: keep the reserve untouched.\nThe reserves total 42 units and the vault stays sealed.',
      },
    ])
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    await screen.findByText(/reserves total 42 units/)
    const bubble = container.querySelector('[data-agent-phase]')
    expect(bubble).toBeTruthy()
    expect(bubble!.textContent).toContain('Plan: keep the reserve untouched.')
    expect(bubble!.textContent).toContain('The reserves total 42 units and the vault stays sealed.')
  })
})

describe('extractPublicAnswer scaffold gate', () => {
  it('passes a single-label answer through intact', async () => {
    const { extractPublicAnswer } = await import('./App')
    const planOnly = 'Plan: draft the memo today.\nThe memo says the reserves total 42 units.'
    expect(extractPublicAnswer(planOnly)).toBe(planOnly)
    const statusOnly = 'Status: shipped\nIt landed at noon and the crew signed for it.'
    expect(extractPublicAnswer(statusOnly)).toBe(statusOnly)
  })

  it('treats two distinct scaffold sections as a scaffold report', async () => {
    const { extractPublicAnswer } = await import('./App')
    const report = 'OBJECTIVE:\ntidy the vault completely\nPLAN:\nsweep the shelves first\nEXECUTION:\nswept the shelves\nVERIFICATION:\nshelves confirmed clean'
    const cleaned = extractPublicAnswer(report)
    expect(cleaned).toContain('swept the shelves')
    expect(cleaned).toContain('shelves confirmed clean')
    expect(cleaned).not.toContain('tidy the vault completely')
    expect(cleaned).not.toContain('sweep the shelves first')
    // Two drop-sections and nothing else: still scaffold, nothing public survives.
    expect(extractPublicAnswer('Plan: outline only\nStatus: pending only')).toBe('')
  })

  it('treats a lone EXECUTION section as a scaffold report', async () => {
    const { extractPublicAnswer } = await import('./App')
    const cleaned = extractPublicAnswer('Execution: migrated the vault\nThe vault now holds 42 units.')
    expect(cleaned).toContain('The vault now holds 42 units.')
    expect(cleaned).not.toContain('migrated the vault')
  })
})
