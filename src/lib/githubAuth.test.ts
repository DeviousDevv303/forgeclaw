// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// F-030 regression tests: a GitHub-token persist is a claim only read-back can make.
// The old writer swallowed storage failures (Settings still flashed "SAVED") and ignored
// empty input, so clearing the field left the old token in storage to be resurrected by
// resolveGithubToken() on the next load.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistGithubToken, resolveGithubToken } from './githubAuth'

describe('persistGithubToken (F-030)', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('persists a token and reports success only after read-back', () => {
    expect(persistGithubToken('ghp_token123')).toBe(true)
    expect(localStorage.getItem('gh_token')).toBe('ghp_token123')
    expect(resolveGithubToken()).toBe('ghp_token123')
  })

  it('clearing the token removes it from storage — no resurrection on reload', () => {
    expect(persistGithubToken('ghp_oldtoken')).toBe(true)
    expect(persistGithubToken('')).toBe(true)
    expect(localStorage.getItem('gh_token')).toBeNull()
    expect(resolveGithubToken()).toBe('')
  })

  it('a whitespace-only persist also clears the stored token', () => {
    expect(persistGithubToken('ghp_oldtoken')).toBe(true)
    expect(persistGithubToken('   ')).toBe(true)
    expect(localStorage.getItem('gh_token')).toBeNull()
  })

  it('a throwing storage write reports failure instead of swallowing it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(persistGithubToken('ghp_newtoken')).toBe(false)
    vi.restoreAllMocks()
    expect(localStorage.getItem('gh_token')).toBeNull()
  })

  it('a throwing storage remove reports failure on clear', () => {
    expect(persistGithubToken('ghp_oldtoken')).toBe(true)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(persistGithubToken('')).toBe(false)
  })
})
