// @vitest-environment node
// The Pages deploy runs scripts/patchGithubReadUi.mjs against src/App.tsx before
// building, and that script fails closed when an anchor moves. #106 changed an
// anchored label, so deploys for #106 and #107 failed while the Build Gate stayed
// green. This test runs the real script on a copy of the real App.tsx so anchor
// drift fails here, on the PR, instead of silently blocking the deploy.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'pages-patch-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

function runPatch(): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['scripts/patchGithubReadUi.mjs'], { cwd: work, encoding: 'utf8' })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('GitHub Pages read-only UI patch', () => {
  // Every test starts from a fresh, unpatched copy. The idempotency test used to rely on the test before it having patched a
  // shared copy, so it failed whenever the order changed (found by running the suite shuffled, 2026-10-21).
  beforeEach(() => {
    mkdirSync(join(work, 'src'), { recursive: true })
    mkdirSync(join(work, 'scripts'), { recursive: true })
    copyFileSync(join(repo, 'src', 'App.tsx'), join(work, 'src', 'App.tsx'))
    copyFileSync(join(repo, 'scripts', 'patchGithubReadUi.mjs'), join(work, 'scripts', 'patchGithubReadUi.mjs'))
  })

  it('applies cleanly to the current App.tsx (every anchor still matches)', () => {
    const { code, out } = runPatch()
    expect(out).not.toMatch(/FAIL/)
    expect(code).toBe(0)
    const patched = readFileSync(join(work, 'src', 'App.tsx'), 'utf8')
    expect(patched.match(/TEST GITHUB READ \(read-only\)/g)).toHaveLength(1)
    expect(patched.match(/const testGithubRead = async/g)).toHaveLength(1)
  })

  it('is idempotent on a second run', () => {
    expect(runPatch().code).toBe(0) // the first run applies it
    const { code, out } = runPatch()
    expect(code).toBe(0)
    expect(out).toMatch(/already present/)
    expect(readFileSync(join(work, 'src', 'App.tsx'), 'utf8').match(/TEST GITHUB READ \(read-only\)/g)).toHaveLength(1)
  })
})
