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

describe('direct dispatch covers the operator tool set', () => {
  const route = (prompt: string) => extractExplicitToolCall(prompt)
  const baseCtx = () => ({ ...loadToolContext(), ghToken: 'test-token', googleToken: 'g-token', waPhoneNumberId: '1', waAccessToken: 'wa', guardianPosture: 'operator-shell' as const })

  it.each([
    ['github_repo_state', {}],
    ['github_verify_commit sha="abc1234"', { sha: 'abc1234' }],
    ['github_search_code query="requiresCoSign"', { query: 'requiresCoSign' }],
    ['github_get_run_status run_id="42"', { run_id: '42' }],
    ['github_get_run_logs run_id="42"', { run_id: '42' }],
    ['web_search query="wind turbine blade repair" count="3"', { query: 'wind turbine blade repair', count: '3' }],
    ['memory_list', {}],
    ['gmail_read max_results="3"', { max_results: '3' }],
    ['calendar_read', {}],
  ])('routes %s without the model', (prompt, input) => {
    const call = route(prompt)!
    expect(call.error).toBeUndefined()
    expect(call.name).toBe(prompt.split(' ')[0])
    expect(call.input).toEqual(input)
  })

  it.each([
    ['github_verify_commit', 'sha'],
    ['github_get_run_logs', 'run_id'],
    ['github_create_issue title="t"', 'body'],
    ['gmail_send to="a@b.com" subject="s"', 'body'],
    ['calendar_create summary="x" start="2026-10-15T10:00:00"', 'end'],
    ['send_whatsapp', 'text'],
    ['memory_write key="k"', 'value'],
    ['web_search', 'query'],
    ['web_search query="   "', 'query'],
  ])('reports a missing argument for %s instead of calling anything', (prompt, missing) => {
    const call = route(prompt)!
    expect(call.error).toContain(`missing required argument`)
    expect(call.error).toContain(missing)
    expect(call.error).toContain('Usage:')
  })

  it.each([
    ['github_verify_commit sha="c675c35', 'sha'],
    ["github_read_file path='src/App.tsx", 'path'],
    ['github_search_code query="unclosed text', 'query'],
  ])('rejects an unterminated quote in %s without calling anything', (prompt, arg) => {
    const call = route(prompt)!
    expect(call.error).toContain('unterminated quote')
    expect(call.error).toContain(arg)
    expect(call.error).toContain('Nothing was sent')
  })

  it('still accepts balanced quotes, bare values and quotes inside values', () => {
    expect(route('github_verify_commit sha=c675c35')!.error).toBeUndefined()
    expect(route('github_verify_commit sha="c675c35"')!.input).toEqual({ sha: 'c675c35' })
    expect(route("github_write_file path=a.txt content='say \"hi\"'")!.input.content).toBe('say "hi"')
  })

  it('still leaves excluded tools on their existing paths', () => {
    for (const prompt of ['run_js code="1+1"', 'sculpt_self file_path="x"', 'spawn_agent task="x"', 'http_fetch url="https://x"', 'deepseek_reason task="x"']) {
      expect(route(prompt)).toBeNull()
    }
  })

  it('round-trips memory locally with no network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const w = route('memory_write key="blade_note" value="check root bolts"')!
    expect(await executeTool({ id: 'm1', name: w.name, input: w.input }, baseCtx())).toContain('blade_note')
    const r = route('memory_read key="blade_note"')!
    expect(await executeTool({ id: 'm2', name: r.name, input: r.input }, baseCtx())).toBe('check root bolts')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'gmail_send to="a@b.com" subject="s" body="b"',
    'send_whatsapp text="hi"',
    'calendar_create summary="x" start="2026-10-15T10:00:00" end="2026-10-15T11:00:00"',
    'github_run_workflow workflow="ddg_search.yml"',
  ])('keeps %s behind the Guardian: rejected means no network call', async prompt => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const call = route(prompt)!
    const approval = vi.fn(async () => false)
    const output = await executeTool({ id: 'g1', name: call.name, input: call.input }, { ...baseCtx(), requestGuardianApproval: approval })
    expect(approval).toHaveBeenCalledTimes(1)
    expect(output).toMatch(/^\[GUARDIAN REJECTED\]/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs a read-only tool straight through to its API without a card', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const approval = vi.fn(async () => true)
    const call = route('gmail_read max_results="1"')!
    await executeTool({ id: 'r1', name: call.name, input: call.input }, { ...baseCtx(), requestGuardianApproval: approval })
    expect(approval).not.toHaveBeenCalled()
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('gmail.googleapis.com')
  })
})
