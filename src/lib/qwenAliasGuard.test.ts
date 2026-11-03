// @vitest-environment node
// Stage 1 of docs/migrations/DEEPSEEK-TO-QWEN-PLAN.md: every reader that accepts the old provider id 'deepseek' must accept 'qwen' too, or a
// record or session written under the new name is treated as a stranger (a Qwen answer losing lineage could self-admit).
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { answerLineage, hasQwenLineage, QWEN_LINEAGE_TOOLS } from './nexusConvergence'
import { isDeepSeekProvider, isQwenProvider, providers } from './ai/providerRouter'
import { PROVIDER_IDS } from './providerDefaults'
import { DEFAULT_MODEL, PROVIDERS } from './modelProviders'

describe('qwen alias guard (old and new ids behave the same)', () => {
  it('lineage: runtime, source prefix and tool names', () => {
    for (const id of ['deepseek', 'qwen', 'corpus']) {
      expect(answerLineage(id, []), id).toBe('qwen')
      expect(hasQwenLineage({ runtime: id }), id).toBe(true)
    }
    expect(hasQwenLineage({ source: 'deepseek:github-actions' })).toBe(true)
    expect(hasQwenLineage({ source: 'qwen:github-actions' })).toBe(true)
    expect(hasQwenLineage({ source: 'moonshot:x', runtime: 'moonshot', model: 'kimi-k2.7-code' })).toBe(false)
    for (const t of ['deepseek_reason', 'ask_deepseek', 'qwen_reason', 'ask_qwen']) expect(QWEN_LINEAGE_TOOLS.has(t), t).toBe(true)
    expect(answerLineage('moonshot', [{ name: 'qwen_reason' }])).toBe('qwen')
  })
  it('router, id list, provider table and default model all know both ids', () => {
    expect(isDeepSeekProvider('qwen')).toBe(true)
    expect(isQwenProvider('deepseek')).toBe(true)
    expect(isQwenProvider('moonshot')).toBe(false)
    expect(PROVIDER_IDS).toContain('qwen')
    expect(providers.qwen).toBe(providers.deepseek)
    expect(PROVIDERS.qwen.name).toBe(PROVIDERS.deepseek.name)
    expect(DEFAULT_MODEL.qwen).toBe(DEFAULT_MODEL.deepseek)
  })
  it("no source line compares a provider to 'deepseek' without also naming 'qwen'", () => {
    const out = execFileSync('git', ['grep', '-n', '-E', "(===|!==) ?'deepseek'|'deepseek' ?(===|!==)|case 'deepseek'", '--', 'src', ':!*.test.*'], { encoding: 'utf8' })
    const lone = out.split('\n').filter(l => l && !l.includes('qwen'))
    // routeLocalTask's internal 'deepseek' | 'local' label is not a provider id; it is the one allowed line.
    expect(lone.filter(l => !l.includes('routeLocalTask'))).toEqual([])
  })
})
