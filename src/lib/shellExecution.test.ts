/*
 * ForgeClaw — Shell execution reliability tests.
 *
 * Decisions: test only deterministic client-side boundaries without dispatching
 * a real GitHub Actions workflow. The fixtures model the logs produced by the
 * workflow and verify that the UI shell receives stdout and correlates its own
 * run instead of reading a stale concurrent run.
 *
 * Unfinished/untested: live GitHub dispatch from the phone remains an acceptance
 * test requiring the configured GitHub token and remote workflow permissions.
 */

import { describe, expect, it } from 'vitest'
import { shellExecutionTestables } from './shellExecution'

const { normalizeCommand, normalizeWorkingDirectory, parseOutput, isMatchingRun } = shellExecutionTestables

describe('shell execution UI boundary', () => {
  it('accepts PWD as the user-facing alias for pwd', () => {
    expect(normalizeCommand('PWD')).toBe('pwd')
    expect(normalizeCommand('pwd')).toBe('pwd')
  })

  it('normalizes compatible workspace paths and rejects escapes', () => {
    expect(normalizeWorkingDirectory('.')).toBe('.')
    expect(normalizeWorkingDirectory('/workspace')).toBe('.')
    expect(normalizeWorkingDirectory('/workspace/src')).toBe('src')
    expect(normalizeWorkingDirectory('../outside')).toBeNull()
    expect(normalizeWorkingDirectory('/etc')).toBeNull()
  })

  it('returns command stdout rather than a logs placeholder', () => {
    const raw = [
      '2026-10-01T00:00:00.0000000Z  === FORGECLAW EXECUTION ===',
      '2026-10-01T00:00:00.0000000Z  invocation_id=shell-test',
      '2026-10-01T00:00:00.0000000Z  start=2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00.0000000Z  /home/runner/work/forgeclaw/forgeclaw',
      '2026-10-01T00:00:00.0000000Z  exit_code=0',
      '2026-10-01T00:00:00.0000000Z  end=2026-10-01T00:00:01Z',
    ].join('\n')
    expect(parseOutput(raw, 'success')).toContain('/home/runner/work/forgeclaw/forgeclaw')
    expect(parseOutput(raw, 'success')).not.toContain('Logs downloaded')
  })

  it('matches only the dispatched workflow run', () => {
    expect(isMatchingRun({ id: 1, name: 'Shell exec shell-test', display_title: '', status: 'queued', conclusion: null, created_at: '2026-10-01T00:00:01Z', html_url: '', run_number: 1 }, 'shell-test', Date.parse('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isMatchingRun({ id: 2, name: 'Shell exec other', display_title: '', status: 'queued', conclusion: null, created_at: '2026-10-01T00:00:01Z', html_url: '', run_number: 2 }, 'shell-test', Date.parse('2026-10-01T00:00:00Z'))).toBe(false)
  })
})
