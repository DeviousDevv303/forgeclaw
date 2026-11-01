import { describe, expect, it } from 'vitest'
import { buildLearningEvent, MAX_LEARNING_FIELD_CHARS, outcomeFromToolOutput, recordLearningEvent, type LearningRecorder } from './learningEvents'

const base = { channel: 'tool' as const, input: 'memory_read key="a"', result: 'ok', outcome: 'completed' as const, runtime: 'corpus', model: 'deepseek' }

describe('outcomeFromToolOutput', () => {
  it('treats normal output as completed, never verified', () => expect(outcomeFromToolOutput('listing…')).toBe('completed'))
  it('treats tool errors as failed', () => expect(outcomeFromToolOutput('[TOOL ERROR] nope')).toBe('failed'))
  it('treats ✗ output as failed', () => expect(outcomeFromToolOutput('✗ exit 2')).toBe('failed'))
  it('treats Guardian refusals as blocked', () => {
    expect(outcomeFromToolOutput('[GUARDIAN BLOCK] needs co-sign')).toBe('blocked')
    expect(outcomeFromToolOutput('[GUARDIAN REJECTED] no')).toBe('blocked')
  })
})

describe('buildLearningEvent', () => {
  it('stamps channel, outcome and the unapproved admission marker', () => {
    const built = buildLearningEvent({ ...base, toolName: 'memory_read', actor: 'operator' })
    expect(built.source).toBe('learning:tool')
    expect(built.metadata).toMatchObject({ channel: 'tool', outcome: 'completed', tool: 'memory_read', actor: 'operator', admission: 'unapproved' })
    expect(built.context).toContain('outcome=completed')
  })
  it('defaults voice-channel events to voice origin and others to typed', () => {
    expect(buildLearningEvent({ ...base, channel: 'voice', lineage: 'none' }).metadata?.origin).toBe('voice')
    expect(buildLearningEvent(base).metadata?.origin).toBe('typed')
  })
  it('redacts secrets in input and result and flags it', () => {
    const built = buildLearningEvent({ ...base, input: 'curl -H "Authorization: Bearer abc123" with ghp_abcdef1234567890', result: 'token=sk-live-123' })
    expect(built.input).not.toMatch(/abc123|ghp_abcdef/)
    expect(built.result).not.toContain('sk-live-123')
    expect(built.metadata?.redacted_or_truncated).toBe('true')
  })
  it('bounds long text', () => {
    const built = buildLearningEvent({ ...base, result: 'x'.repeat(MAX_LEARNING_FIELD_CHARS * 3) })
    expect(built.result.length).toBeLessThanOrEqual(MAX_LEARNING_FIELD_CHARS)
  })
  it('keeps outcomes distinct in the hashed context', () => {
    expect(buildLearningEvent(base).context).not.toBe(buildLearningEvent({ ...base, outcome: 'failed' }).context)
  })
})

describe('recordLearningEvent', () => {
  it('appends through the repository', async () => {
    const seen: unknown[] = []
    const recorder: LearningRecorder = { appendInteraction: async input => { seen.push(input) } }
    expect(await recordLearningEvent(base, recorder)).toBe(true)
    expect(seen).toHaveLength(1)
  })
  it('skips blank input', async () => {
    const recorder: LearningRecorder = { appendInteraction: async () => { throw new Error('should not run') } }
    expect(await recordLearningEvent({ ...base, input: '  ' }, recorder)).toBe(false)
  })
  it('never throws when storage fails', async () => {
    const recorder: LearningRecorder = { appendInteraction: async () => { throw new Error('quota') } }
    expect(await recordLearningEvent(base, recorder)).toBe(false)
  })
})
