// Guards the shared protected-path policy (.github/protected-paths.txt) and the workflow hardening
// that depends on it. Drift between workflows was the root cause of the Project D findings.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
      '.github/', '.gitattributes', 'package.json', 'package-lock.json', 'vite.config.*', 'vitest.config.*', 'eslint.config.*',
      'tsconfig*.json', 'scripts/', 'src/lib/guardianGate.ts', 'src/lib/forgeTools.ts',
      'src/core/autonomyEngine.ts', 'engine/', 'foundation/', 'tests/foundation/', 'LICENSE*',
    ]) expect(entries, required).toContain(required)
  })

  it('has no exact-path entry that points at a file which does not exist (the dead shellDispatch.ts case)', () => {
    const precautionary = new Set(['.gitattributes', '.npmrc', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'pnpm-workspace.yaml'])
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
    expect(() => execFileSync('python3', ['-B', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', CHECKER])).not.toThrow()
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

describe('symlink guard (.github/scripts/check-symlinks.sh)', () => {
  const GUARD = join(process.cwd(), '.github/scripts/check-symlinks.sh')

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'symlink-guard-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'x\n')
    git('add', 'a.txt')
    git('commit', '-qm', 'init')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    return { dir, git }
  }
  const run = (dir: string) => spawnSync('bash', [GUARD], { cwd: dir, encoding: 'utf8' })

  it('passes an ordinary new file', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'b.txt'), 'y\n')
    expect(run(dir).status).toBe(0)
  })

  it('refuses a new untracked symlink', () => {
    const { dir } = repo()
    symlinkSync('/etc/passwd', join(dir, 'lnk'))
    const result = run(dir)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('lnk')
  })

  it('refuses a tracked file replaced by a symlink', () => {
    const { dir } = repo()
    rmSync(join(dir, 'a.txt'))
    symlinkSync('/etc/passwd', join(dir, 'a.txt'))
    expect(run(dir).status).toBe(1)
  })

  it('refuses a symlink that git apply accepted (the shell-repair path)', () => {
    const { dir, git } = repo()
    const patch = [
      'diff --git a/lnk b/lnk', 'new file mode 120000', '--- /dev/null', '+++ b/lnk', '@@ -0,0 +1 @@',
      '+/etc/passwd', '\\ No newline at end of file', '',
    ].join('\n')
    writeFileSync(join(dir, 'p.diff'), patch)
    git('apply', 'p.diff')
    rmSync(join(dir, 'p.diff'))
    expect(run(dir).status).toBe(1)
  })

  it('is loaded from main alongside the other policy files, and used before and after the build', () => {
    const repair = read('.github/workflows/shell-repair.yml')
    expect(repair).toContain('git show origin/main:.github/scripts/check-symlinks.sh')
    expect(repair.match(/check-symlinks\.sh"/g)!.length).toBeGreaterThanOrEqual(2)
    expect(repair.match(/check-protected\.py" "\$RUNNER_TEMP\/protected-paths\.txt"/g)!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('shell-repair input handling', () => {
  it('never interpolates workflow inputs into a run: script', () => {
    const lines = read('.github/workflows/shell-repair.yml').split('\n')
    const offenders = lines.filter(line =>
      line.includes('${{ inputs.')
      && !/^\s*(run-name|group|name):/.test(line)
      && !/^\s+[A-Z_]+: \$\{\{ inputs\./.test(line))
    expect(offenders).toEqual([])
  })
})

describe('runner pinning', () => {
  // ubuntu-latest becomes Ubuntu 26 on 2026-10-19; an unpinned runner changes under every workflow.
  // generate-image.yml is pinned (and tested) in the image-adapter change. shell-exec.yml is a Tier 2
  // path that needs its own named authorization, so it is deliberately exempt here until then.
  const exempt = new Set(['generate-image.yml', 'shell-exec.yml'])
  const files = readdirSync('.github/workflows').filter(f => f.endsWith('.yml') && !exempt.has(f))

  it('has workflows to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  it('pins every other workflow to ubuntu-24.04', () => {
    for (const file of files) {
      const runners = read(`.github/workflows/${file}`).match(/^\s*runs-on:.*$/gm) ?? []
      expect(runners.length, file).toBeGreaterThan(0)
      // deepseek-16b.yml may opt into a GPU larger runner via a repository variable; its default stays pinned.
      const allowed = file === 'deepseek-16b.yml'
        ? ['runs-on: ubuntu-24.04', "runs-on: ${{ vars.FORGECLAW_GPU_RUNNER || 'ubuntu-24.04' }}"]
        : ['runs-on: ubuntu-24.04']
      for (const line of runners) expect(allowed, file).toContain(line.trim())
    }
  })
})

describe('shell-repair pull request body', () => {
  // The body heredoc is unquoted (it must expand $INVOCATION_ID etc.). It used to contain \\`main\\`:
  // bash turned that into a command substitution, logged "main\: command not found" and rendered
  // "pull request to \;" (seen in run 38426819317). Render the real step text through bash.
  it('renders without errors and names main as the landing branch', () => {
    const workflow = read('.github/workflows/shell-repair.yml')
    const start = workflow.indexOf('            body=$(cat <<EOF')
    const end = workflow.indexOf('          )\n', start) + '          )\n'.length
    expect(start).toBeGreaterThan(0)
    const block = workflow.slice(start, end).split('\n')
      .map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n')
      .replace(/\$\{\{[^}]*\}\}/g, '0')
    const script = 'set -euo pipefail\nINVOCATION_ID=repair-test GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=1\n'
      + `${block}\nprintf '%s\\n' "$body"\n`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('- Invocation ID: repair-test')
    expect(result.stdout).toContain('- Landing path: pull request to main; this workflow never merges.')
  })
})
