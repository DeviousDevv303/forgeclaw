import { describe, expect, it } from 'vitest'
import {
  isCorrelatedShellRun,
  MAX_SHELL_OUTPUT_CHARS,
  parseShellExecutionLog,
  resolveShellWorkingDirectory,
  type ShellWorkflowRun,
} from './shellCorrelation'

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

  it('fails closed when required payload fields are missing', () => {
    const missingEvent = run() as Partial<ShellWorkflowRun>
    delete missingEvent.event
    const missingBranch = run() as Partial<ShellWorkflowRun>
    delete missingBranch.head_branch
    const missingTitle = run() as Partial<ShellWorkflowRun>
    delete missingTitle.display_title
    const missingTimestamp = run() as Partial<ShellWorkflowRun>
    delete missingTimestamp.created_at

    expect(isCorrelatedShellRun(missingEvent, invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(missingBranch, invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(missingTitle, invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(missingTimestamp, invocationId, dispatchedAt, now)).toBe(false)
  })

  it('rejects an unrelated run even when it is the newest listed run', () => {
    expect(isCorrelatedShellRun(run({ display_title: 'Shell exec another-invocation' }), invocationId, dispatchedAt, now)).toBe(false)
    expect(isCorrelatedShellRun(run({ display_title: undefined }), invocationId, dispatchedAt, now)).toBe(false)
  })

  it('correlates concurrent dispatches independently regardless of result ordering', () => {
    const invocationA = 'shell-concurrent-a'
    const invocationB = 'shell-concurrent-b'
    const runA = run({ id: 101, display_title: `Shell exec ${invocationA}`, name: `Shell exec ${invocationA}` })
    const runB = run({ id: 102, display_title: `Shell exec ${invocationB}`, name: `Shell exec ${invocationB}` })
    const unrelated = run({ id: 103, display_title: 'Shell exec unrelated', name: 'Shell exec unrelated' })
    const results = [unrelated, runB, runA]

    expect(results.find(candidate => isCorrelatedShellRun(candidate, invocationA, dispatchedAt, now))?.id).toBe(101)
    expect(results.find(candidate => isCorrelatedShellRun(candidate, invocationB, dispatchedAt, now))?.id).toBe(102)
    expect(results.some(candidate => isCorrelatedShellRun(candidate, 'shell-concurrent-c', dispatchedAt, now))).toBe(false)
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

describe('Shell working-directory boundary', () => {
  const workspace = '/home/runner/work/forgeclaw/forgeclaw'

  it('allows the repository root and valid nested directories', () => {
    expect(resolveShellWorkingDirectory('.', workspace)).toBe(workspace)
    expect(resolveShellWorkingDirectory('src/lib', workspace)).toBe(`${workspace}/src/lib`)
  })

  it('rejects parent traversal, absolute paths, and traversal outside the workspace', () => {
    expect(resolveShellWorkingDirectory('..', workspace)).toBeNull()
    expect(resolveShellWorkingDirectory('/tmp', workspace)).toBeNull()
    expect(resolveShellWorkingDirectory('src/../../outside', workspace)).toBeNull()
  })
})

describe('Shell execution log parsing', () => {
  it('retains human-readable command output and exposes exit metadata', () => {
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

  it('bounds unusually large command output without changing exit metadata', () => {
    const output = 'x'.repeat(MAX_SHELL_OUTPUT_CHARS + 500)
    const parsed = parseShellExecutionLog(`=== FORGECLAW EXECUTION ===\nstart=now\n${output}\nexit_code=0`, 'success')
    expect(parsed.exitCode).toBe(0)
    expect(parsed.commandOutput).toHaveLength(MAX_SHELL_OUTPUT_CHARS)
  })

  it('uses a nonzero fallback when a failed run has no exit marker', () => {
    expect(parseShellExecutionLog('=== FORGECLAW EXECUTION ===\nstart=2026-09-30T13:54:28Z\ncommand output', 'failure')).toEqual({
      commandOutput: 'command output',
      exitCode: 1,
    })
  })
})
