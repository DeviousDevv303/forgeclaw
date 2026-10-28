// Run a frozen-suite build script against the PINNED app, whatever the working tree's src/ now holds.
//   npx vite-node nexus-llm/eval/rebuild-pinned.ts <build-domains.ts|build-eval.ts> [--check]
// A suite's labels and tool results come from the app at its pinned SHA. Once src/ moves on (any merge), rebuilding from the
// working tree would either refuse (build-domains checks) or silently relabel. This makes a temporary git worktree at the
// pinned SHA, copies the current nexus-llm/ into it (the pinned commit predates it), links node_modules, runs the build there,
// and, when writing, copies the suite files back. The worktree is always removed.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const PINNED = '1ee0026b68dbb4f292f36e5c06873db593d3b664'
const [script, ...rest] = process.argv.slice(2)
if (!script || !['build-domains.ts', 'build-eval.ts'].includes(script)) { console.error('usage: rebuild-pinned.ts <build-domains.ts|build-eval.ts> [--check]'); process.exit(2) }

const tmp = mkdtempSync(join(tmpdir(), 'nexus-pinned-'))
const wt = join(tmp, 'wt')
let code = 0
try {
  // A shallow clone (CI's actions/checkout uses depth 1) lacks the pinned commit: fetch exactly that commit. If it cannot be
  // fetched, the worktree step below fails and the check fails, loudly; it never falls back to the working tree's src/.
  try { execFileSync('git', ['cat-file', '-e', `${PINNED}^{commit}`], { cwd: repo, stdio: 'pipe' }) }
  catch { execFileSync('git', ['fetch', '--quiet', '--depth=1', 'origin', PINNED], { cwd: repo, stdio: 'pipe' }) }
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', wt, PINNED], { cwd: repo, stdio: 'pipe' })
  cpSync(join(repo, 'nexus-llm'), join(wt, 'nexus-llm'), { recursive: true })
  symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'), 'dir')
  try {
    process.stdout.write(execFileSync('npx', ['vite-node', join('nexus-llm/eval', script), ...rest], { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
  } catch (e) { code = (e as { status?: number }).status ?? 1; process.stdout.write(String((e as { stdout?: string }).stdout ?? '')) }
  if (code === 0 && !rest.includes('--check')) {
    for (const d of readdirSync(join(wt, 'nexus-llm/eval'), { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(wt, 'nexus-llm/eval', d.name, 'MANIFEST.json'))) cpSync(join(wt, 'nexus-llm/eval', d.name), join(here, d.name), { recursive: true })
    }
  }
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'pipe' }) } catch { /* removed below */ }
  rmSync(tmp, { recursive: true, force: true })
  try { execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'pipe' }) } catch { /* best effort */ }
}
process.exit(code)
