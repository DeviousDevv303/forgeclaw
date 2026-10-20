import { describe, expect, it } from 'vitest'
import { describeScreen, redactSecrets, visibleText } from './lib/screenText'

describe('screen as text', () => {
  it('collapses blank runs and spacing', () => {
    expect(visibleText({ textContent: '  a   b \n\n\n\n  c  ' })).toBe('a b\n\nc')
  })
  it('puts the facts a bug report needs above the text', () => {
    const out = describeScreen({ textContent: 'hello' }, { now: new Date('2026-10-20T12:00:00Z'), url: 'https://x/y', viewport: '412×900', provider: 'moonshot', model: 'kimi-k2.7-code', requestStatus: 'error', lastError: 'Failed to fetch' })
    expect(out).toContain('2026-10-20T12:00:00.000Z')
    expect(out).toContain('Screen: 412×900')
    expect(out).toContain('Model: moonshot · kimi-k2.7-code')
    expect(out).toContain('Last error: Failed to fetch')
    expect(out.trimEnd().endsWith('hello')).toBe(true)
  })
  it('never lets a credential-shaped string through', () => {
    const fake = 'ghp_' + 'a'.repeat(30)
    expect(redactSecrets(`token ${fake} and sk-${'b'.repeat(20)}`)).toBe('token [redacted] and [redacted]')
    expect(describeScreen({ textContent: `key ${fake}` })).not.toContain(fake)
  })
  it('keeps the newest text when it has to cut', () => {
    const out = describeScreen({ textContent: `OLD\n${'x'.repeat(70000)}\nNEWEST` })
    expect(out).toContain('NEWEST')
    expect(out).not.toContain('OLD')
  })
})
