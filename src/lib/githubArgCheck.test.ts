// @vitest-environment node
// checkGithubReadArgs is a refusal-only pre-flight for the GitHub read tools. Origin: the owner's live
// shell_patch test (2026-11-13, nexus run 43529590869) in which the Nexus checkpoint emitted
//   github_read_file {"path":":","start_line":257257207,"owner":". The claP 07: CONFIRMED. ..."}
// Every call that works today must keep working, so valid forms are pinned as hard as invalid ones.
import { describe, expect, it } from 'vitest'
import { checkGithubReadArgs, MAX_START_LINE } from './githubArgCheck'
import { NEXUS_RESULT_INJECT_MAX_CHARS } from './ai/nexusIntelligenceContext'

describe('checkGithubReadArgs: the owner\'s live Nexus call', () => {
  const live = { path: ':', start_line: 257257207, owner: '. The claP 07: CONFIRMED. The no futed in your nex2 dollars' }
  const out = checkGithubReadArgs('github_read_file', live)!

  it('is refused, naming every bad field in one message (the Nexus loop has only 3 calls)', () => {
    expect(out).toContain('owner')
    expect(out).toContain('path')
    expect(out).toContain('start_line')
  })
  it('tells the model how to recover, field by field', () => {
    expect(out).toMatch(/omit owner/i)
    expect(out).toMatch(/file path/i)
    expect(out).toMatch(/omit (it|start_line)/i)
  })
  it('is short enough to survive the checkpoint\'s result injection cap, and echoes the garbage truncated', () => {
    expect(out.length).toBeLessThan(NEXUS_RESULT_INJECT_MAX_CHARS)
    expect(out).not.toContain('no futed in your nex2 dollars')
  })
})

describe('checkGithubReadArgs: each absurd value on its own', () => {
  it.each([
    ['owner', { owner: '.', path: 'README.md' }, /owner/],
    ['owner with spaces', { owner: 'a b', path: 'README.md' }, /owner/],
    ['owner as a number', { owner: 7, path: 'README.md' }, /owner/],
    ['repo with a slash', { repo: 'DeviousDevv303/forgeclaw', path: 'README.md' }, /repo.*slash|slash.*repo/i],
    ['repo ".."', { repo: '..', path: 'README.md' }, /repo/],
    ['path ":"', { path: ':' }, /path/],
    ['path empty', { path: '' }, /path/],
    ['path missing', {}, /path/],
    ['path with a ".." segment', { path: 'src/../../etc/passwd' }, /path/],
    ['path as an object', { path: { a: 1 } }, /path/],
    ['start_line too large', { path: 'a.ts', start_line: 257257207 }, /start_line/],
    ['start_line NaN text', { path: 'a.ts', start_line: 'abc' }, /start_line/],
    ['start_line just over the cap', { path: 'a.ts', start_line: MAX_START_LINE + 1 }, /start_line/],
  ])('refuses %s', (_label, input, field) => {
    expect(checkGithubReadArgs('github_read_file', input as Record<string, unknown>)).toMatch(field)
  })
})

describe('checkGithubReadArgs: calls that work today stay valid', () => {
  it.each([
    { path: 'README.md' },
    { path: '/README.md' },
    { path: './src/App.tsx' },
    { path: 'docs/a:b.md' },
    { path: '.gitignore' },
    { path: 'src/lib/forgeTools.ts', start_line: 1 },
    { path: 'src/lib/forgeTools.ts', start_line: 2500 },
    { path: 'src/lib/forgeTools.ts', start_line: '120' },
    { path: 'src/lib/forgeTools.ts', start_line: 0 }, // works today (read from the top)
    { path: 'src/lib/forgeTools.ts', start_line: MAX_START_LINE },
    { path: 'a.ts', owner: 'DeviousDevv303', repo: 'forgeclaw' },
    { path: 'a.ts', owner: 'some-org_1', repo: 'my.repo-name_2' },
    { path: 'a.ts', owner: '', repo: '' }, // empty falls back to the configured repository
    { path: 'a.ts', owner: undefined, repo: null },
  ])('accepts %j', (input) => {
    expect(checkGithubReadArgs('github_read_file', input as Record<string, unknown>)).toBeNull()
  })
})

describe('checkGithubReadArgs: sibling read tools', () => {
  it('github_list_files keeps "", ".", "/" and "./" as the repository root', () => {
    for (const path of [undefined, '', '.', '/', './', 'src', 'src/lib/']) {
      expect(checkGithubReadArgs('github_list_files', path === undefined ? {} : { path })).toBeNull()
    }
  })
  it('github_list_files refuses a junk path and a bad owner', () => {
    expect(checkGithubReadArgs('github_list_files', { path: ':' })).toMatch(/path/)
    expect(checkGithubReadArgs('github_list_files', { owner: '.' })).toMatch(/owner/)
  })
  it('github_get_run_status / github_get_run_logs need a numeric run_id and a sane owner/repo', () => {
    for (const tool of ['github_get_run_status', 'github_get_run_logs']) {
      expect(checkGithubReadArgs(tool, { run_id: '39333499997' })).toBeNull()
      expect(checkGithubReadArgs(tool, { run_id: 39333499997 })).toBeNull()
      expect(checkGithubReadArgs(tool, { run_id: '../x' })).toMatch(/run_id/)
      expect(checkGithubReadArgs(tool, { run_id: 'abc' })).toMatch(/run_id/)
      expect(checkGithubReadArgs(tool, { run_id: '123', owner: '.' })).toMatch(/owner/)
    }
  })
  it('github_search_code needs a non-empty query', () => {
    expect(checkGithubReadArgs('github_search_code', { query: 'executeTool' })).toBeNull()
    expect(checkGithubReadArgs('github_search_code', { query: '' })).toMatch(/query/)
    expect(checkGithubReadArgs('github_search_code', {})).toMatch(/query/)
  })
  it('github_list_prs, github_pr_info and github_repo_state check owner/repo only', () => {
    for (const tool of ['github_list_prs', 'github_pr_info', 'github_repo_state']) {
      expect(checkGithubReadArgs(tool, {})).toBeNull()
      expect(checkGithubReadArgs(tool, { owner: '.' })).toMatch(/owner/)
    }
  })
})

describe('checkGithubReadArgs: tools it must not touch', () => {
  it('ignores write tools and unrelated tools entirely (their gates are Guardian\'s, not this check\'s)', () => {
    expect(checkGithubReadArgs('github_write_file', { path: ':', owner: '.' })).toBeNull()
    expect(checkGithubReadArgs('shell_exec', { command: 'pwd', owner: '.' })).toBeNull()
    expect(checkGithubReadArgs('web_search', {})).toBeNull()
  })
})
