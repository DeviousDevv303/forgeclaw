import { describe, expect, it } from 'vitest'
import { isToolFailureOutput } from './toolOutcome'

describe('isToolFailureOutput', () => {
  it.each([
    '[TOOL ERROR] web_search has an unterminated quote',
    '[GUARDIAN BLOCKED] loop',
    '[GUARDIAN REJECTED] operator declined',
    '✗ VERIFICATION FAILED — commit abc not found in o/r (GitHub 422).',
  ])('treats %s as a failure', (output) => expect(isToolFailureOutput(output)).toBe(true))

  it.each([
    '✓ Stored "blade_note" in memory.',
    'check root bolts',
    '(no value stored for key "x")',
    'DuckDuckGo web search — "q" (1 result)',
  ])('does not treat %s as a failure', (output) => expect(isToolFailureOutput(output)).toBe(false))
})
