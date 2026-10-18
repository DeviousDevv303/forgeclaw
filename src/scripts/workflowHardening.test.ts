// Guards the shared protected-path policy (.github/protected-paths.txt) and the workflow hardening
// that depends on it. Drift between workflows was the root cause of the Project D findings.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const LIST = '.github/protected-paths.txt'
const CHECKER = '.github/scripts/check-protected.py'

const entries = read(LIST)
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))

function check(...paths: string[]) {
  const result = spawnSync('python3', [CHECKER, LIST], { input: paths.map(p => `${p}\0`).join(''), encoding: 'utf8' })
  return { code: result.status, out: result.stdout }
}

describe('protected-paths policy', () => {
  it('protects every build-time executable config and control-plane path', () => {
    for (const required of [
      '.github/', 'package.json', 'package-lock.json', 'vite.config.*', 'vitest.config.*', 'eslint.config.*',
      'tsconfig*.json', 'scripts/', 'src/lib/guardianGate.ts', 'src/lib/forgeTools.ts',
      'src/core/autonomyEngine.ts', 'engine/', 'foundation/', 'tests/foundation/', 'LICENSE*',
    ]) expect(entries, required).toContain(required)
  })

  it('has no exact-path entry that points at a file which does not exist (the dead shellDispatch.ts case)', () => {
    const precautionary = new Set(['.npmrc', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'pnpm-workspace.yaml'])
    const exact = entries.filter(e => !e.includes('*') && !e.endsWith('/') && !precautionary.has(e))
    const dead = exact.filter(e => !existsSync(e))
    expect(dead).toEqual([])
    for (const dir of entries.filter(e => e.endsWith('/'))) expect(existsSync(dir), dir).toBe(true)
  })

  it('refuses protected paths, including nested, differently-cased and renamed-away ones', () => {
    for (const path of ['vite.config.ts', 'tsconfig.app.json', 'eslint.config.js', 'nexus/package.json',
      'Package.JSON', '.github/workflows/x.yml', 'scripts/a.mjs', 'src/lib/forgeTools.ts', './src/../vite.config.ts', '../x']) {
      expect(check(path).code, path).toBe(1)
    }
  })

  it('allows ordinary source files and near-miss names', () => {
    expect(check('src/App.tsx', 'src/lib/forgeToolsX.ts', 'src/lib/learningEvents.ts').code).toBe(0)
  })

  it('fails if ANY path in a batch is protected (both sides of a rename are listed by the workflows)', () => {
    expect(check('src/App.tsx', 'src/lib/guardianGate.ts').code).toBe(1)
  })

  it('refuses an empty policy file rather than allowing everything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'protected-'))
    const empty = join(dir, 'empty.txt')
    writeFileSync(empty, '# nothing\n')
    const result = spawnSync('python3', [CHECKER, empty], { input: 'src/App.tsx\0', encoding: 'utf8' })
    expect(result.status).not.toBe(0)
  })

  it('checker script compiles', () => {
    expect(() => execFileSync('python3', ['-m', 'py_compile', CHECKER])).not.toThrow()
  })
})

describe('workflow hardening', () => {
  const sculpt = read('.github/workflows/self-sculpt.yml')
  const repair = read('.github/workflows/shell-repair.yml')
  const claude = read('.github/workflows/claude.yml')
  const exec = read('.github/workflows/shell-exec.yml')

  it('uses the shared checker everywhere and keeps no private copy of the list', () => {
    for (const [name, text] of [['self-sculpt', sculpt], ['shell-repair', repair], ['claude', claude]] as const) {
      expect(text, name).toContain('check-protected.py')
      expect(text, name).toContain('git show origin/main:.github/protected-paths.txt')
      expect(text, name).not.toMatch(/guardianGate\.ts['"$\\]/)
    }
  })

  it('does not leave a write-capable credential on disk in the jobs that build proposed code', () => {
    expect(sculpt).toContain('persist-credentials: false')
    expect(repair).toContain('persist-credentials: false')
    expect(exec).toContain('persist-credentials: false')
  })

  it('pushes explicitly authenticated instead of relying on a stored credential', () => {
    expect(sculpt).toContain('http.https://github.com/.extraheader')
    expect(repair).toContain('http.https://github.com/.extraheader')
  })

  it('lists both sides of renames in every path check', () => {
    expect(repair).toContain('git diff --no-renames --name-only -z origin/main')
    expect(claude).toContain('git diff --no-renames --name-only -z origin/main...FETCH_HEAD')
  })

  it('limits who and what can trigger the comment-driven claude job', () => {
    expect(claude).toContain('author_association')
    expect(claude).toContain('--disallowedTools "Bash,WebFetch,WebSearch"')
  })
})
