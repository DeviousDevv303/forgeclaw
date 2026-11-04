// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpiderPanel } from './SpiderPanel'
import { ThroneRig } from './ThroneRig'
import { IDLE_NEURAL_STATE } from '../hooks/useNeuralState'
import { emptyLedger, foldSpiderEvents } from '../lib/spiderlings'
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
