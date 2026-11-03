import { describe, expect, it } from 'vitest'
import { parseDirectQwenCommand, shouldDispatchComplexTaskToQwen } from './qwenCommand'

describe('direct Qwen routing', () => {
  it('parses a case-insensitive /qwen command and keeps the whole question', () => {
    expect(parseDirectQwenCommand('  /QWEN  What is the capital of France?  ')).toEqual({
      matched: true,
      question: 'What is the capital of France?',
    })
  })

  it('recognizes the command with no question so the UI can show usage', () => {
    expect(parseDirectQwenCommand('/qwen')).toEqual({ matched: true, question: '' })
  })

  it('does not consume ordinary text or paths containing a slash', () => {
    expect(parseDirectQwenCommand('Please run /qwen later')).toBeNull()
    expect(parseDirectQwenCommand('src/lib/qwenCommand.ts')).toBeNull()
  })

  it('fast-paths complex task keywords past NEXUS knowledge checks', () => {
    expect(shouldDispatchComplexTaskToQwen('Analyze this architecture and explain the trade-offs')).toBe(true)
    expect(shouldDispatchComplexTaskToQwen('What is 2 + 2?')).toBe(false)
  })
})
