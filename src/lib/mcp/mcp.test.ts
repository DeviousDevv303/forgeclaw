// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
import { describe, expect, it } from 'vitest'
import { McpClient, invalidServerReason, parseSseMessages, redact, type FetchLike } from './mcpClient'
import { McpRegistry, formatCallResult, isMcpToolName, loadMcpServers, mcpToolName, saveMcpServers, toToolDef } from './mcpRegistry'

const TOKEN = 'sk-test-SECRET-1234'

interface FakeOpts { sse?: boolean; pages?: number; dropSessionOnce?: boolean; rpcError?: boolean; hang?: boolean; echoAuth?: boolean }
/** A minimal MCP Streamable HTTP server: session id on initialize, paged tools/list, tools/call, optional SSE replies. */
function fakeServer(opts: FakeOpts = {}) {
  const seen: { method: string; headers: Record<string, string> }[] = []
  let dropped = false
  const tools = [
    { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'City name' }, units: { type: 'string', enum: ['c', 'f'] }, days: { type: ['integer', 'null'] }, tags: { type: 'array' }, opts: { type: 'object' } }, required: ['city', 'ghost'] }, annotations: { readOnlyHint: true } },
    { name: 'send email!', description: 'Sends an email', inputSchema: { type: 'object', properties: { to: { type: 'string' } } } },
  ]
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: Record<string, unknown> }
    const headers = init.headers as Record<string, string>
    seen.push({ method: body.method, headers })
    if (opts.hang) return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (opts.dropSessionOnce && !dropped && body.method === 'tools/call') { dropped = true; return new Response('session gone', { status: 404 }) }
    if (opts.echoAuth && body.method === 'tools/list') return new Response(`denied for ${headers.Authorization}`, { status: 401 })
    let result: unknown
    if (opts.rpcError && body.method === 'tools/call') {
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'bad arguments' } })
    }
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } }
    else if (body.method === 'tools/list') {
      const page = Number((body.params?.cursor as string | undefined) ?? 0)
      const per = Math.ceil(tools.length / (opts.pages ?? 1))
      result = { tools: tools.slice(page * per, page * per + per), ...(page + 1 < (opts.pages ?? 1) ? { nextCursor: String(page + 1) } : {}) }
    } else if (body.method === 'tools/call') {
      const p = body.params as { name: string; arguments: Record<string, unknown> }
      result = p.name === 'get_weather'
        ? { content: [{ type: 'text', text: `Sunny in ${p.arguments.city}` }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] }
        : { content: [{ type: 'text', text: `refused ${TOKEN}` }], isError: true }
    }
    const msg = { jsonrpc: '2.0', id: body.id, result }
    const h = new Headers(body.method === 'initialize' ? { 'Mcp-Session-Id': 'sess-1' } : {})
    if (opts.sse) { h.set('Content-Type', 'text/event-stream'); return new Response(`: keepalive\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${JSON.stringify(msg)}\n\n`, { headers: h }) }
    h.set('Content-Type', 'application/json')
    return new Response(JSON.stringify(msg), { headers: h })
  }
  return { fetch, seen }
}

const cfg = { id: 'wx', label: 'Weather', url: 'https://mcp.example.com/mcp', token: TOKEN }

describe('MCP client: the Streamable HTTP protocol', () => {
  it('initializes, then carries the session id and protocol version on every later request', async () => {
    const s = fakeServer()
    const c = new McpClient(cfg, { fetch: s.fetch })
    await c.listTools()
    expect(s.seen.map(x => x.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    const list = s.seen.find(x => x.method === 'tools/list')!.headers
    expect(list['Mcp-Session-Id']).toBe('sess-1')
    expect(list['MCP-Protocol-Version']).toBe('2025-06-18')
    expect(list.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(list.Accept).toContain('text/event-stream')
  })
  it('reads replies sent as an SSE stream, skipping comments and other messages', async () => {
    const c = new McpClient(cfg, { fetch: fakeServer({ sse: true }).fetch })
    expect((await c.listTools()).map(t => t.name)).toEqual(['get_weather', 'send email!'])
  })
  it('follows nextCursor pages', async () => {
    const c = new McpClient(cfg, { fetch: fakeServer({ pages: 2 }).fetch })
    expect(await c.listTools()).toHaveLength(2)
  })
  it('re-initializes once when the server forgets the session (404), then retries the call', async () => {
    const s = fakeServer({ dropSessionOnce: true })
    const c = new McpClient(cfg, { fetch: s.fetch })
    const r = await c.callTool('get_weather', { city: 'Tulsa' })
    expect(r.content?.[0]).toMatchObject({ text: 'Sunny in Tulsa' })
    expect(s.seen.filter(x => x.method === 'initialize')).toHaveLength(2)
  })
  it('a JSON-RPC error becomes an McpError, not a result', async () => {
    const c = new McpClient(cfg, { fetch: fakeServer({ rpcError: true }).fetch })
    await expect(c.callTool('get_weather', {})).rejects.toMatchObject({ kind: 'rpc' })
  })
  it('times out instead of hanging forever', async () => {
    const c = new McpClient(cfg, { fetch: fakeServer({ hang: true }).fetch, timeoutMs: 30 })
    await expect(c.listTools()).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('honours the run abort signal', async () => {
    const ctl = new AbortController(); ctl.abort()
    const c = new McpClient(cfg, { fetch: fakeServer().fetch })
    await expect(c.listTools(ctl.signal)).rejects.toMatchObject({ kind: 'aborted' })
  })
  it('never lets the token out: an error body that echoes the Authorization header is redacted', async () => {
    const c = new McpClient(cfg, { fetch: fakeServer({ echoAuth: true }).fetch })
    const err = await c.listTools().then(() => new Error('expected a failure'), (e: unknown) => e as Error)
    expect(err.message).toContain('[redacted]')
    expect(err.message).not.toContain(TOKEN)
  })
  it('refuses unsafe configs: plain http (except localhost), credentials in the url, bad ids', () => {
    expect(invalidServerReason({ id: 'a', url: 'http://evil.example.com/mcp' })).toMatch(/https/)
    expect(invalidServerReason({ id: 'a', url: 'http://localhost:3000/mcp' })).toBeNull()
    expect(invalidServerReason({ id: 'a', url: 'https://u:p@x.example.com' })).toMatch(/credentials/)
    expect(invalidServerReason({ id: 'Bad Id', url: 'https://x.example.com' })).toMatch(/id/)
    expect(() => new McpClient({ id: 'a', url: 'ftp://x' })).toThrow()
  })
  it('parses SSE blocks with multi-line data', () => {
    expect(parseSseMessages('data: {"a":\ndata: 1}\n\n: ping\n\ndata: [1]\n\n')).toEqual([{ a: 1 }, [1]])
  })
  it('redact leaves text alone when there is no real secret', () => {
    expect(redact('abc', undefined)).toBe('abc')
    expect(redact('x ab y', 'ab')).toBe('x ab y')
  })
})

describe('MCP registry: tools appear namespaced, and run through one path', () => {
  it('names are mcp__<server>__<tool>, cleaned, capped at 64 and still unique', () => {
    expect(mcpToolName('wx', 'send email!')).toBe('mcp__wx__send_email')
    const long = mcpToolName('server', 'x'.repeat(80))
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long).not.toBe(mcpToolName('server', 'x'.repeat(81)))
    expect(isMcpToolName('mcp__wx__get_weather')).toBe(true)
    expect(isMcpToolName('github_read_file')).toBe(false)
  })
  it('maps the JSON Schema to ForgeClaw params: nullable types, enums, arrays, objects; drops required keys that do not exist', () => {
    const def = toToolDef('wx', { name: 'get_weather', description: 'Weather', inputSchema: { type: 'object', properties: { city: { type: 'string' }, units: { type: 'string', enum: ['c', 'f'] }, days: { type: ['integer', 'null'] }, tags: { type: 'array' }, opts: { type: 'object' } }, required: ['city', 'ghost'] } }, 'Weather')
    expect(def.description.startsWith('[MCP · Weather]')).toBe(true)
    expect(def.parameters.required).toEqual(['city'])
    expect(def.parameters.properties.days.type).toBe('integer')
    expect(def.parameters.properties.units.enum).toEqual(['c', 'f'])
    expect(def.parameters.properties.tags.items).toEqual({ type: 'string' })
    expect(def.parameters.properties.opts.description).toContain('JSON object')
  })
  it('refresh discovers tools; execute returns text in the app convention; errors are [TOOL ERROR] and redacted', async () => {
    const reg = new McpRegistry([cfg], { fetch: fakeServer().fetch })
    expect(await reg.refresh()).toEqual([{ serverId: 'wx', tools: 2, error: null }])
    expect(reg.toolDefs().map(d => d.name)).toEqual(['mcp__wx__get_weather', 'mcp__wx__send_email'])
    expect(reg.isReadOnly('mcp__wx__get_weather')).toBe(true)
    expect(reg.isReadOnly('mcp__wx__send_email')).toBe(false) // no hint = not read-only
    expect(await reg.execute({ id: '1', name: 'mcp__wx__get_weather', input: { city: 'Tulsa' } })).toBe('Sunny in Tulsa\n[image: image/png, 3 bytes]')
    const err = await reg.execute({ id: '2', name: 'mcp__wx__send_email', input: { to: 'x' } })
    expect(err.startsWith('[TOOL ERROR]')).toBe(true)
    expect(err).not.toContain(TOKEN)
    expect(await reg.execute({ id: '3', name: 'mcp__wx__nope', input: {} })).toMatch(/not a known MCP tool/)
  })
  it('one failing server never hides another server\'s tools; disabled servers are skipped', async () => {
    const good = fakeServer().fetch
    const fetch: FetchLike = (url, init) => url.includes('down') ? Promise.reject(new Error('ECONNREFUSED')) : good(url, init)
    const reg = new McpRegistry([cfg, { id: 'down', url: 'https://down.example.com/mcp' }, { id: 'off', url: 'https://off.example.com', enabled: false }], { fetch })
    const report = await reg.refresh()
    expect(report.find(r => r.serverId === 'wx')).toMatchObject({ tools: 2, error: null })
    expect(report.find(r => r.serverId === 'down')!.error).toMatch(/ECONNREFUSED/)
    expect(report.find(r => r.serverId === 'off')).toBeUndefined()
    expect(reg.toolDefs()).toHaveLength(2)
  })
  it('server configs round-trip through storage and invalid lists are refused whole', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }
    expect(saveMcpServers([cfg], storage)).toBeNull()
    expect(loadMcpServers(storage)).toEqual([cfg])
    expect(saveMcpServers([cfg, cfg], storage)).toMatch(/duplicate/)
    expect(saveMcpServers([{ id: 'x', url: 'http://plain.example.com' }], storage)).toMatch(/https/)
    expect(loadMcpServers(storage)).toEqual([cfg]) // a refused save changes nothing
    expect(loadMcpServers(null)).toEqual([])
  })
  it('long results are truncated with a marker; structured-only results are shown as JSON', () => {
    expect(formatCallResult({ content: [{ type: 'text', text: 'x'.repeat(25_000) }] })).toMatch(/\[truncated: 5000 more characters\]$/)
    expect(formatCallResult({ structuredContent: { ok: 1 } })).toBe('{"ok":1}')
    expect(formatCallResult({})).toBe('(the tool returned no content)')
  })
})
