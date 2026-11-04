// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../types/forgeOps'
import { emptyLedger, eventsAfter, foldSpiderEvents, isStale, panelLines, spiderChannel, spiderCounters, type SpiderLedger } from './spiderlings'

const T0 = 1_800_000_000_000
const start = (tool: string, at: number): AgentEvent => ({ type: 'TOOL_START', tool, iter: 0, timestamp: at })
const ok = (tool: string, at: number): AgentEvent => ({ type: 'TOOL_SUCCESS', tool, timestamp: at })
const bad = (tool: string, at: number): AgentEvent => ({ type: 'TOOL_FAILURE', tool, failClass: 'NETWORK_FAILURE', timestamp: at })
const fold = (events: AgentEvent[], source: 'live' | 'demo' = 'live'): SpiderLedger => foldSpiderEvents(emptyLedger(source, T0), events)

/** Every number the panel can show must be explained by ledger lines: out = returned + flagged + unresolved + still open. */
function invariant(l: SpiderLedger, now: number) {
  const c = spiderCounters(l, now)
  expect(c.out).toBe(c.returned + c.flagged + c.unresolved + c.inFlight + c.unknown)
  expect(c.out).toBe(l.lines.filter(x => x.kind === 'out').length)
}

describe('which tools get a spider', () => {
  it('maps the real channels and gives local tools none', () => {
    expect(spiderChannel('browser_run')?.channel).toBe('browser')
    for (const t of ['shell_exec', 'shell_patch', 'sculpt_self', 'run_js']) expect(spiderChannel(t)?.channel, t).toBe('sandbox')
    for (const t of ['qwen_reason', 'ask_qwen', 'github_run_workflow', 'web_search', 'github_read_file', 'kalshi_markets']) expect(spiderChannel(t)?.channel, t).toBe('network')
    for (const t of ['memory_write', 'funds_propose', 'coding_task_update', 'error_report', 'spawn_agent', 'not_a_tool']) expect(spiderChannel(t), t).toBeNull()
  })
})

describe('the ledger (the owner\'s rule: no decorative spiders)', () => {
  it('no events: no runs, no lines, every counter zero', () => {
    const l = fold([])
    expect(l.runs).toEqual([]); expect(l.lines).toEqual([])
    expect(spiderCounters(l, T0)).toEqual({ inFlight: 0, returned: 0, flagged: 0, unresolved: 0, unknown: 0, out: 0 })
    expect(panelLines(l, T0)).toEqual([])
  })
  it('N starts make N spiders in flight, one line each', () => {
    const l = fold([start('browser_run', T0), start('shell_exec', T0 + 10), start('qwen_reason', T0 + 20)])
    expect(l.runs.map(r => r.channel)).toEqual(['browser', 'sandbox', 'network'])
    expect(spiderCounters(l, T0 + 30)).toMatchObject({ inFlight: 3, returned: 0, flagged: 0, out: 3 }); invariant(l, T0 + 30)
  })
  it('start then success: the spider returns, returned +1, none in flight', () => {
    const l = fold([start('qwen_reason', T0), ok('qwen_reason', T0 + 5_000)])
    expect(l.runs[0]).toMatchObject({ endedAt: T0 + 5_000, outcome: 'ok' })
    expect(spiderCounters(l, T0 + 6_000)).toMatchObject({ inFlight: 0, returned: 1, flagged: 0 }); invariant(l, T0 + 6_000)
  })
  it('start then failure: the spider is flagged, with the failure class on its line', () => {
    const l = fold([start('shell_exec', T0), bad('shell_exec', T0 + 3_000)])
    expect(l.runs[0]).toMatchObject({ outcome: 'failed', failClass: 'NETWORK_FAILURE' })
    expect(spiderCounters(l, T0 + 4_000)).toMatchObject({ inFlight: 0, returned: 0, flagged: 1 })
    expect(l.lines.at(-1)).toMatchObject({ kind: 'flagged', detail: 'NETWORK_FAILURE' }); invariant(l, T0 + 4_000)
  })
  it('an end with no unanswered start invents nothing; local tools never get a spider', () => {
    const l = fold([ok('qwen_reason', T0), bad('shell_exec', T0 + 1), start('memory_write', T0 + 2), ok('memory_write', T0 + 3)])
    expect(l.runs).toEqual([]); expect(l.lines).toEqual([])
  })
  it('pairs an end with the OLDEST unanswered start of the same tool (no run id yet), and counts stay right', () => {
    const l = fold([start('qwen_reason', T0), start('qwen_reason', T0 + 100), ok('qwen_reason', T0 + 200)])
    expect(l.runs[0].endedAt).toBe(T0 + 200); expect(l.runs[1].endedAt).toBeUndefined()
    expect(spiderCounters(l, T0 + 300)).toMatchObject({ inFlight: 1, returned: 1 }); invariant(l, T0 + 300)
  })
  it('staleness: a start with no end past its tool\'s timeout is UNKNOWN, never in flight', () => {
    const l = fold([start('shell_patch', T0)])
    const timeout = l.runs[0].timeoutMs
    expect(isStale(l.runs[0], T0 + timeout - 1)).toBe(false)
    expect(spiderCounters(l, T0 + timeout - 1)).toMatchObject({ inFlight: 1, unknown: 0 })
    expect(isStale(l.runs[0], T0 + timeout + 1)).toBe(true)
    expect(spiderCounters(l, T0 + timeout + 1)).toMatchObject({ inFlight: 0, unknown: 1 }); invariant(l, T0 + timeout + 1)
    const line = panelLines(l, T0 + timeout + 1)[0]
    expect(line.tone).toBe('unknown'); expect(line.text).toMatch(/unknown at sandbox · shell_patch · no end event since .*timeout 12 min/)
  })
  it('a stale spider that finally answers returns normally (the end event is the truth)', () => {
    const l = fold([start('shell_exec', T0), ok('shell_exec', T0 + 20 * 60_000)])
    expect(spiderCounters(l, T0 + 21 * 60_000)).toMatchObject({ returned: 1, unknown: 0 }); invariant(l, T0 + 21 * 60_000)
  })
  it('mission end / reset with a tool still unanswered: unresolved, not returned, not flagged', () => {
    for (const end of [{ type: 'MISSION_COMPLETE', timestamp: T0 + 9 } as AgentEvent, { type: 'MISSION_BLOCKED', reason: 'stop', timestamp: T0 + 9 } as AgentEvent, { type: 'RESET', timestamp: T0 + 9 } as AgentEvent]) {
      const l = fold([start('qwen_reason', T0), end])
      expect(spiderCounters(l, T0 + 10)).toMatchObject({ inFlight: 0, returned: 0, flagged: 0, unresolved: 1 }); invariant(l, T0 + 10)
    }
  })
  it('counters are counted from lines: tampering with the lines changes the counters, there is no separate tally', () => {
    const l = fold([start('qwen_reason', T0), ok('qwen_reason', T0 + 1)])
    const without = { ...l, lines: l.lines.filter(x => x.kind !== 'returned') }
    expect(spiderCounters(l, T0 + 2).returned).toBe(1); expect(spiderCounters(without, T0 + 2).returned).toBe(0)
  })
  it('is pure: the ledger it was given is never mutated, and a demo ledger stays a demo ledger', () => {
    const base = emptyLedger('demo', T0); const snapshot = JSON.stringify(base)
    const next = foldSpiderEvents(base, [start('qwen_reason', T0)])
    expect(JSON.stringify(base)).toBe(snapshot); expect(next.source).toBe('demo'); expect(next).not.toBe(base)
  })
  it('counting starts at the oldest event it read, and line ids stay unique', () => {
    const l = foldSpiderEvents(emptyLedger('live', T0 + 5_000), [start('qwen_reason', T0), ok('qwen_reason', T0 + 1)])
    expect(l.since).toBe(T0); expect(new Set(l.lines.map(x => x.id)).size).toBe(l.lines.length)
  })
  it('keeps unanswered runs and bounds the rest', () => {
    const events: AgentEvent[] = [start('browser_run', T0)]
    for (let i = 0; i < 80; i++) events.push(start('qwen_reason', T0 + i * 10), ok('qwen_reason', T0 + i * 10 + 5))
    const l = fold(events)
    expect(l.runs.some(r => r.tool === 'browser_run' && r.endedAt === undefined)).toBe(true)
    expect(l.runs.length).toBeLessThanOrEqual(61)
  })
})

describe('eventsAfter (the ForgeOps window slides at 60, so it tracks identity, not count)', () => {
  const a = start('qwen_reason', 1), b = ok('qwen_reason', 2), c = start('shell_exec', 3)
  it('returns only what came after the last seen event; everything when the last one slid out', () => {
    expect(eventsAfter([a, b, c], null)).toEqual([a, b, c])
    expect(eventsAfter([a, b, c], b)).toEqual([c])
    expect(eventsAfter([b, c], a)).toEqual([b, c])
    expect(eventsAfter([], b)).toEqual([])
  })
})
