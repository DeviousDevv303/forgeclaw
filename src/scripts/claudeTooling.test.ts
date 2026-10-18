// @vitest-environment node
// Pins the local Claude Code guard: it must defer to .github/protected-paths.txt (not a private list),
// deny credentials and .env writes, and fail closed when the policy cannot be loaded.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..')
const GUARD = join(ROOT, '.claude/hooks/protected-path-guard.py')

function guard(toolInput: Record<string, unknown>, projectDir = ROOT) {
  const r = spawnSync('python3', ['-B', GUARD], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PYTHONDONTWRITEBYTECODE: '1' },
  })
  expect(r.status, r.stderr).toBe(0)
  const out = r.stdout.trim()
  return out ? (JSON.parse(out).hookSpecificOutput as { permissionDecision: string; permissionDecisionReason: string }) : null
}

describe('protected-path-guard', () => {
  it('asks before touching a protected path from .github/protected-paths.txt', () => {
    for (const file_path of ['.github/workflows/generate-image.yml', 'package.json', 'src/lib/guardianGate.ts', 'tests/foundation/x.test.ts']) {
      expect(guard({ file_path, new_string: 'x' })?.permissionDecision, file_path).toBe('ask')
    }
  })

  it('asks for an absolute path inside the repo too', () => {
    expect(guard({ file_path: join(ROOT, 'package.json'), new_string: 'x' })?.permissionDecision).toBe('ask')
  })

  it('allows an ordinary source file silently', () => {
    expect(guard({ file_path: 'src/lib/i18n.ts', new_string: 'const a = 1' })).toBeNull()
  })

  it('denies writing .env files', () => {
    expect(guard({ file_path: '.env', content: 'A=1' })?.permissionDecision).toBe('deny')
    expect(guard({ file_path: 'config/.env.local', content: 'A=1' })?.permissionDecision).toBe('deny')
  })

  it('denies content that looks like a credential, even in an unprotected file', () => {
    const token = 'gh' + 'p_' + 'a'.repeat(36)
    expect(guard({ file_path: 'src/lib/x.ts', content: `const t = '${token}'` })?.permissionDecision).toBe('deny')
    expect(guard({ file_path: 'src/lib/x.ts', edits: [{ new_string: `k='${token}'` }] })?.permissionDecision).toBe('deny')
  })

  it('fails closed (asks) when the policy list cannot be loaded', () => {
    const empty = mkdtempSync(join(tmpdir(), 'guard-'))
    expect(guard({ file_path: 'src/ok.ts', new_string: 'x' }, empty)?.permissionDecision).toBe('ask')
  })

  it('keeps no private path list: no protected path literals in the hook source', () => {
    const src = readFileSync(GUARD, 'utf8')
    expect(src).not.toContain('guardianGate')
    expect(src).not.toContain('package-lock')
    expect(src).toContain('.github/protected-paths.txt')
  })
})

describe('claude settings', () => {
  it('registers the guard as a PreToolUse hook for Edit, Write and MultiEdit', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'))
    const entry = settings.hooks.PreToolUse[0]
    expect(entry.matcher).toBe('Edit|Write|MultiEdit')
    expect(entry.hooks[0].command).toContain('protected-path-guard.py')
  })

  it('keeps the verify skill user-only and the reviewer read-only', () => {
    expect(readFileSync(join(ROOT, '.claude/skills/forgeclaw-verify/SKILL.md'), 'utf8')).toContain('disable-model-invocation: true')
    const agent = readFileSync(join(ROOT, '.claude/agents/guardian-reviewer.md'), 'utf8')
    expect(agent).toMatch(/^tools: Read, Grep, Glob, Bash$/m)
    expect(agent).not.toMatch(/\b(Edit|Write)\b.*\n---/)
  })
})
