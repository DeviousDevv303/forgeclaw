import { describe, expect, it } from 'vitest'
import { parseDirectDeepSeekCommand, shouldDispatchComplexTaskToDeepSeek } from './deepseekCommand'

describe('direct DeepSeek routing', () => {
  it('parses a case-insensitive /deepseek command and keeps the whole question', () => {
    expect(parseDirectDeepSeekCommand('  /DEEPSEEK  What is the capital of France?  ')).toEqual({
      matched: true,
      question: 'What is the capital of France?',
    })
  })

  it('recognizes the command with no question so the UI can show usage', () => {
    expect(parseDirectDeepSeekCommand('/deepseek')).toEqual({ matched: true, question: '' })
  })

  it('does not consume ordinary text or paths containing a slash', () => {
    expect(parseDirectDeepSeekCommand('Please run /deepseek later')).toBeNull()
    expect(parseDirectDeepSeekCommand('src/lib/deepseekCommand.ts')).toBeNull()
  })

  it('fast-paths complex task keywords past NEXUS knowledge checks', () => {
    expect(shouldDispatchComplexTaskToDeepSeek('Analyze this architecture and explain the trade-offs')).toBe(true)
    expect(shouldDispatchComplexTaskToDeepSeek('What is 2 + 2?')).toBe(false)
  })
})
