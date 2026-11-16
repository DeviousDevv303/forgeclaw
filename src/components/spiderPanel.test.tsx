// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpiderPanel, SPIDER_PANEL_BOTTOM_PX } from './SpiderPanel'
import { ThroneRig } from './ThroneRig'
import { IDLE_NEURAL_STATE } from '../hooks/useNeuralState'
import { emptyLedger, foldSpiderEvents, SPIDER_PANEL_LINGER_MS } from '../lib/spiderlings'
import type { AgentEvent } from '../types/forgeOps'

afterEach(() => { cleanup(); vi.useRealTimers() })

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0)
const events: AgentEvent[] = [
  { type: 'TOOL_START', tool: 'qwen_reason', iter: 0, timestamp: T0 },
  { type: 'TOOL_START', tool: 'shell_exec', iter: 0, timestamp: T0 + 1_000 },
  { type: 'TOOL_START', tool: 'browser_run', iter: 0, timestamp: T0 + 2_000 },
  { type: 'TOOL_SUCCESS', tool: 'qwen_reason', timestamp: T0 + 4_000 },
  { type: 'TOOL_FAILURE', tool: 'shell_exec', failClass: 'TOOL_FAILURE', timestamp: T0 + 5_000 },
]
const num = (id: string) => Number(screen.getByTestId(id).textContent)

describe('SpiderPanel', () => {
  it('canary: with an empty ledger every surface reads idle (no counts, no demo flag, nothing listed)', () => {
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(['spider-inflight', 'spider-returned', 'spider-flagged', 'spider-unknown'].map(num)).toEqual([0, 0, 0, 0])
    expect(screen.queryByTestId('spider-demo-flag')).toBeNull()
    fireEvent.click(screen.getByTestId('spider-toggle'))
    expect(screen.getByTestId('spider-empty').textContent).toMatch(/nothing is out of the throne/)
    expect(screen.getByTestId('spider-asof').textContent).toMatch(/^as of \d\d:\d\d:\d\d · counting since \d\d:\d\d:\d\d \(this session\)$/)
  })
  it('shows counts that equal the ledger lines it lists, each line with its own time', () => {
    const ledger = foldSpiderEvents(emptyLedger('live', T0), events)
    render(<SpiderPanel ledger={ledger} now={T0 + 6_000} />)
    expect([num('spider-inflight'), num('spider-returned'), num('spider-flagged')]).toEqual([1, 1, 1])
    fireEvent.click(screen.getByTestId('spider-toggle'))
    const items = screen.getByTestId('spider-lines').querySelectorAll('li')
    expect(items.length).toBe(5)
    expect(screen.getByTestId('spider-lines').textContent).toMatch(/returned from network · qwen_reason/)
    expect(screen.getByTestId('spider-lines').textContent).toMatch(/flagged at sandbox · shell_exec · TOOL_FAILURE/)
    expect(items[0].textContent).toMatch(/^\d\d:\d\d:\d\d/)
  })
  it('says so when it lists fewer lines than exist, so a counter never outruns its lines silently', () => {
    const many: AgentEvent[] = []
    for (let i = 0; i < 10; i++) many.push({ type: 'TOOL_START', tool: 'qwen_reason', iter: 0, timestamp: T0 + i * 10 }, { type: 'TOOL_SUCCESS', tool: 'qwen_reason', timestamp: T0 + i * 10 + 5 })
    render(<SpiderPanel ledger={foldSpiderEvents(emptyLedger('live', T0), many)} now={T0 + 1_000} />)
    expect(num('spider-returned')).toBe(10)
    fireEvent.click(screen.getByTestId('spider-toggle'))
    expect(screen.getByTestId('spider-lines').querySelectorAll('li').length).toBe(12)
    expect(screen.getByTestId('spider-more').textContent).toBe('showing the newest 12 of 20 lines')
  })
  it('flags a demo ledger as DEMO on the panel itself, in the summary of the data source', () => {
    render(<SpiderPanel ledger={emptyLedger('demo', T0)} now={T0} />)
    expect(screen.getByTestId('spider-demo-flag').textContent).toMatch(/DEMO · simulated events · not live/)
    expect(screen.getByTestId('spider-panel').getAttribute('data-source')).toBe('demo')
    expect(screen.getByTestId('spider-asof').textContent).toMatch(/\(demo feed\)/)
  })
  it('shows an unanswered start past its timeout as unknown, with the reason in its line', () => {
    const ledger = foldSpiderEvents(emptyLedger('live', T0), [{ type: 'TOOL_START', tool: 'shell_patch', iter: 0, timestamp: T0 }])
    render(<SpiderPanel ledger={ledger} now={T0 + 13 * 60_000} />)
    expect([num('spider-inflight'), num('spider-unknown')]).toEqual([0, 1])
    fireEvent.click(screen.getByTestId('spider-toggle'))
    expect(screen.getByTestId('spider-lines').textContent).toMatch(/unknown at sandbox · shell_patch · no end event since/)
  })
})

describe('panel visibility: shown for a run, gone when idle (owner order 2026-11-10)', () => {
  const settled: AgentEvent[] = [
    { type: 'TOOL_START', tool: 'github_read_file', iter: 0, timestamp: T0 },
    { type: 'TOOL_SUCCESS', tool: 'github_read_file', timestamp: T0 + 2_000 },
  ]
  it('appears while activity is fresh, then hides once the linger after settling passes', () => {
    const ledger = foldSpiderEvents(emptyLedger('live', T0), settled)
    const { rerender } = render(<SpiderPanel ledger={ledger} now={T0 + 3_000} />)
    expect(screen.getByTestId('spider-panel')).toBeTruthy()
    expect(num('spider-returned')).toBe(1)
    rerender(<SpiderPanel ledger={ledger} now={T0 + 2_000 + SPIDER_PANEL_LINGER_MS + 1_000} />)
    expect(screen.queryByTestId('spider-panel')).toBeNull()
  })
  it('stays up while a run is unanswered, however long that takes', () => {
    const ledger = foldSpiderEvents(emptyLedger('live', T0), [{ type: 'TOOL_START', tool: 'qwen_reason', iter: 0, timestamp: T0 }])
    render(<SpiderPanel ledger={ledger} now={T0 + 60 * 60_000} />)
    expect(screen.getByTestId('spider-panel')).toBeTruthy()
    // Past the tool's 31-minute timeout the run reads unknown, never in flight — still unanswered, still shown.
    expect([num('spider-inflight'), num('spider-unknown')]).toEqual([0, 1])
  })
  it('an untouched ledger shows the strip at mount, then it clears', () => {
    const { rerender } = render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel')).toBeTruthy()
    rerender(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0 + SPIDER_PANEL_LINGER_MS + 1_000} />)
    expect(screen.queryByTestId('spider-panel')).toBeNull()
  })
  it('sits above the composer bar instead of covering it and its SEND button', () => {
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(SPIDER_PANEL_BOTTOM_PX).toBeGreaterThanOrEqual(84)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe(`${SPIDER_PANEL_BOTTOM_PX}px`)
  })
})

describe('the panel is placed from the composer bar it must not cover (owner report 2026-11-13)', () => {
  const addBar = (top: number) => {
    const bar = document.createElement('div')
    bar.setAttribute('data-composer-bar', '')
    bar.getBoundingClientRect = () => ({ top, bottom: top + 80, left: 0, right: 100, width: 100, height: 80, x: 0, y: top, toJSON: () => ({}) })
    document.body.appendChild(bar)
    return bar
  }
  const setViewportHeight = (h: number) => Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
  afterEach(() => { document.querySelectorAll('[data-composer-bar]').forEach(e => e.remove()); setViewportHeight(768) })

  it('sits its bottom edge 8px above the measured top of the composer bar', () => {
    setViewportHeight(800)
    addBar(500)
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe('308px')   // 800 - 500 + 8
  })

  it('rises with a taller composer (a multi-line draft) instead of staying at a guessed height', async () => {
    setViewportHeight(800)
    const bar = addBar(500)
    const { rerender } = render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe('308px')
    bar.getBoundingClientRect = () => ({ top: 380, bottom: 460, left: 0, right: 100, width: 100, height: 80, x: 0, y: 380, toJSON: () => ({}) })
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise(resolveFrame => setTimeout(resolveFrame, 60)) })
    rerender(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe('428px')   // 800 - 380 + 8
  })

  it('follows a composer bar that mounts after the panel (the chat tab opens later than the app)', async () => {
    setViewportHeight(800)
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe(`${SPIDER_PANEL_BOTTOM_PX}px`)
    await act(async () => { addBar(500); await new Promise(resolveFrame => setTimeout(resolveFrame, 60)) })
    expect(screen.getByTestId('spider-panel').style.bottom).toBe('308px')
  })

  it('keeps the old clearance when there is no composer bar on the page', () => {
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} />)
    expect(screen.getByTestId('spider-panel').style.bottom).toBe(`${SPIDER_PANEL_BOTTOM_PX}px`)
  })

  it('caps the expanded list so the panel cannot run off the top of a short screen', () => {
    setViewportHeight(600)
    addBar(420)
    const ledger = foldSpiderEvents(emptyLedger('live', T0), [{ type: 'TOOL_START', tool: 'shell_exec', iter: 0, timestamp: T0 }])
    render(<SpiderPanel ledger={ledger} now={T0} />)
    fireEvent.click(screen.getByTestId('spider-toggle'))
    // min(600 * 0.38 = 228, 420 - 8 - 130 = 282) = 228
    expect(screen.getByTestId('spider-lines').style.maxHeight).toBe('228px')
  })

  it('the composer bar in App.tsx carries the attribute the panel looks for', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toContain("<div data-composer-bar style={{ position: 'sticky', bottom: 0")
  })
})

describe('ambient life is labelled and never counted', () => {
  it('the panel says ambient spiders are not tool events and not counted, names the seed, and the counters stay 0', () => {
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} ambient={{ seed: 11, freezeMs: 2500 }} />)
    expect(screen.getByTestId('spider-ambient').textContent).toBe('ambient life · seed 11 · frozen at 2.5 s · not tool events, not counted')
    expect(['spider-inflight', 'spider-returned', 'spider-flagged', 'spider-unknown'].map(num)).toEqual([0, 0, 0, 0])
  })
  it('no ambient note when ambient is off', () => {
    render(<SpiderPanel ledger={emptyLedger('live', T0)} now={T0} ambient={null} />)
    expect(screen.queryByTestId('spider-ambient')).toBeNull()
  })
  it('a rig with ambient on shows the note; ?ambient=0 and prefers-reduced-motion both remove it', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const { unmount } = render(<ThroneRig state={IDLE_NEURAL_STATE} events={[]} ambient={{ enabled: true, seed: 5 }} />)
    expect(screen.getByTestId('spider-ambient').textContent).toMatch(/seed 5/); unmount()
    render(<ThroneRig state={IDLE_NEURAL_STATE} events={[]} ambient={{ enabled: false, seed: 5 }} />)
    expect(screen.queryByTestId('spider-ambient')).toBeNull(); cleanup()
    const real = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
    try {
      render(<ThroneRig state={IDLE_NEURAL_STATE} events={[]} ambient={{ enabled: true, seed: 5 }} />)
      expect(screen.queryByTestId('spider-ambient')).toBeNull()
    } finally { window.matchMedia = real }
  })
})

describe('ThroneRig feeds the ledger from the ForgeOps events it is given', () => {
  it('the panel follows the events prop; a live rig is never labelled demo; a demo rig is', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(T0 + 6_000)
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const { rerender } = render(<ThroneRig state={IDLE_NEURAL_STATE} events={[]} />)
    expect(num('spider-inflight')).toBe(0); expect(screen.queryByTestId('spider-demo-flag')).toBeNull()
    rerender(<ThroneRig state={IDLE_NEURAL_STATE} events={events} />)
    expect([num('spider-inflight'), num('spider-returned'), num('spider-flagged')]).toEqual([1, 1, 1])
    expect(screen.queryByTestId('spider-demo-flag')).toBeNull()
    cleanup()
    render(<ThroneRig state={IDLE_NEURAL_STATE} events={events} spiders="demo" />)
    expect(screen.getByTestId('spider-demo-flag')).toBeTruthy()
    expect(num('spider-returned')).toBe(0) // the demo ledger never reads the live events
    act(() => { vi.advanceTimersByTime(16_000) })
    expect(num('spider-returned')).toBeGreaterThan(0) // ...it counts its own scripted ones
  })
})
