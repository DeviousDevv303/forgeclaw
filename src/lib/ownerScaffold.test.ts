// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadOwnerScaffold, MAX_SCAFFOLD_CHARS, operatingLoopFor, reasoningFormatReminder, saveOwnerScaffold } from './ownerScaffold'

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
    // Required, labeled and task-specific; no "skip it for a plain question" escape (2026-10-22: three runs, no phase labels).
    expect(loop).toMatch(/MUST be written in the phases of the framework below, in order, as labeled lines/)
    expect(loop).toMatch(/Do not skip, merge or rename a phase/)
    expect(loop).toMatch(/about THIS task/)
    expect(loop).toMatch(/never in the visible answer/)
    expect(loop).not.toMatch(/skip it for a plain question/)
    expect(loop).not.toContain('DEFAULT LOOP')
  })
  it('the reminder exists only when a framework is set', () => {
    expect(reasoningFormatReminder('')).toBe('')
    expect(reasoningFormatReminder('Phase A')).toMatch(/REASONING FORMAT \(REQUIRED/)
  })
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(loadOwnerScaffold(broken)).toBe('')
    expect(saveOwnerScaffold('Phase A', broken)).toBe('Phase A')
  })
})
