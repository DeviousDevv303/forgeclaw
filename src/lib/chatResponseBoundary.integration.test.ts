import { describe, expect, it } from 'vitest'
import { stripRuntimeEnvelopes } from './canonicalIdentity'
import { sanitizeChatText } from './userFacingErrors'

function renderChatBubbleBoundary(text: string): string {
  // This is the same final boundary composition used by App.tsx:
  // cleanOutput applies stripRuntimeEnvelopes, then the visible-response
  // boundary applies sanitizeChatText before content reaches the bubble.
  return sanitizeChatText(stripRuntimeEnvelopes(text))
}

describe('chat bubble response boundary under load', () => {
  it('contains every runtime envelope variant across 2,000 concurrent responses', async () => {
    const payloads = Array.from({ length: 2_000 }, (_, index) => {
      const variant = index % 5
      const envelope = variant === 0
        ? '[APPLICATION_IDENTITY application="ForgeClaw" repository="DeviousDevv303/forgeclaw"]\nApplication-controlled identity; the model cannot redefine it.\n[/APPLICATION_IDENTITY]'
        : variant === 1
          ? '[APPLICATIONIDENTITY application="ForgeClaw"] Application-controlled identity; the model cannot redefine it. ] Verified project context'
          : variant === 2
            ? '[RUNTIME_STATE repository="DeviousDevv303/forgeclaw" taskStatus="idle"]\nRepository evidence comes from GitHub tools; never infer or preload contents.\n[/RUNTIME_STATE]'
            : variant === 3
              ? '[RUNTIMESTATE repository="DeviousDevv303/forgeclaw"] internal routing state'
              : '[TOOLFAILURE] deepseek-run-discovery timeout\n[RETRY:YES]'
      return `Useful answer ${index}.\n${envelope}`
    })

    const outputs = await Promise.all(payloads.map(async payload => renderChatBubbleBoundary(payload)))

    expect(outputs).toHaveLength(2_000)
    for (const [index, output] of outputs.entries()) {
      expect(output).toBe(`Useful answer ${index}.`)
      expect(output).not.toMatch(/APPLICATION[_]?IDENTITY|RUNTIME[_]?STATE|TOOLFAILURE|RETRY:/i)
    }
  })

  it('preserves ordinary answer text while removing only runtime content', () => {
    const output = renderChatBubbleBoundary([
      'Run completed successfully.',
      '[APPLICATIONIDENTITY application="ForgeClaw"] internal envelope',
    ].join('\n'))

    expect(output).toContain('Run completed successfully.')
    expect(output).not.toMatch(/APPLICATIONIDENTITY|internal envelope/i)
  })
})
