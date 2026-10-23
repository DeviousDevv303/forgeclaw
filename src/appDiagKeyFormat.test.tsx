// @vitest-environment jsdom
// F-017: the Diagnostics panel's "Key format valid" hint must read the provider's own
// format gate (isConfigured — the exact check send() enforces by throwing
// 'Invalid ... API key format'), not mere presence. The Settings inputs write raw
// keystrokes into state, so a malformed key is reachable in-session while the provider
// treats it as no key at all; the panel must not call it format-valid.
import { describe, expect, it } from 'vitest'
import { diagKeyFormatValid } from './lib/diagKeyFormat'

describe('diagKeyFormatValid (F-017)', () => {
  it('rejects a malformed anthropic key the provider would refuse', () => {
    expect(diagKeyFormatValid('anthropic', 'abc', '', true)).toBe(false)
  })

  it('accepts a well-formed anthropic key', () => {
    expect(diagKeyFormatValid('anthropic', 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx', '', true)).toBe(true)
  })

  it('rejects a malformed moonshot key the provider would refuse', () => {
    expect(diagKeyFormatValid('moonshot', '', 'abc', true)).toBe(false)
  })

  it('accepts a well-formed moonshot key', () => {
    expect(diagKeyFormatValid('moonshot', '', 'sk-xxxxxxxxxxxxxxxxxxxxxxxx', true)).toBe(true)
  })

  it('falls back to presence for providers with no key-format gate', () => {
    expect(diagKeyFormatValid('local', '', '', true)).toBe(true)
    expect(diagKeyFormatValid('local', '', '', false)).toBe(false)
  })
})
