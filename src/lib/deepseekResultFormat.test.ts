// Regression test: deepseek_reason's user-visible output must never leak
// internal corpus-learning bookkeeping into the chat bubble.
// The learning-persistence status belongs in the Stages line (reasoning trace).
import { describe, expect, it } from 'vitest'
import { formatDeepSeekResultText } from './forgeTools'

describe('deepseek_reason user-visible output', () => {
  const stages =
    'Stages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; ' +
    'result-retrieval=mirror; result-extraction=complete; checkpoint=deepseek-ai/deepseek-llm-7b-chat; ' +
    'learning-persistence=unapproved candidate recorded.'

  it('keeps the workflow result and run metadata, with no learning suffix', () => {
    const out = formatDeepSeekResultText(
      'deepseek-1791324489222-tc7ush',
      'DeviousDevv303',
      'forgeclaw',
      'main',
      stages,
      'https://github.com/DeviousDevv303/forgeclaw/actions/runs/1',
      'The answer text.',
    )
    expect(out).toContain('✓ DeepSeek-16B completed as deepseek-1791324489222-tc7ush on DeviousDevv303/forgeclaw@main.')
    expect(out).toContain('The answer text.')
    expect(out).toContain('learning-persistence=unapproved candidate recorded.')
  })

  it('never appends internal learning bookkeeping to the chat-visible answer', () => {
    const out = formatDeepSeekResultText(
      'deepseek-1',
      'o',
      'r',
      'main',
      stages,
      'https://example.invalid/run',
      'The answer text.',
    )
    expect(out).not.toContain('Learning candidate recorded as unapproved.')
    expect(out).not.toContain('Learning persistence warning')
    expect(out).not.toMatch(/unapproved\.\s*$/)
  })
})
