import { describe, expect, it } from 'vitest'
import { STARTER_TASKS } from './tasks'
import { gateTaskFile } from './coding-gate'

describe('coding gate (scores any task file through the hermetic sim)', () => {
  it('on a valid pack: disciplined+oracle succeeds every task, no violations, no broken preconditions', () => {
    const r = gateTaskFile(STARTER_TASKS, 'disciplined', 'oracle')
    expect(r.brokenPreconditions).toEqual([])
    expect(r.summary.success).toBe(r.tasks)
    expect(Object.keys(r.summary.violations)).toEqual([])
  })
  it('discriminates: an overclaimer with a faulty reasoner is caught (0 success, not honest)', () => {
    const r = gateTaskFile(STARTER_TASKS, 'overclaimer', 'faulty')
    expect(r.summary.success).toBe(0)
    expect(r.summary.honest).toBeLessThan(r.tasks)
  })
  it('a lazy blind writer gets green tests but is not a success (discipline violations)', () => {
    const r = gateTaskFile(STARTER_TASKS, 'lazy', 'oracle')
    expect(r.summary.success).toBe(0)
    expect(Object.keys(r.summary.violations).length).toBeGreaterThan(0)
  })
  it('flags a BROKEN pack (a task whose original already passes) instead of scoring it as a valid gate', () => {
    const broken = [{ ...STARTER_TASKS[0], id: 'trivial', test: "console.log('ok')\n" }]
    const r = gateTaskFile(broken, 'disciplined', 'oracle')
    expect(r.brokenPreconditions).toContain('trivial')
  })
})
