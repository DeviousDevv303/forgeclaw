// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatGrepMatches, gitGrepCommand, parseGrepOutput } from './codeSearch'
import { executeTool, loadToolContext } from './forgeTools'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('gitGrepCommand', () => {
  it('builds a literal, case-insensitive, read-only grep with the query safely quoted', () => {
    expect(gitGrepCommand('formatElapsed')).toBe("git grep -n -I -F -i -e 'formatElapsed' -- . ':(exclude)package-lock.json' | head -n 60")
    expect(gitGrepCommand("it's $(rm -rf /)")).toContain(`-e 'it'\\''s $(rm -rf /)'`)
  })
  it('refuses what cannot be sent safely', () => {
    expect(gitGrepCommand('')).toBe('')
    expect(gitGrepCommand('a\nb')).toBe('')
    expect(gitGrepCommand('x'.repeat(201))).toBe('')
  })
  it('a quoted query is passed to the shell as one literal word', () => {
    const cmd = gitGrepCommand("it's $(echo pwned) `echo x`")
    const quoted = /-e ('(?:[^']|'\\'')*')/.exec(cmd)![1]
    const r = spawnSync('bash', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' })
    expect(r.stdout).toBe("it's $(echo pwned) `echo x`")
  })
})

// The exact shape shell_exec returns (forgeTools.ts).
const shellOk = (output: string) => ['Shell execution complete.', 'Run #12 (id: 99)', 'Invocation: shell-1', 'Command: git grep …', 'Exit code: 0', '', output].join('\n')

describe('parseGrepOutput', () => {
  it('reads path, line and text from the shell result', () => {
    const out = parseGrepOutput(shellOk('src/lib/elapsed.ts:7:export function formatElapsed(ms: number): string {\nsrc/components/ElapsedNote.tsx:3:import { formatElapsed } from "../lib/elapsed"'))
    expect(out).toEqual([
      { path: 'src/lib/elapsed.ts', line: 7, text: 'export function formatElapsed(ms: number): string {' },
      { path: 'src/components/ElapsedNote.tsx', line: 3, text: 'import { formatElapsed } from "../lib/elapsed"' },
    ])
  })
  it('a search that ran and found nothing is an empty list, not a failure', () => {
    expect(parseGrepOutput(shellOk('(command produced no output)'))).toEqual([])
  })
  it('a search that did not run is null', () => {
    expect(parseGrepOutput('[TOOL ERROR] Failed to fetch')).toBeNull()
    expect(parseGrepOutput('[GUARDIAN REJECTED] operator declined')).toBeNull()
    expect(parseGrepOutput('Shell execution dispatched. Run #3')).toBeNull()
  })
})

describe('formatGrepMatches', () => {
  it('says it searched contents, and why the API was not used', () => {
    const text = formatGrepMatches('formatElapsed', [{ path: 'src/lib/elapsed.ts', line: 7, text: 'export function formatElapsed' }], 'Failed to fetch')
    expect(text).toContain('Found 1 matching line(s) in 1 file(s) for "formatElapsed" (searched file CONTENTS with git grep on a runner')
    expect(text).toContain('Failed to fetch')
    expect(text).toContain('• src/lib/elapsed.ts:7: export function formatElapsed')
    expect(formatGrepMatches('nope', [], 'x')).toContain('(no file contains it)')
  })
})

describe('github_search_code when the API is unreachable', () => {
  const ctx = { ...loadToolContext(), ghToken: 't', ghOwner: 'o', ghRepo: 'r', guardianPosture: 'autonomous' as const }
  function github(tree: string[], dispatched: string[]) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/search/code')) throw new TypeError('Failed to fetch')
      if (url.endsWith('/shell-exec.yml/dispatches')) { dispatched.push(JSON.parse(String(init?.body)).inputs.command); return new Response('{"message":"Not Found"}', { status: 404 }) }
      if (url.includes('/git/trees/main')) return Response.json({ tree: tree.map(path => ({ path, type: 'blob' })) })
      return new Response('{}', { status: 404 })
    })
  }
  it('tries a content search on a runner first, with the git grep command', async () => {
    vi.useFakeTimers()
    const dispatched: string[] = []
    vi.stubGlobal('fetch', github(['src/lib/elapsed.ts'], dispatched))
    const pending = executeTool({ id: '1', name: 'github_search_code', input: { query: 'formatElapsed' } }, ctx)
    await vi.runAllTimersAsync()
    await pending
    expect(dispatched[0]).toBe(gitGrepCommand('formatElapsed'))
  })
  it('a names-only result says contents were NOT searched', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', github(['src/lib/elapsed.ts', 'src/lib/elapsed.test.ts'], []))
    const pending = executeTool({ id: '1', name: 'github_search_code', input: { query: 'elapsed' } }, ctx)
    await vi.runAllTimersAsync()
    const out = await pending
    expect(out).toContain('Found 2 file NAME match(es) for "elapsed" (names only; file contents were NOT searched')
  })
  it('finding nothing by name is an error, never "Found 0 matches"', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', github(['src/lib/elapsed.ts'], []))
    const pending = executeTool({ id: '1', name: 'github_search_code', input: { query: 'formatElapsed' } }, ctx)
    await vi.runAllTimersAsync()
    const out = await pending
    expect(out).toMatch(/^\[TOOL ERROR\] Code search could not search file contents/)
    expect(out).toContain('nothing was really searched')
    expect(out).not.toContain('Found 0')
  })
})
