import { describe, expect, it } from 'vitest'
import { extractRewrittenFile, readFileBody, sculptTarget } from './deepseekSculpt'
import { sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

const ORIGINAL = "export function elapsed(ms: number): string {\n  return `${Math.round(ms / 1000)}s`\n}\n"
const UPDATED = "export function elapsed(ms: number): string {\n  if (ms < 1000) return `${ms}ms`\n  return `${Math.round(ms / 1000)}s`\n}\n"
const readResult = (body: string, truncated = false) => `File: src/lib/elapsed.ts (${body.length} bytes)\n\`\`\`\n${body}${truncated ? '\n[truncated]' : ''}\n\`\`\``
const deepseekOk = (text: string) => `✓ DeepSeek-16B completed as deepseek-1 on o/r@main.\nStages: x\nRun: https://run\n\n${text}`

describe('sculpt helpers', () => {
  it('needs both self-sculpt intent and a repository file path', () => {
    expect(sculptTarget('sculpt src/lib/elapsed.ts so it shows milliseconds under one second')).toBe('src/lib/elapsed.ts')
    expect(sculptTarget('improve yourself: tidy `src/lib/i18n.ts`')).toBe('src/lib/i18n.ts')
    expect(sculptTarget('what does src/lib/elapsed.ts do?')).toBeNull()
    expect(sculptTarget('sculpt yourself')).toBeNull()
  })
  it('reads the file body and refuses a truncated read', () => {
    expect(readFileBody(readResult(ORIGINAL))).toEqual({ content: ORIGINAL })
    expect(readFileBody(readResult(ORIGINAL, true))).toMatchObject({ error: expect.stringContaining('too large for DeepSeek') })
  })
  it('accepts a complete rewrite and refuses unchanged, shrunken or placeholder output', () => {
    expect(extractRewrittenFile('```ts\n' + UPDATED + '```', ORIGINAL)).toEqual({ content: UPDATED })
    expect(extractRewrittenFile('```ts\n' + ORIGINAL + '```', ORIGINAL)).toMatchObject({ error: expect.stringContaining('unchanged') })
    expect(extractRewrittenFile('```ts\nx\n```', ORIGINAL)).toMatchObject({ error: expect.stringContaining('incomplete rewrite') })
    expect(extractRewrittenFile('```ts\n' + UPDATED + '// rest of the file unchanged\n```', ORIGINAL)).toMatchObject({ error: expect.stringContaining('placeholder') })
    expect(extractRewrittenFile('no code here', ORIGINAL)).toMatchObject({ error: expect.stringContaining('code block') })
  })
})

describe('DeepSeek self-sculpt chain in the router', () => {
  const tools = ['deepseek_reason', 'github_read_file', 'sculpt_self'].map(name => ({ name, description: name, parameters: {} }))
  const prompt = 'Sculpt src/lib/elapsed.ts so it shows milliseconds under one second'
  const turn = (results: Array<[string, string]>): AIRequest => ({
    model: 'deepseek-16b', systemPrompt: '', tools,
    messages: [{ role: 'user', content: prompt }, ...results.flatMap(([name, content], i) => [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: `c${i}`, name, input: {} }] },
      { role: 'tool' as const, content, tool_call_id: `c${i}` },
    ])],
  })
  const step = async (results: Array<[string, string]>) => {
    const r = await sendViaRouter(turn(results), '', 'deepseek')
    if (!r.success) throw new Error(r.error.message)
    return r.response
  }

  it('reads, rewrites with the code profile, proposes, then reports the PR', async () => {
    expect((await step([])).toolCalls?.[0]).toMatchObject({ name: 'github_read_file', input: { path: 'src/lib/elapsed.ts' } })
    const rewrite = await step([['github_read_file', readResult(ORIGINAL)]])
    expect(rewrite.toolCalls?.[0]).toMatchObject({ name: 'deepseek_reason', input: { profile: 'code' } })
    expect(String(rewrite.toolCalls?.[0]?.input.task)).toContain(ORIGINAL)
    const propose = await step([['github_read_file', readResult(ORIGINAL)], ['deepseek_reason', deepseekOk('```ts\n' + UPDATED + '```')]])
    expect(propose.toolCalls?.[0]).toMatchObject({ name: 'sculpt_self', input: { file_path: 'src/lib/elapsed.ts', content: UPDATED } })
    expect(propose.stopReason).toBe('deterministic-sculpt-propose')
    const done = await step([
      ['github_read_file', readResult(ORIGINAL)], ['deepseek_reason', deepseekOk('```ts\n' + UPDATED + '```')],
      ['sculpt_self', '✓ Self-sculpt of src/lib/elapsed.ts: build-validated and proposed as pull request #9 on sculpt/x (not merged; review it).\n  pr: https://github.com/o/r/pull/9'],
    ])
    expect(done.stopReason).toBe('deepseek-sculpt-complete')
    expect(done.text).toContain('pull request #9')
  })

  it('stops before any change for a file too large to rewrite whole', async () => {
    const r = await sendViaRouter(turn([['github_read_file', readResult(ORIGINAL, true)]]), '', 'deepseek')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.message).toMatch(/stopped before any change: the file is larger than 8,000 characters/)
  })

  it('reports a rejected proposal instead of claiming success', async () => {
    const r = await sendViaRouter(turn([
      ['github_read_file', readResult(ORIGINAL)], ['deepseek_reason', deepseekOk('```ts\n' + UPDATED + '```')],
      ['sculpt_self', '[TOOL ERROR] Self-sculpt of src/lib/elapsed.ts run #3 concluded "failure": nothing was proposed'],
    ]), '', 'deepseek')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.message).toMatch(/did not go through.*concluded "failure"/)
  })
})
