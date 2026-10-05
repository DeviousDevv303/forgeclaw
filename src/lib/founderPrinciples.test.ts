import { describe, expect, it } from 'vitest'
import { FOUNDER_PRINCIPLES, FOUNDER_PRINCIPLES_DOCUMENT } from './founderPrinciples'

describe('canonical Founder principles', () => {
  it('projects every required section from the single Markdown source', () => {
    expect(FOUNDER_PRINCIPLES.sourcePath).toBe('docs/founder-principles.md')
    expect(FOUNDER_PRINCIPLES.principle).toContain('Replacing a photo is evolution, if it\'s used for a purpose.')
    expect(FOUNDER_PRINCIPLES.motive).toContain('Codex Anima is the guardian.')
    expect(FOUNDER_PRINCIPLES.motive).toContain('CORPUS is the memory.')
    expect(FOUNDER_PRINCIPLES.completionStandard).toContain('the job isn\'t done until it\'s fully completed')
    expect(FOUNDER_PRINCIPLES_DOCUMENT).toContain('## Purpose and scope')
    expect(FOUNDER_PRINCIPLES_DOCUMENT).toContain('foundational governance, not ordinary runtime configuration')
  })
})
