import { describe, expect, it } from 'vitest'
import { isCorrelatedShellRun, parseShellExecutionLog, type ShellWorkflowRun } from './shellCorrelation'

const dispatchedAt = Date.parse('2026-09-30T13:54:20.000Z')
const now = Date.parse('2026-09-30T13:54:30.000Z')
const invocationId = 'shell-1790776461550-82cdf286'

function run(overrides: Partial<ShellWorkflowRun> = {}): ShellWorkflowRun {
  return {
    id: 36725078486,
    name: `Shell exec ${invocationId}`,
    display_title: `Shell exec ${invocationId}`,
    event: 'workflow_dispatch',
    status: 'queued',
    conclusion: null,
    created_at: '2026-09-30T13:54:24.000Z',
    head_branch: 'main',
    html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/36725078486',
    run_number: 42,
    ...overrides,
  }
}

describe('Shell workflow correlation', () => {
  it('accepts the live GitHub run-name shape for the matching invocation', () => {
    expect(isCorrelatedShellRun(run(), invocationId, dispatchedAt, now)).toBe(true)
  })

  it('rejects an unrelated run even when it is the newest listed run', () => {
    expect(isCorrelatedShellRun(run({ display_title: 'Shell exec another-invocation' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ display_title: undefined, name: 'ForgeClaw Shell Execution' }), invocationId, dispatchedAt, now)).toBe(false)
  })

  it('rejects stale, future, wrong-event, wrong-ref, malformed, and invalid runs', () => {
    expect(isCorrelatedShellRun(run({ created_at: '2026-09-30T13:52:00.000Z' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ created_at: '2026-09-30T13:56:00.000Z' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ event: 'push' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ head_branch: 'feature/other' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ id: 0 }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ created_at: 'not-a-date' }), invocationId, dispatchedAt, now)).toBe(false)
  })
})

describe('Shell execution log parsing', () => {
  it('retains human-readable command output and exposes invocation/run/exit metadata at the caller', () => {
    const parsed = parseShellExecutionLog(
      '2026-09-30T13:54:28.0000000Z  === FORGECLAW EXECUTION ===\n' +
      '2026-09-30T13:54:28.0000000Z  invocation_id=shell-1\n' +
      '2026-09-30T13:54:28.0000000Z  start=2026-09-30T13:54:28Z\n' +
      '2026-09-30T13:54:28.0000000Z  hello world\n' +
      '2026-09-30T13:54:28.0000000Z  exit_code=0\n' +
      '2026-09-30T13:54:28.0000000Z  end=2026-09-30T13:54:28Z',
      'success',
    )
    expect(parsed).toEqual({ commandOutput: 'hello world', exitCode: 0 })
  })

  it('uses a nonzero fallback when a failed run has no exit marker', () => {
    expect(parseShellExecutionLog('=== FORGECLAW EXECUTION ===\nstart=2026-09-30T13:54:28Z\ncommand output', 'failure')).toEqual({
      commandOutput: 'command output',
      exitCode: 1,
    })
  })
})
