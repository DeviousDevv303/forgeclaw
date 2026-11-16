import { describe, expect, it } from 'vitest'
import type { ToolCall } from './forgeTools'
import { parseSculptCommand, runSculptCommand } from './sculptCommand'

const ORIGINAL = 'export const value = 1\n'
const UPDATED = '/** documented */\nexport const value = 1\n'
const read = `File: src/lib/value.ts (${ORIGINAL.length} bytes)\n\`\`\`\n${ORIGINAL}\n\`\`\``
const qwen = `✓ Qwen/Qwen3-8B completed as smoke on o/r@main.\nStages: x\nRun: smoke\n\n\`\`\`ts\n${UPDATED}\`\`\``

function runner(results: Record<string, string>) {
  const calls: ToolCall[] = []
  return { calls, run: async (call: ToolCall) => { calls.push(call); return results[call.name] ?? '[TOOL ERROR] missing smoke result' } }
}

describe('self-sculpt workflow smoke routing', () => {
  it('/patch reaches shell_patch through the guarded command runner', async () => {
    const r = runner({ shell_patch: '✓ Shell patch build-validated and proposed as pull request #1' })
    const command = parseSculptCommand('/patch add a value\n```diff\n--- a/src/lib/value.ts\n+++ b/src/lib/value.ts\n@@\n-export const value = 1\n+export const value = 2\n```')
    expect(command).toMatchObject({ kind: 'patch', reason: 'add a value' })
    if (!command || command.kind === 'usage') throw new Error('patch command did not parse')
    const result = await runSculptCommand(command, r.run, true)
    expect(result.ok).toBe(true)
    expect(r.calls.map(call => call.name)).toEqual(['shell_patch'])
  })

  it('/sculpt reaches read, Qwen rewrite, and sculpt_self', async () => {
    const r = runner({
      github_read_file: read,
      qwen_reason: qwen,
      sculpt_self: '✓ Self-sculpt build-validated and proposed as pull request #2',
    })
    const command = parseSculptCommand('/sculpt src/lib/value.ts add a documentation comment')
    expect(command).toMatchObject({ kind: 'sculpt', path: 'src/lib/value.ts' })
    if (!command || command.kind === 'usage') throw new Error('sculpt command did not parse')
    const result = await runSculptCommand(command, r.run, true)
    expect(result.ok).toBe(true)
    expect(r.calls.map(call => call.name)).toEqual(['github_read_file', 'qwen_reason', 'sculpt_self'])
    expect(r.calls[2].input).toMatchObject({ file_path: 'src/lib/value.ts', content: UPDATED })
  })
})
