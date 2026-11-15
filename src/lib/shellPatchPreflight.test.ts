// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGitApplyCheckCommand, encodePatchBase64, preflightShellPatch, SHELL_PATCH_PREFLIGHT_MAX_CHARS } from './shellPatchPreflight'

const PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n'

describe('buildGitApplyCheckCommand', () => {
  it('round-trips the patch through base64, including non-ASCII text', () => {
    const patch = `${PATCH}\n# café ✓\n`
    expect(Buffer.from(encodePatchBase64(patch), 'base64').toString('utf8')).toBe(patch)
  })

  it('runs the real git apply --check with the same flags as shell-repair.yml', () => {
    const command = buildGitApplyCheckCommand(PATCH)
    expect(command).toContain('git apply --check --whitespace=error')
    expect(command).toContain('base64 -d >')
  })

  it('really accepts a good patch and rejects a bad one when run in bash against a repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-'))
    const sh = (cmd: string) => execFileSync('bash', ['-o', 'pipefail', '-c', cmd], { cwd: dir, env: { ...process.env, RUNNER_TEMP: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    sh('git init -q && git config user.email t@t && git config user.name t')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    sh('git add a.txt && git commit -q -m init')
    expect(sh(buildGitApplyCheckCommand(PATCH))).toContain('applies cleanly')
    const bad = PATCH.replace('-one', '-nothing-like-the-file')
    expect(() => sh(buildGitApplyCheckCommand(bad))).toThrow()
    expect(() => sh(buildGitApplyCheckCommand('not a diff at all'))).toThrow()
  })
})

describe('preflightShellPatch', () => {
  it('is ok when the check run succeeds', async () => {
    const verdict = await preflightShellPatch(PATCH, async () => 'Shell execution succeeded.\ngit apply --check: the patch applies cleanly to main')
    expect(verdict).toEqual({ kind: 'ok' })
  })

  it('refuses with git\'s own message on a non-zero exit code', async () => {
    const verdict = await preflightShellPatch(PATCH, async () => '[TOOL ERROR] Shell execution failed.\nExit code: 1\nerror: patch failed: a.txt:1')
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') {
      expect(verdict.message).toContain('does not apply to main')
      expect(verdict.message).toContain('Nothing was dispatched')
      expect(verdict.message).toContain('patch failed: a.txt:1')
    }
  })

  it('fails closed when the check itself cannot complete (never guesses ok)', async () => {
    const verdict = await preflightShellPatch(PATCH, async () => '[TOOL ERROR] Shell execution timed out waiting after 300s')
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') expect(verdict.message).toContain('could not verify')
  })

  it('skips, and says so, for a patch too large for a workflow input', async () => {
    let ran = false
    const big = `${PATCH}${'x'.repeat(SHELL_PATCH_PREFLIGHT_MAX_CHARS)}`
    const verdict = await preflightShellPatch(big, async () => { ran = true; return '' })
    expect(ran).toBe(false)
    expect(verdict.kind).toBe('skipped')
    if (verdict.kind === 'skipped') expect(verdict.note).toContain('SKIPPED')
  })
})
