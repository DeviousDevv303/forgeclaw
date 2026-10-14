// @vitest-environment node
// Direct tool routing: an operator-typed `github_write_file path=… content=…`
// must reach the dispatcher (and its Guardian gate) without a model turn.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isExplicitShellRequest,
  extractExplicitShellCommand,
  isExplicitToolRequest,
  extractExplicitToolCall,
} from './codingAgentRuntime'
import { executeTool, loadToolContext } from './forgeTools'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

afterEach(() => {
  storage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Mirrors the App routing order: shell first, then direct tools. */
function route(prompt: string) {
  const shell = isExplicitShellRequest(prompt) ? extractExplicitShellCommand(prompt) : null
  return !shell && isExplicitToolRequest(prompt) ? extractExplicitToolCall(prompt) : null
}

describe('direct tool detection', () => {
  it.each([
    'github_write_file path="test.txt" content="hello"',
    '`github_write_file path="test.txt" content="hello"`',
    '```\ngithub_write_file path="test.txt" content="hello"\n```',
    '  github_write_file path="test.txt" content="hello"\n',
    'github_write_file path=“test.txt” content=“hello”',
  ])('routes %j to github_write_file without the model', prompt => {
    expect(route(prompt)).toEqual({ name: 'github_write_file', input: { path: 'test.txt', content: 'hello', message: 'operator direct write: test.txt' } })
  })

  it('keeps quoted values with spaces and optional args', () => {
    expect(route("github_write_file path='docs/a b.md' content=\"hello world\" branch=feature/x")).toEqual({
      name: 'github_write_file',
      input: { path: 'docs/a b.md', content: 'hello world', branch: 'feature/x', message: 'operator direct write: docs/a b.md' },
    })
  })

  it('reports missing required args instead of writing "undefined"', () => {
    const call = route('github_write_file path="x.txt"')
    expect(call?.error).toMatch(/^\[TOOL ERROR\] github_write_file is missing required argument: content/)
    expect(route('github_read_file')?.error).toContain('path')
  })

  it('allows an empty content string and bare github_list_files', () => {
    expect(route('github_write_file path="x.txt" content="" message="docs: x"')).toEqual({ name: 'github_write_file', input: { path: 'x.txt', content: '', message: 'docs: x' } })
    expect(route('github_list_files')).toEqual({ name: 'github_list_files', input: {} })
  })

  it('leaves prose and unknown tools on the model path', () => {
    expect(route('Create a file called test-approval.txt with content "hello"')).toBeNull()
    expect(route('/deepseek Use the github_write_file tool to create x')).toBeNull()
    expect(route('shell_exec command="ls"')).toBeNull()
    expect(route('github_write_files path="x" content="y"')).toBeNull()
  })
})

describe('direct tool → Guardian gate (operator-shell posture)', () => {
  const ctx = () => ({ ...loadToolContext(), ghToken: 'test-token', guardianPosture: 'operator-shell' as const })

  it('asks for co-sign and never touches GitHub when rejected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const call = route('`github_write_file path="test.txt" content="hello"`')!
    const approval = vi.fn(async () => false)
    const output = await executeTool({ id: 'direct-tool-1', name: call.name, input: call.input }, { ...ctx(), requestGuardianApproval: approval })
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({ name: 'github_write_file', input: expect.objectContaining({ path: 'test.txt', content: 'hello' }) }))
    expect(output).toBe('[GUARDIAN REJECTED] github_write_file was not executed.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes the parsed content after approval', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ commit: { sha: 'abc1234', html_url: 'https://github.com/x' } }), { status: 201 })
        : new Response('{}', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const call = route('github_write_file path=“test.txt” content=“hello”')!
    const output = await executeTool({ id: 'direct-tool-2', name: call.name, input: call.input }, { ...ctx(), requestGuardianApproval: async () => true })
    expect(output).toContain('abc1234')
    expect(output).toContain('message: "operator direct write: test.txt"')
    expect(output).not.toContain('undefined')
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toMatch(/\/contents\/test\.txt$/)
    expect(JSON.parse(String(put[1]!.body)).content).toBe(btoa('hello'))
  })
  it('attributes an operator-typed write to the operator, and agent writes to MANUS', async () => {
    const makeFetch = () => vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ commit: { sha: 'abc1234', html_url: 'https://github.com/x' } }), { status: 201 })
        : new Response('{}', { status: 404 }),
    )
    const messageFor = async (actor?: 'operator') => {
      const fetchMock = makeFetch()
      vi.stubGlobal('fetch', fetchMock)
      const call = route('github_write_file path="a.txt" content="hi"')!
      await executeTool({ id: 'direct-tool-3', name: call.name, input: call.input }, { ...ctx(), actor, requestGuardianApproval: async () => true })
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
      return JSON.parse(String(put[1]!.body)).message as string
    }
    const operatorMessage = await messageFor('operator')
    expect(operatorMessage.split('\n')[0]).toMatch(/^operator — what: operator direct write: a\.txt/)
    expect(operatorMessage).not.toContain('MANUS')
    expect(operatorMessage).toContain('WHY:')
    const agentMessage = await messageFor()
    expect(agentMessage.split('\n')[0]).toMatch(/^agent: MANUS — what:/)
  })
})
