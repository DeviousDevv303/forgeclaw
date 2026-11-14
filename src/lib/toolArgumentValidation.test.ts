import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_PLAUSIBLE_LINE, toolArgumentRefusal } from './toolArgumentValidation'

describe('toolArgumentRefusal: the call the owner saw under the Nexus provider', () => {
  it('refuses path ":", owner "." and start_line 257257207, naming all three', () => {
    const refusal = toolArgumentRefusal('github_read_file', { path: ':', owner: '.', start_line: 257257207 })
    expect(refusal).toMatch(/^\[TOOL ERROR\] github_read_file was NOT run: /)
    expect(refusal).toContain('path is ":"')
    expect(refusal).toContain('owner is "."')
    expect(refusal).toContain('start_line is 257257207')
    expect(refusal).toContain('Correct the argument and call again.')
  })

  it('stays short enough for a 640-token window', () => {
    const refusal = toolArgumentRefusal('github_read_file', { path: ':', owner: '.', repo: 'a/b', start_line: 257257207 })!
    expect(refusal.length).toBeLessThan(600)
  })
})

describe('github_read_file', () => {
  const ok = (input: Record<string, unknown>) => expect(toolArgumentRefusal('github_read_file', input)).toBeNull()
  const refused = (input: Record<string, unknown>, text: string) => expect(toolArgumentRefusal('github_read_file', input)).toContain(text)

  it('accepts every call that works today', () => {
    ok({ path: 'src/App.tsx' })
    ok({ path: '/src/App.tsx' })
    ok({ path: '.gitignore' })
    ok({ path: '.github/workflows/shell-exec.yml' })
    ok({ path: 'README.md', start_line: 1 })
    ok({ path: 'README.md', start_line: 0 })
    ok({ path: 'README.md', start_line: '120' })
    ok({ path: 'README.md', start_line: MAX_PLAUSIBLE_LINE })
    ok({ path: 'README.md', start_line: null })
    ok({ path: 'README.md', start_line: '' })
    ok({ path: 'README.md', owner: 'DeviousDevv303', repo: 'forgeclaw' })
    ok({ path: 'README.md', owner: '', repo: '' })
    ok({ path: 'docs/a b.md' })
    ok({ path: 'nexus-llm/runs/run25/verdict.md', owner: 'a', repo: 'my.repo_name-2' })
  })

  it('refuses a path no request can satisfy', () => {
    for (const path of [':', '.', '..', './', '/', '///', '-', '   ']) refused({ path }, 'path')
    refused({}, 'path is missing')
    refused({ path: null }, 'path is missing')
    refused({ path: 42 }, 'path is 42')
    refused({ path: ['a'] }, 'not text')
    refused({ path: 'src/../etc/passwd' }, '".."')
    refused({ path: 'a\nb' }, 'control character')
    refused({ path: 'a'.repeat(501) }, 'over 500 characters')
  })

  it('refuses a start_line that is not a whole line number', () => {
    for (const start_line of [257257207, MAX_PLAUSIBLE_LINE + 1, -1, 2.5, 'abc', '1e9', NaN, Infinity, {}, true]) {
      refused({ path: 'README.md', start_line }, 'start_line is')
    }
  })

  it('refuses an owner or repo that is not a GitHub name', () => {
    for (const owner of ['.', '..', '-a', 'a-', 'a/b', 'a b', 5, 'x'.repeat(40)]) refused({ path: 'a.md', owner }, 'owner is')
    for (const repo of ['.', '..', 'a/b', 'a b', 5, 'x'.repeat(101)]) refused({ path: 'a.md', repo }, 'repo is')
  })

  it('reports at most four problems', () => {
    const refusal = toolArgumentRefusal('github_read_file', { path: ':', start_line: -1, owner: '.', repo: '..' })!
    expect(refusal.split('; ').length).toBeLessThanOrEqual(4)
  })
})

describe('sibling read tools', () => {
  it('github_list_files accepts the root and an omitted path, refuses a garbage directory', () => {
    for (const path of [undefined, '', '.', '/', './', 'src', 'src/lib/', '.github']) expect(toolArgumentRefusal('github_list_files', path === undefined ? {} : { path })).toBeNull()
    expect(toolArgumentRefusal('github_list_files', { path: ':' })).toContain('directory path')
    expect(toolArgumentRefusal('github_list_files', { path: '..' })).toContain('".."')
    expect(toolArgumentRefusal('github_list_files', { path: 'src', owner: '.' })).toContain('owner is "."')
  })

  it('github_search_code needs a real query', () => {
    expect(toolArgumentRefusal('github_search_code', { query: 'useState' })).toBeNull()
    expect(toolArgumentRefusal('github_search_code', { query: 'TODO fixme', owner: 'a', repo: 'b' })).toBeNull()
    for (const query of [undefined, '', '   ', 5]) expect(toolArgumentRefusal('github_search_code', { query })).toContain('query is missing or empty')
    expect(toolArgumentRefusal('github_search_code', { query: 'x'.repeat(1001) })).toContain('1001 characters')
  })
})

describe('everything else is untouched', () => {
  it('other tools, and write tools in particular, are never validated here', () => {
    for (const name of ['shell_exec', 'github_write_file', 'github_create_repo', 'sculpt_self', 'shell_patch', 'nexus_reason', 'qwen_reason', 'unknown_tool']) {
      expect(toolArgumentRefusal(name, { path: ':', owner: '.', start_line: 257257207 })).toBeNull()
    }
  })

  it('a missing input object is treated as no arguments, never a throw', () => {
    expect(toolArgumentRefusal('github_read_file', undefined)).toContain('path is missing')
    expect(toolArgumentRefusal('github_list_files', undefined)).toBeNull()
    expect(toolArgumentRefusal('shell_exec', undefined)).toBeNull()
  })
})

describe('wiring in App.tsx (pinned: this is a source check, the behaviour was driven in a real browser)', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

  it('refuses before the loop detector and before dispatch, and records the attempt as a never-run call', () => {
    const refusal = app.indexOf('toolArgumentRefusal(call.name, call.input)')
    const guardian = app.indexOf('const refusal = toolCallRefusal(')
    const loop = app.indexOf('const callKey = `${call.name}:${JSON.stringify(call.input)}`')
    const dispatch = app.indexOf('executeTool(call', loop)
    expect(guardian).toBeGreaterThan(-1)
    expect(refusal).toBeGreaterThan(guardian)
    expect(loop).toBeGreaterThan(refusal)
    expect(dispatch).toBeGreaterThan(loop)  // the first dispatch after the refusal, in the model tool loop
    const block = app.slice(refusal, loop)
    expect(block).not.toContain('executeTool')
    expect(block).toContain('isError: true')
    expect(block).toContain('toolAttempts.push({ name: call.name, input: TRUNCATED_ATTEMPT })')
    expect(block).toContain('continue')
  })

  it('leaves the completion guard\'s verdict logic as it was', () => {
    expect(app).toContain('(failedAttempt?.input === TRUNCATED_ATTEMPT || toolAttempts[laterIndex]?.input === failedAttempt?.input)')
    expect(app).toContain('const completionBlocked = repositoryEvidenceRequired && !repositoryEvidenceObserved')
  })
})
