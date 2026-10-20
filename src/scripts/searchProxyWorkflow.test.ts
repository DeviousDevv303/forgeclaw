// @vitest-environment node
// search-proxy.yml as first proposed interpolated the query into Python source ('''$QUERY'''), so a query
// containing ''' ran arbitrary code next to GH_TOKEN; its error path also built JSON by string concatenation.
// These tests run the real step script against a fake gh and pin the fixes.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const wf = readFileSync('.github/workflows/search-proxy.yml', 'utf8')

function stepScript() {
  const start = wf.indexOf('        run: |\n') + '        run: |\n'.length
  const end = wf.indexOf('      - name: Upload result')
  return wf.slice(start, end).split('\n').map(line => line.slice(10)).join('\n')
}

// Fake gh: records its argv, then replays $FAKE_GH_STDOUT/$FAKE_GH_STDERR and exits $FAKE_GH_EXIT.
function run(query: string, invocationId: string, gh: { stdout?: string, stderr?: string, exit?: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'search-proxy-'))
  writeFileSync(join(dir, 'gh'), [
    '#!/usr/bin/env bash',
    'printf "%s\\0" "$@" > "$PWD/gh-argv"',
    'printf "%s" "$FAKE_GH_STDOUT"',
    'printf "%s" "$FAKE_GH_STDERR" >&2',
    'exit "$FAKE_GH_EXIT"',
  ].join('\n'))
  chmodSync(join(dir, 'gh'), 0o755)
  const r = spawnSync('bash', ['-e', '-c', stepScript()], {
    cwd: dir, encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`, QUERY: query, INVOCATION_ID: invocationId, GH_TOKEN: 'fake',
      FAKE_GH_STDOUT: gh.stdout ?? '', FAKE_GH_STDERR: gh.stderr ?? '', FAKE_GH_EXIT: String(gh.exit ?? 0),
    },
  })
  const result = join(dir, 'result.json')
  const argv = join(dir, 'gh-argv')
  return {
    dir, code: r.status, out: r.stdout + r.stderr,
    result: existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : undefined,
    argv: existsSync(argv) ? readFileSync(argv, 'utf8').split('\0').filter(Boolean) : [],
  }
}

const hit = { total_count: 1, incomplete_results: false, items: [{ path: 'src/a.ts', html_url: 'https://x/a', repository: { full_name: 'o/r' } }] }

describe('search-proxy.yml', () => {
  it('never interpolates workflow inputs into a run: script', () => {
    const offenders = wf.split('\n').filter(line =>
      line.includes('${{ inputs.') && !/^\s*(run-name|name):/.test(line) && !/^\s+[A-Z_]+: \$\{\{ inputs\./.test(line))
    expect(offenders).toEqual([])
  })

  it('carries the correlation ID in run-name and uploads the result even on failure', () => {
    expect(wf).toContain('run-name: Code search ${{ inputs.invocation_id }}')
    expect(wf).toContain('name: search-${{ inputs.invocation_id }}')
    expect(wf).toContain('if: always()')
  })

  it('returns the search result with the correlation ID attached', () => {
    const r = run('useState repo:o/r', 'inv-1', { stdout: JSON.stringify(hit) })
    expect(r.code, r.out).toBe(0)
    expect(r.result).toEqual({
      invocation_id: 'inv-1', query: 'useState repo:o/r', total_count: 1, incomplete_results: false,
      items: [{ path: 'src/a.ts', repository: 'o/r', url: 'https://x/a' }],
    })
    expect(r.argv).toEqual(['api', '-X', 'GET', 'search/code', '-f', 'q=useState repo:o/r', '-F', 'per_page=10'])
  })

  it('passes a hostile query through as data, not code', () => {
    const query = `''' + __import__('os').system('touch pwned') + '''$(touch pwned2)"`
    const r = run(query, 'inv-2', { stdout: JSON.stringify(hit) })
    expect(r.code, r.out).toBe(0)
    expect(r.result.query).toBe(query)
    expect(r.argv[5]).toBe(`q=${query}`)
    expect(existsSync(join(r.dir, 'pwned'))).toBe(false)
    expect(existsSync(join(r.dir, 'pwned2'))).toBe(false)
  })

  it('writes valid error JSON and fails the run when gh fails', () => {
    const r = run('x', 'inv-3', { stderr: 'gh: Validation Failed (HTTP 422)\n"quoted" detail', exit: 1 })
    expect(r.code).toBe(1)
    expect(r.result).toEqual({ invocation_id: 'inv-3', query: 'x', error: 'gh: Validation Failed (HTTP 422)\n"quoted" detail' })
    expect(r.out).toContain('::error title=search-proxy::')
  })

  it('refuses an invocation_id that is unsafe for an artifact name, before calling gh', () => {
    for (const id of ['', 'a/b', 'a b', 'a:b', 'x'.repeat(121)]) {
      const r = run('x', id, { stdout: JSON.stringify(hit) })
      expect(r.code, id).toBe(1)
      expect(r.argv, id).toEqual([])
    }
  })
})
