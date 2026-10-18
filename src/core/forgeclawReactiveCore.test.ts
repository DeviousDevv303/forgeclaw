// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../types/forgeOps'
import { ForgeClawReactiveCore, STATE_EVENT_NAME, SUCCESS_HOLD_MS, installForgeCore, mapForgeOpsEvent, sourceForTool, type ForgeClawStateEvent } from './forgeclawReactiveCore'
import { takeNewEvents } from '../lib/forgeEventCursor'

const ev = (e: Record<string, unknown>) => ({ timestamp: 1, ...e }) as unknown as AgentEvent

afterEach(() => { vi.useRealTimers(); delete window.forgeCore })

describe('reactive core: mapping real ForgeOps events', () => {
  it('maps the agent lifecycle onto idle/thinking/running/success/error', () => {
    expect(mapForgeOpsEvent(ev({ type: 'OBJECTIVE_RECEIVED', objective: 'x' }))?.state).toBe('thinking')
    expect(mapForgeOpsEvent(ev({ type: 'PHASE_CHANGE', phase: 'PLAN' }))?.state).toBe('thinking')
    expect(mapForgeOpsEvent(ev({ type: 'PHASE_CHANGE', phase: 'EXECUTION' }))?.state).toBe('running')
    expect(mapForgeOpsEvent(ev({ type: 'MISSION_COMPLETE' }))?.state).toBe('success')
    expect(mapForgeOpsEvent(ev({ type: 'MISSION_BLOCKED', reason: 'r' }))).toEqual({ state: 'error', intensity: 10, source: 'agent' })
    expect(mapForgeOpsEvent(ev({ type: 'GUARDIAN_WARNING', reason: 'r' }))?.source).toBe('system')
    expect(mapForgeOpsEvent(ev({ type: 'RESET' }))?.state).toBe('idle')
    expect(mapForgeOpsEvent(ev({ type: 'CHECKPOINT', iter: 1, total: 2 }))).toBeNull()
  })

  it('tags shell and git tools with their source', () => {
    expect(sourceForTool('shell_exec')).toBe('shell')
    expect(sourceForTool('shell_patch')).toBe('shell')
    expect(sourceForTool('github_write_file')).toBe('git')
    expect(sourceForTool('deepseek_reason')).toBe('agent')
    expect(mapForgeOpsEvent(ev({ type: 'TOOL_START', tool: 'shell_exec', iter: 0 }))).toEqual({ state: 'running', intensity: 7, source: 'shell' })
    expect(mapForgeOpsEvent(ev({ type: 'TOOL_FAILURE', tool: 'github_read_file', failClass: 'NETWORK' }))).toEqual({ state: 'error', intensity: 7, source: 'git' })
  })
})

describe('reactive core: broadcast contract', () => {
  it('dispatches forgeclaw:state on window with exactly the agreed schema', () => {
    const core = new ForgeClawReactiveCore({ now: () => 42 })
    const got: ForgeClawStateEvent[] = []
    const onState = (e: Event) => got.push((e as CustomEvent<ForgeClawStateEvent>).detail)
    window.addEventListener(STATE_EVENT_NAME, onState)
    core.ingest(ev({ type: 'TOOL_START', tool: 'shell_exec', iter: 0 }))
    window.removeEventListener(STATE_EVENT_NAME, onState)
    expect(got).toEqual([{ state: 'running', activity: 0.8, intensity: 7, source: 'shell', timestamp: 42 }])
    expect(Object.keys(got[0]).sort()).toEqual(['activity', 'intensity', 'source', 'state', 'timestamp'])
  })

  it('never leaks prompt text, error reasons or tool output into payloads', () => {
    const core = new ForgeClawReactiveCore()
    const secret = 'ghp_DO_NOT_LEAK my private objective'
    const seen: string[] = []
    core.subscribe(m => seen.push(JSON.stringify(m)))
    core.ingest(ev({ type: 'OBJECTIVE_RECEIVED', objective: secret }))
    core.ingest(ev({ type: 'MISSION_BLOCKED', reason: secret }))
    core.ingest(ev({ type: 'GUARDIAN_WARNING', reason: secret }))
    expect(seen.length).toBe(3)
    for (const s of seen) expect(s).not.toContain('DO_NOT_LEAK')
  })

  it('keeps activity in 0..1 and intensity in 1..10', () => {
    const core = new ForgeClawReactiveCore({ target: null })
    expect(core.pulse('execution', 7).activity).toBe(1)
    expect(core.pulse('execution', -3).activity).toBe(0)
    expect(core.setState('error', { severity: 99 }).intensity).toBe(10)
    expect(core.setState('thinking', { severity: 0 }).intensity).toBe(1)
    expect(core.trigger('git_activity').source).toBe('git')
  })

  it('relaxes success back to idle, and a new event cancels the pending relax', () => {
    vi.useFakeTimers()
    const core = new ForgeClawReactiveCore({ target: null })
    core.setState('success')
    vi.advanceTimersByTime(SUCCESS_HOLD_MS + 1)
    expect(core.state).toBe('idle')
    core.setState('success')
    core.setState('running')
    vi.advanceTimersByTime(SUCCESS_HOLD_MS + 1)
    expect(core.state).toBe('running')
  })

  it('keeps a bounded history for late subscribers and isolates listener failures', () => {
    const core = new ForgeClawReactiveCore({ target: null })
    core.subscribe(() => { throw new Error('bad visual layer') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 50; i++) core.setState(i % 2 ? 'running' : 'thinking')
    expect(core.eventQueue.length).toBe(20)
    expect(core.getSnapshot().state).toBe('running')
  })

  it('installs one singleton on window', () => {
    const a = installForgeCore()
    expect(window.forgeCore).toBe(a)
    expect(installForgeCore()).toBe(a)
  })
})

describe('event cursor (60-event ForgeOps window)', () => {
  it('finds new events by identity even when the window length stays constant', () => {
    const mk = (i: number) => ({ i })
    let win = Array.from({ length: 60 }, (_, i) => mk(i))
    const last = win[59]
    win = [...win, mk(60), mk(61)].slice(-60)
    expect(win.length).toBe(60)
    expect(takeNewEvents(win, last).map(e => e.i)).toEqual([60, 61])
    expect(takeNewEvents(win, win[59])).toEqual([])
    expect(takeNewEvents(win, { i: -1 }).length).toBe(60) // last seen slid out: all visible are newer
    expect(takeNewEvents([], last)).toEqual([])
    expect(takeNewEvents(win, null).length).toBe(60)
  })
})
