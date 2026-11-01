// @vitest-environment node
// verify-frozen.py is the guard behind "a frozen exam is never edited". These tests build throwaway git repos and try to break the
// freeze every way we know: edit, delete, add, retro-fit the manifest, forge the manifest and the file together, point at a commit
// that is not there. Each must be caught; the intact case must pass. The real repo's freeze is checked in CI by a workflow step.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'nexus-llm/eval/verify-frozen.py')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' }
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'frozen-'))
  dirs.push(root)
  git(root, 'init', '-q')
  const exam = join(root, 'nexus-llm/eval/x')
  mkdirSync(exam, { recursive: true })
  const files: Record<string, string> = {
    'nexus-llm/eval/x/fixtures.jsonl': '{"a":1}\n',
    'nexus-llm/eval/x/doc.md': '# frozen\n',
  }
  for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'freeze')
  const frozenAt = git(root, 'rev-parse', 'HEAD')
  const writeManifest = (over: Record<string, unknown> = {}, hashes: Record<string, string> = {}) => {
    const m = { exams: [{ name: 'x', dir: 'nexus-llm/eval/x/', frozen_at: frozenAt, allow_new: ['AMENDMENTS-*.md'],
      files: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, hashes[p] ?? sha(c)])), ...over }] }
    const text = JSON.stringify(m, null, 2) + '\n'
    writeFileSync(join(root, 'nexus-llm/eval/FROZEN.json'), text)
    return sha(text)
  }
  const pin = writeManifest()
  const run = (...args: string[]) => spawnSync('python3', ['-B', SCRIPT, '--root', root, ...args], { encoding: 'utf8' })
  return { root, files, frozenAt, pin, writeManifest, run, ci: (p = pin) => run('--manifest-sha256', p), origin: () => run('--origin') }
}

describe('verify-frozen.py', () => {
  it('passes an intact freeze in both modes', () => {
    const f = fixture()
    expect(f.ci().status, f.ci().stdout).toBe(0)
    expect(f.origin().status, f.origin().stdout).toBe(0)
  })

  it('needs a mode: no flags is a usage error, not a silent pass', () => {
    expect(fixture().run().status).toBe(2)
  })

  it('catches an edited frozen file', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'nexus-llm/eval/x/doc.md'), '# frozen, quietly changed\n')
    const r = f.ci()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('nexus-llm/eval/x/doc.md')
  })

  it('catches a deleted frozen file', () => {
    const f = fixture()
    rmSync(join(f.root, 'nexus-llm/eval/x/fixtures.jsonl'))
    const r = f.ci()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('missing')
  })

  it('catches an unlisted file in the frozen directory, and allows a new AMENDMENTS file there', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'nexus-llm/eval/x/AMENDMENTS-post-freeze.md'), 'new file, allowed\n')
    expect(f.ci().status).toBe(0)
    writeFileSync(join(f.root, 'nexus-llm/eval/x/extra-fixtures.jsonl'), 'smuggled\n')
    const r = f.ci()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('extra-fixtures.jsonl')
  })

  it('does not let an AMENDMENTS-named file hide in a subdirectory', () => {
    const f = fixture()
    mkdirSync(join(f.root, 'nexus-llm/eval/x/sub'))
    writeFileSync(join(f.root, 'nexus-llm/eval/x/sub/AMENDMENTS-x.md'), 'nested\n')
    expect(f.ci().status).toBe(1)
  })

  it('catches a retro-fitted manifest: the manifest changed, the pin did not', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'nexus-llm/eval/x/doc.md'), '# changed\n')
    f.writeManifest({}, { 'nexus-llm/eval/x/doc.md': sha('# changed\n') })
    const r = f.ci(f.pin)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('pinned')
  })

  it('catches the file and the manifest forged together even if the pin is also bumped, in grader mode', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'nexus-llm/eval/x/doc.md'), '# changed\n')
    const newPin = f.writeManifest({}, { 'nexus-llm/eval/x/doc.md': sha('# changed\n') })
    expect(f.ci(newPin).status).toBe(0) // CI alone is a tripwire: the pin edit is the visible protected-path diff
    const r = f.origin() // the grader goes to the object
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('at frozen_at')
  })

  it('refuses to grade when the frozen_at commit is unobtainable, rather than skipping', () => {
    const f = fixture()
    f.writeManifest({ frozen_at: 'f'.repeat(40) })
    const r = f.origin()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('not obtainable')
  })

  it('rejects a tag or short SHA as frozen_at', () => {
    const f = fixture()
    f.writeManifest({ frozen_at: 'reviewer-v1-frozen' })
    const r = f.origin()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('full 40-char')
  })
})

describe('the real repo freeze file', () => {
  it('parses and lists only full-SHA, hashed entries', () => {
    const m = JSON.parse(readFileSync('nexus-llm/eval/FROZEN.json', 'utf8')) as { exams: Array<{ frozen_at: string; files: Record<string, string> }> }
    for (const ex of m.exams) {
      expect(ex.frozen_at).toMatch(/^[0-9a-f]{40}$/)
      for (const h of Object.values(ex.files)) expect(h).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
