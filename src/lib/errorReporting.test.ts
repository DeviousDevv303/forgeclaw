// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingErrorEntries, reportErrorsNow } from './errorReporting'

beforeEach(() => localStorage.clear())
const entries = [
  { timestamp: 100, level: 'error' as const, source: 'tool', message: 'GitHub 401 with ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  { timestamp: 200, level: 'warn' as const, source: 'ui', message: 'slow' },
]

describe('error reports to the developer', () => {
  it('sends new entries with secrets redacted, then only newer ones', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 202 }))
    expect(await reportErrorsNow('visitor', { relayUrl: 'https://relay.example', fetchImpl, entries })).toBe(2)
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.mode).toBe('visitor')
    expect(JSON.stringify(body)).not.toContain('ghp_abcdefghijklmnop')
    expect(pendingErrorEntries(entries)).toEqual([])
    expect(await reportErrorsNow('visitor', { relayUrl: 'https://relay.example', fetchImpl, entries })).toBe(0)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('keeps entries for the next try when the relay is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await reportErrorsNow('owner', { relayUrl: 'https://relay.example', fetchImpl, entries })).toBe(0)
    expect(pendingErrorEntries(entries)).toHaveLength(2)
  })

  it('does nothing without a relay', async () => {
    const fetchImpl = vi.fn()
    expect(await reportErrorsNow('owner', { relayUrl: '', fetchImpl, entries })).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
