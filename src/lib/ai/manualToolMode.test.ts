import { describe, expect, it } from 'vitest'
import { parseManualToolCalls, stripToolSyntax } from './manualToolMode'

describe('parseManualToolCalls', () => {
  it('parses Format A fenced tool calls', () => {
    expect(parseManualToolCalls('```tool_call\n{"name":"github_read_file","arguments":{"path":"package.json"}}\n```')).toEqual([
      {
        toolName: 'github_read_file',
        params: { path: 'package.json' },
        rawOutput: '```tool_call\n{"name":"github_read_file","arguments":{"path":"package.json"}}\n```',
      },
    ])
  })

  it('parses fenced JSON tool calls', () => {
    const emitted = '```json\n{"name":"github_read_file","arguments":{"path":"/README.md"}}\n```'
    expect(parseManualToolCalls(emitted)).toEqual([
      {
        toolName: 'github_read_file',
        params: { path: '/README.md' },
        rawOutput: emitted,
      },
    ])
    expect(stripToolSyntax(emitted)).toBe('')
  })

  it('parses Format B line tool calls', () => {
    expect(parseManualToolCalls('TOOL_CALL: github_repo_state\n{"owner":"DeviousDevv303","repo":"forgeclaw"}')).toEqual([
      {
        toolName: 'github_repo_state',
        params: { owner: 'DeviousDevv303', repo: 'forgeclaw' },
        rawOutput: 'TOOL_CALL: github_repo_state\n{"owner":"DeviousDevv303","repo":"forgeclaw"}',
      },
    ])
  })

  it('parses Format C XML-like tool calls', () => {
    expect(parseManualToolCalls('<tool_call name="github_read_file">{"path":"package.json"}</tool_call>')).toEqual([
      {
        toolName: 'github_read_file',
        params: { path: 'package.json' },
        rawOutput: '<tool_call name="github_read_file">{"path":"package.json"}</tool_call>',
      },
    ])
  })

  it('parses Format D double-quoted arguments', () => {
    expect(parseManualToolCalls('github_read_file(path: "package.json" owner: "DeviousDevv303" repo: "forgeclaw")')).toEqual([
      {
        toolName: 'github_read_file',
        params: { path: 'package.json', owner: 'DeviousDevv303', repo: 'forgeclaw' },
        rawOutput: 'github_read_file(path: "package.json" owner: "DeviousDevv303" repo: "forgeclaw")',
      },
    ])
  })

  it('parses Format D mixed comma and whitespace separators', () => {
    expect(parseManualToolCalls('github_repo_state(owner: "DeviousDevv303", repo: "forgeclaw")')).toEqual([
      {
        toolName: 'github_repo_state',
        params: { owner: 'DeviousDevv303', repo: 'forgeclaw' },
        rawOutput: 'github_repo_state(owner: "DeviousDevv303", repo: "forgeclaw")',
      },
    ])
  })

  it('parses Format D single-quoted and unquoted values', () => {
    expect(parseManualToolCalls("github_read_file(path: 'package.json' owner: DeviousDevv303 repo: forgeclaw)")).toEqual([
      {
        toolName: 'github_read_file',
        params: { path: 'package.json', owner: 'DeviousDevv303', repo: 'forgeclaw' },
        rawOutput: "github_read_file(path: 'package.json' owner: DeviousDevv303 repo: forgeclaw)",
      },
    ])
  })

  it('silently discards malformed parenthesized input', () => {
    expect(() => parseManualToolCalls('github_read_file(')).not.toThrow()
    expect(parseManualToolCalls('github_read_file(')).toEqual([])
  })

  it('does not match non-github parenthesized calls', () => {
    expect(parseManualToolCalls('do_thing()')).toEqual([])
  })
})