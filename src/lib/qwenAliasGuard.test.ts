// @vitest-environment node
// Guard for docs/migrations/DEEPSEEK-TO-QWEN-PLAN.md: the code says Qwen everywhere, but whatever was written under the old names (stored records,
// saved sessions, saved conversations, model output) must still be read as Qwen. A reader that forgot the old name would treat a Qwen answer as a
// stranger and could let it self-admit.
import { describe, expect, it } from 'vitest'
import { answerLineage, answerOutcome, hasQwenLineage, NOT_EVIDENCE_TOOLS, QWEN_LINEAGE_TOOLS } from './nexusConvergence'
import { isQwenProvider } from './ai/providerRouter'
import { resolveInitialProvider, DEFAULT_PROVIDER } from './providerDefaults'
import { LEGACY_TOOL_NAMES } from './forgeTools'

describe('legacy deepseek names are still read as Qwen', () => {
  it('lineage: runtime ids, source prefixes, tool names, model labels', () => {
    for (const id of ['qwen', 'deepseek', 'corpus']) {
      expect(answerLineage(id, []), id).toBe('qwen')
      expect(hasQwenLineage({ runtime: id }), id).toBe(true)
    }
    for (const source of ['qwen:github-actions', 'deepseek:github-actions']) expect(hasQwenLineage({ source }), source).toBe(true)
    for (const model of ['qwen3-8b', 'deepseek-16b', 'Qwen/Qwen3-8B']) expect(hasQwenLineage({ model }), model).toBe(true)
    expect(hasQwenLineage({ source: 'moonshot:x', runtime: 'moonshot', model: 'kimi-k2.7-code' })).toBe(false)
    for (const t of ['qwen_reason', 'ask_qwen', 'deepseek_reason', 'ask_deepseek']) expect(QWEN_LINEAGE_TOOLS.has(t), t).toBe(true)
    expect(answerLineage('moonshot', [{ name: 'deepseek_reason' }])).toBe('qwen')
  })
  it('router and saved-session resolution', () => {
    expect(isQwenProvider('qwen')).toBe(true)
    expect(isQwenProvider('deepseek')).toBe(true)
    expect(isQwenProvider('moonshot')).toBe(false)
    expect(DEFAULT_PROVIDER).toBe('qwen')
    expect(resolveInitialProvider('deepseek')).toBe('qwen')
    expect(resolveInitialProvider('moonshot')).toBe('moonshot')
  })
  it("a Qwen answer is never evidence, under the new tool names or the old ones (Route C)", () => {
    for (const name of ['qwen_reason', 'ask_qwen', 'deepseek_reason', 'ask_deepseek']) {
      expect(NOT_EVIDENCE_TOOLS.has(name), name).toBe(true)
      expect(answerOutcome(false, [{ name, isError: false }]), name).toBe('completed')
    }
    expect(answerOutcome(false, [{ name: 'github_read_file', isError: false }])).toBe('verified')
  })
  it('every legacy tool name maps to a current one', () => {
    expect(LEGACY_TOOL_NAMES).toEqual({ deepseek_reason: 'qwen_reason', ask_deepseek: 'ask_qwen', deepseekreason: 'qwenreason' })
  })
})
