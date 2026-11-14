import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkGithubReadArgs } from './githubArgCheck'
import { toolArgumentRefusal } from './toolArgumentValidation'

// The rules and their exhaustive tests live in githubArgCheck(.test).ts. This module only asks that checker early, in the
// main tool loop, so a refused call can be recorded as a call that never ran.

describe('toolArgumentRefusal delegates to the one rule set', () => {
  it('refuses the call the owner saw under the Nexus provider, naming path, owner and start_line', () => {
    const input = { path: ':', owner: '.', start_line: 257257207 }
    const refusal = toolArgumentRefusal('github_read_file', input)
    expect(refusal).toMatch(/^\[TOOL ERROR\] github_read_file was refused before it was sent/)
    expect(refusal).toContain('owner "."')
    expect(refusal).toContain('path ":"')
    expect(refusal).toContain('start_line "257257207"')
    expect(refusal).toBe(`[TOOL ERROR] ${checkGithubReadArgs('github_read_file', input)}`)
  })

  it('never disagrees with executeTool\'s checker, so the two layers cannot drift', () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['github_read_file', { path: 'README.md' }], ['github_read_file', { path: ':' }], ['github_read_file', {}],
      ['github_list_files', { path: '' }], ['github_list_files', { path: ':' }], ['github_search_code', { query: '' }],
      ['github_get_run_logs', { run_id: 'abc' }], ['github_pr_info', { owner: '.' }], ['shell_exec', { path: ':' }],
    ]
    for (const [name, input] of calls) expect(toolArgumentRefusal(name, input) === null).toBe(checkGithubReadArgs(name, input) === null)
  })

  it('accepts what works today (these were wrongly refused by the first copy of the rules)', () => {
    expect(toolArgumentRefusal('github_read_file', { path: 'README.md', owner: 'acme_corp', repo: 'forgeclaw' })).toBeNull()
    expect(toolArgumentRefusal('github_read_file', { path: 'README.md', owner: `${'a'.repeat(39)}_shortcode` })).toBeNull()
    expect(toolArgumentRefusal('github_read_file', { path: 'README.md', start_line: 0 })).toBeNull()
    expect(toolArgumentRefusal('github_read_file', { path: 'README.md', start_line: -1 })).toBeNull()
    expect(toolArgumentRefusal('github_read_file', { path: 'README.md', start_line: 2.5 })).toBeNull()
    expect(toolArgumentRefusal('github_read_file', { path: '/src/App.tsx', start_line: '120' })).toBeNull()
  })

  it('leaves every other tool alone and never throws on a missing input', () => {
    for (const name of ['shell_exec', 'github_write_file', 'github_create_repo', 'sculpt_self', 'shell_patch', 'nexus_reason', 'unknown_tool']) {
      expect(toolArgumentRefusal(name, { path: ':', owner: '.', start_line: 257257207 })).toBeNull()
    }
    expect(toolArgumentRefusal('github_read_file', undefined)).toContain('path is required')
    expect(toolArgumentRefusal('shell_exec', undefined)).toBeNull()
  })

  it('stays short enough to read back through a 640-token window', () => {
    expect(toolArgumentRefusal('github_read_file', { path: ':', owner: '.', repo: 'a/b', start_line: 257257207 })!.length).toBeLessThan(900)
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
