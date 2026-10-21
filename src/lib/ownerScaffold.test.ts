// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadOwnerScaffold, MAX_SCAFFOLD_CHARS, operatingLoopFor, saveOwnerScaffold } from './ownerScaffold'

const DEFAULT_LOOP = 'DEFAULT LOOP\n\n'

describe('the owner\'s private reasoning framework', () => {
  beforeEach(() => localStorage.clear())
  it('is kept in this browser, trimmed and bounded, and cleared by empty text', () => {
    expect(loadOwnerScaffold()).toBe('')
    expect(saveOwnerScaffold('  Phase A: look\r\nPhase B: act  ')).toBe('Phase A: look\nPhase B: act')
    expect(loadOwnerScaffold()).toBe('Phase A: look\nPhase B: act')
    expect(saveOwnerScaffold('x'.repeat(MAX_SCAFFOLD_CHARS + 500))).toHaveLength(MAX_SCAFFOLD_CHARS)
    expect(saveOwnerScaffold('   ')).toBe('')
    expect(localStorage.getItem('fc_owner_scaffold_v1')).toBeNull()
  })
  it('replaces the default loop when set, privately and briefly; the default stays when not', () => {
    expect(operatingLoopFor('', DEFAULT_LOOP)).toBe(DEFAULT_LOOP)
    expect(operatingLoopFor('   ', DEFAULT_LOOP)).toBe(DEFAULT_LOOP)
    const loop = operatingLoopFor('Phase A: look', DEFAULT_LOOP)
    expect(loop).toContain('Phase A: look')
    expect(loop).toMatch(/private reasoning, one or two lines per phase, never in the visible answer/)
    expect(loop).not.toContain('DEFAULT LOOP')
  })
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(loadOwnerScaffold(broken)).toBe('')
    expect(saveOwnerScaffold('Phase A', broken)).toBe('Phase A')
  })
})
