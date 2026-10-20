import { describe, expect, it } from 'vitest'
import { isResearchRequest, sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

const tools = ['deepseek_reason', 'deep_research', 'github_repo_state'].map(name => ({ name, description: name, parameters: {} }))
const ask = (content: string, extra: AIRequest['messages'] = []): AIRequest => ({ model: 'deepseek-16b', systemPrompt: '', messages: [{ role: 'user', content }, ...extra], tools })

describe('DeepSeek deep research route', () => {
  it('gathers sources before DeepSeek reasons, even when the question mentions GitHub', async () => {
    const result = await sendViaRouter(ask('Research how GitHub Pages compares to Netlify for static sites'), '', 'deepseek')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-deep-research' } })
    if (result.success) expect(result.response.toolCalls?.[0]).toMatchObject({ name: 'deep_research', input: { question: 'Research how GitHub Pages compares to Netlify for static sites', max_sources: 6 } })
  })

  it('then hands DeepSeek the numbered evidence', async () => {
    const evidence = '✓ Deep research: 2 source(s) for "x"\nWrite the answer only from these sources and cite them as [n].\n[1] A\nhttps://a.example\nfacts'
    const result = await sendViaRouter(ask('Research x', [
      { role: 'assistant', content: '', tool_calls: [{ id: 'r1', name: 'deep_research', input: {} }] },
      { role: 'tool', content: evidence, tool_call_id: 'r1' },
    ]), '', 'deepseek')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-deepseek-reasoning' } })
    if (result.success) expect(String(result.response.toolCalls?.[0]?.input.context)).toContain('cite them as [n]')
  })

  it('fails honestly instead of letting DeepSeek answer a research question from memory', async () => {
    const result = await sendViaRouter(ask('Research x', [
      { role: 'assistant', content: '', tool_calls: [{ id: 'r1', name: 'deep_research', input: {} }] },
      { role: 'tool', content: '[TOOL ERROR] deep_research found no readable sources for "x". Nothing can be cited.', tool_call_id: 'r1' },
    ]), '', 'deepseek')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toMatch(/gathered no usable sources, so DeepSeek was not asked to answer from memory/)
  })

  it('does not treat ordinary questions as research', () => {
    expect(isResearchRequest('fix the failing test')).toBe(false)
    expect(isResearchRequest('what does the evidence say about intermittent fasting')).toBe(true)
    expect(isResearchRequest('compare the best static hosts')).toBe(true)
  })
})
