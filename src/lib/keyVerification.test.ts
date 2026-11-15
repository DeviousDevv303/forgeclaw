// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearKeyVerified, isKeyRejection, isKeyVerified, keyFingerprint, markKeyVerified } from './keyVerification'

beforeEach(() => localStorage.clear())

describe('a verified key stays verified', () => {
  it('remembers a key that tested fine, across reloads, for exactly that key', () => {
    expect(isKeyVerified('moonshot', 'sk-abc')).toBe(false)
    markKeyVerified('moonshot', 'sk-abc')
    expect(isKeyVerified('moonshot', 'sk-abc')).toBe(true)
    expect(isKeyVerified('moonshot', '  sk-abc  ')).toBe(true)
    expect(isKeyVerified('moonshot', 'sk-abd')).toBe(false)
    expect(isKeyVerified('anthropic', 'sk-abc')).toBe(false)
  })
  it('never stores the key itself', () => {
    markKeyVerified('moonshot', 'sk-very-secret-key-123456')
    expect(JSON.stringify({ ...localStorage })).not.toContain('sk-very-secret-key-123456')
  })
  it('stops being verified only on evidence: cleared, or the key is replaced', () => {
    markKeyVerified('moonshot', 'sk-abc')
    clearKeyVerified('moonshot')
    expect(isKeyVerified('moonshot', 'sk-abc')).toBe(false)
    markKeyVerified('moonshot', 'sk-abc')
    markKeyVerified('moonshot', 'sk-new')
    expect(isKeyVerified('moonshot', 'sk-abc')).toBe(false)
    expect(isKeyVerified('moonshot', 'sk-new')).toBe(true)
  })
  it('an empty key is never verified, and the fingerprint is stable and distinguishes keys', () => {
    markKeyVerified('moonshot', '   ')
    expect(isKeyVerified('moonshot', '')).toBe(false)
    expect(keyFingerprint('a')).toBe(keyFingerprint('a'))
    expect(keyFingerprint('a')).not.toBe(keyFingerprint('b'))
  })
  it('tells a rejection from a network failure', () => {
    for (const m of ['Moonshot 401: Invalid Authentication', 'HTTP 403 forbidden', 'unauthorized', 'invalid api key', 'authentication failed']) expect(isKeyRejection(m), m).toBe(true)
    for (const m of ['Failed to fetch', 'network error', 'timeout', 'Moonshot 500: server error', 'Load failed']) expect(isKeyRejection(m), m).toBe(false)
  })
})
