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
    expect(result.stdout).toContain('**ForgeClaw** · autonomous agent')
    expect(result.stdout).toContain('https://github.com/o/r/raw/main/docs/brand/forgeclaw-avatar.png')
  })
})

describe('workflow expression syntax', () => {
  // 2026-10-20: a comment inside search-proxy.yml's run: block said "never through ${{ }}". GitHub
  // evaluates expressions even in comments, so the empty expression made the workflow unparseable and
  // every dispatch failed with HTTP 422 "An expression was expected". File-reading tests never saw it.
  const workflows = readdirSync('.github/workflows').filter(f => f.endsWith('.yml'))
  it('has no empty ${{ }} expression and no expression inside a comment', () => {
    for (const file of workflows) {
      const lines = read(`.github/workflows/${file}`).split('\n')
      lines.forEach((line, i) => {
        expect(/\$\{\{\s*\}\}/.test(line), `${file}:${i + 1} empty expression`).toBe(false)
        expect(/^\s*#.*\$\{\{/.test(line), `${file}:${i + 1} expression inside a comment`).toBe(false)
      })
    }
  })
})

describe('shell-repair publishes edits to existing files', () => {
  // 2026-10-21: a patch that only edited a tracked file (src/App.tsx) was applied and verified, then reported
  // "No repair changes to publish" because the check compared committed history with main (empty: the patch is
  // uncommitted), so no branch was pushed and the PR step failed. New files worked, which hid the bug.
  const workflow = read('.github/workflows/shell-repair.yml')
  const start = workflow.indexOf('          if git diff --quiet')
  const block = workflow.slice(start, workflow.indexOf('          git add --all', start)).replace(/^ {10}/gm, '').replace('exit 0', 'echo SKIPPED')
  const run = (edit: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'repair-'))
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
      git('init', '-q', '-b', 'main'); writeFileSync(join(dir, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '-qm', 'base')
      git('update-ref', 'refs/remotes/origin/main', 'HEAD'); git('switch', '-qc', 'repair')
      edit(dir)
      return spawnSync('bash', ['-c', `cd ${dir} && ${block}\necho DONE`], { encoding: 'utf8' }).stdout
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  it('does not skip a patch that edits an existing file', () => {
    expect(run(dir => writeFileSync(join(dir, 'a.txt'), 'two\n'))).not.toContain('SKIPPED')
  })
  it('does not skip a patch that adds a new file', () => {
    expect(run(dir => writeFileSync(join(dir, 'b.txt'), 'new\n'))).not.toContain('SKIPPED')
  })
  it('still skips when nothing changed', () => {
    expect(run(() => {})).toContain('SKIPPED')
  })
})

describe('ForgeClaw acts under its own name', () => {
  // 2026-10-21 (owner): ForgeClaw should have an image and a title as the autonomous agent when it acts on GitHub.
  // The GitHub App is optional: until FORGECLAW_APP_ID and its key exist, the default token and identity are used.
  for (const file of ['shell-repair', 'self-sculpt']) {
    const text = read(`.github/workflows/${file}.yml`)
    it(`${file}: signs in as the app only when it is configured, and falls back to the default token`, () => {
      expect(text).toContain('uses: actions/create-github-app-token@v1')
      expect(text).toMatch(/id: app\n\s+if: vars\.FORGECLAW_APP_ID != ''\n\s+continue-on-error: true/)
      expect(text.match(/GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \|\| github\.token \}\}/g)?.length).toBe(2)
      expect(text).not.toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/)
    })
    it(`${file}: commits as the app and titles its pull request with the agent's name`, () => {
      expect(text).toContain('git config user.name "${APP_SLUG}[bot]"')
      expect(text).toContain('git config user.email "${APP_ID}+${APP_SLUG}[bot]@users.noreply.github.com"')
      expect(text).toContain(`--title "[ForgeClaw] ${file === 'shell-repair' ? 'repair' : 'sculpt'}: `)
    })
  }
  it('self-sculpt: the pull request body carries the name and the avatar', () => {
    const text = read('.github/workflows/self-sculpt.yml')
    const start = text.indexOf("python - <<'PY'\n", text.indexOf('Open pull request for review'))
    const code = text.slice(start + "python - <<'PY'\n".length, text.indexOf('          PY\n', start)).replace(/^ {10}/gm, '')
    const out = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, SCULPT_REASON: 'tidy', APP_SERVER: 'https://github.com', APP_REPO: 'o/r' } })
    expect(out.status, out.stderr).toBe(0)
    const body = readFileSync('/tmp/self-sculpt-pr-body.md', 'utf8')
    expect(body).toContain('**ForgeClaw** · autonomous agent · self-sculpt proposal')
    expect(body).toContain('https://github.com/o/r/raw/main/docs/brand/forgeclaw-avatar.png')
    expect(body).toContain('Reason: tidy')
  })
  it('ships the avatar the pull requests point at', () => {
    expect(existsSync('docs/brand/forgeclaw-avatar.png')).toBe(true)
    expect(existsSync('docs/brand/forgeclaw-emblem.svg')).toBe(true)
  })
})
