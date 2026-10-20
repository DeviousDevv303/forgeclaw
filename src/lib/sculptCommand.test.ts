import { describe, expect, it } from 'vitest'
import { parseSculptCommand, runSculptCommand } from './sculptCommand'
import type { ToolCall } from './forgeTools'

const ORIGINAL = "export const a = 1\n"
const UPDATED = "/** The answer. */\nexport const a = 1\n"
const read = `File: src/a.ts (${ORIGINAL.length} bytes)\n\`\`\`\n${ORIGINAL}\n\`\`\``

describe('parseSculptCommand', () => {
  it('parses /sculpt and /patch, and explains bad usage', () => {
    expect(parseSculptCommand('/sculpt src/a.ts add a doc comment')).toEqual({ kind: 'sculpt', path: 'src/a.ts', instruction: 'add a doc comment' })
    expect(parseSculptCommand('/patch fix typo\ndiff --git a/x b/x\n')).toEqual({ kind: 'patch', reason: 'fix typo', patch: 'diff --git a/x b/x\n' })
    expect(parseSculptCommand('/sculpt')).toMatchObject({ kind: 'usage' })
    expect(parseSculptCommand('/patch')).toMatchObject({ kind: 'usage' })
    expect(parseSculptCommand('please sculpt src/a.ts')).toBeNull()
  })
})

describe('runSculptCommand', () => {
  function runner(results: Record<string, string>) {
    const calls: ToolCall[] = []
    return { calls, run: async (call: ToolCall) => { calls.push(call); return results[call.name] } }
  }

  it('reads, rewrites with the workflow model (code profile), proposes, and returns the PR result', async () => {
    const r = runner({
      github_read_file: read,
      deepseek_reason: `✓ DeepSeek-16B completed as d-1 on o/r@main.\nStages: x\nRun: u\n\n\`\`\`ts\n${UPDATED}\`\`\``,
      sculpt_self: '✓ Self-sculpt of src/a.ts: build-validated and proposed as pull request #12',
    })
    const out = await runSculptCommand({ kind: 'sculpt', path: 'src/a.ts', instruction: 'add a doc comment' }, r.run, true)
    expect(out).toMatchObject({ ok: true, text: expect.stringContaining('pull request #12') })
    expect(r.calls.map(c => c.name)).toEqual(['github_read_file', 'deepseek_reason', 'sculpt_self'])
    expect(r.calls[1].input).toMatchObject({ profile: 'code' })
    expect(r.calls[2].input).toMatchObject({ file_path: 'src/a.ts', content: UPDATED })
  })

  it('does nothing at all while locked', async () => {
    const r = runner({})
    const out = await runSculptCommand({ kind: 'sculpt', path: 'src/a.ts', instruction: 'x' }, r.run, false)
    expect(out.ok).toBe(false)
    expect(out.text).toMatch(/Self-sculpt is locked/)
    expect(r.calls).toEqual([])
  })

  it('stops before proposing when the rewrite is unusable', async () => {
    const r = runner({ github_read_file: read, deepseek_reason: '✓ DeepSeek-16B completed as d-1 on o/r@main.\nStages: x\nRun: u\n\nI cannot do that.' })
    const out = await runSculptCommand({ kind: 'sculpt', path: 'src/a.ts', instruction: 'x' }, r.run, true)
    expect(out.ok).toBe(false)
    expect(r.calls.map(c => c.name)).toEqual(['github_read_file', 'deepseek_reason'])
  })

  it('sends /patch straight to shell_patch with no model', async () => {
    const r = runner({ shell_patch: '✓ Shell-patch repair-1: build-validated and proposed as pull request #13' })
    const out = await runSculptCommand({ kind: 'patch', reason: 'fix typo', patch: 'diff --git a/x b/x\n' }, r.run, true)
    expect(out.ok).toBe(true)
    expect(r.calls).toEqual([expect.objectContaining({ name: 'shell_patch', input: { patch: 'diff --git a/x b/x\n', reason: 'fix typo' } })])
  })
})
