// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Phase B (owner-authorized protected-path change, forgeclaw#372): MCP tools run only through executeTool(), after
// the Guardian check, and the co-sign rule treats an external tool as able to act unless it is explicitly read-only.
import { afterEach, describe, expect, it } from 'vitest'
import { executeTool, loadToolContext } from '../forgeTools'
import { requiresCoSign } from '../guardianGate'
import { McpRegistry } from './mcpRegistry'
import { mcpToolsForMessage, setMcpRegistry } from './mcpRuntime'
import type { FetchLike } from './mcpClient'

function server(calls: string[]): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    let result: unknown = {}
    if (body.method === 'initialize') result = { protocolVersion: '2025-06-18' }
    if (body.method === 'tools/list') result = { tools: [
      { name: 'lookup', description: 'Read a record', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
      { name: 'delete_record', description: 'Delete a record', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    ] }
    if (body.method === 'tools/call') { calls.push(body.params!.name!); result = { content: [{ type: 'text', text: `ran ${body.params!.name}` }] } }
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
}

async function installRegistry(calls: string[]) {
  const reg = new McpRegistry([{ id: 'crm', label: 'Records', url: 'https://crm.example.com/mcp' }], { fetch: server(calls) })
  await reg.refresh()
  setMcpRegistry(reg)
  return reg
}

afterEach(() => setMcpRegistry(null))

describe('MCP tools run only through executeTool, behind the Guardian', () => {
  it('autonomous posture (the owner default) is unchanged: MCP tools run without co-sign, only merges co-sign', async () => {
    await installRegistry([])
    expect(requiresCoSign({ id: '1', name: 'mcp__crm__delete_record', input: {} }, 'autonomous')).toBe(false)
    expect(requiresCoSign({ id: '1', name: 'github_merge_pr', input: {} }, 'autonomous')).toBe(true)
  })
  it('operator-shell and full-cosign: an MCP tool that may act is co-signed; an explicitly read-only one is not', async () => {
    await installRegistry([])
    for (const posture of ['operator-shell', 'full-cosign'] as const) {
      expect(requiresCoSign({ id: '1', name: 'mcp__crm__delete_record', input: {} }, posture)).toBe(true)
      expect(requiresCoSign({ id: '1', name: 'mcp__crm__lookup', input: {} }, posture)).toBe(false)
    }
  })
  it('an unknown MCP tool name is treated as able to act (co-signed), never as read-only', () => {
    setMcpRegistry(new McpRegistry([]))
    expect(requiresCoSign({ id: '1', name: 'mcp__ghost__anything', input: {} }, 'full-cosign')).toBe(true)
  })
  it('executeTool dispatches a read-only MCP tool to its server and returns its text', async () => {
    const calls: string[] = []
    await installRegistry(calls)
    const out = await executeTool({ id: 'x', name: 'mcp__crm__lookup', input: { q: 'a' } }, { ...loadToolContext(), guardianPosture: 'full-cosign' })
    expect(out).toBe('ran lookup')
    expect(calls).toEqual(['lookup'])
  })
  it('the Guardian runs BEFORE dispatch: a co-signed MCP tool with no approval handler never reaches the server', async () => {
    const calls: string[] = []
    await installRegistry(calls)
    const out = await executeTool({ id: 'x', name: 'mcp__crm__delete_record', input: { id: '7' } }, { ...loadToolContext(), guardianPosture: 'full-cosign', requestGuardianApproval: undefined })
    expect(out).toMatch(/^\[GUARDIAN BLOCK\]/)
    expect(calls).toEqual([])
  })
  it('a rejected co-sign never reaches the server; an approved one does', async () => {
    const calls: string[] = []
    await installRegistry(calls)
    const ctx = { ...loadToolContext(), guardianPosture: 'full-cosign' as const }
    expect(await executeTool({ id: 'x', name: 'mcp__crm__delete_record', input: {} }, { ...ctx, requestGuardianApproval: async () => false })).toMatch(/^\[GUARDIAN REJECTED\]/)
    expect(calls).toEqual([])
    expect(await executeTool({ id: 'y', name: 'mcp__crm__delete_record', input: {} }, { ...ctx, requestGuardianApproval: async () => true })).toBe('ran delete_record')
    expect(calls).toEqual(['delete_record'])
  })
})

describe('which MCP tools a message is offered', () => {
  it('none for ordinary chat; a server\'s tools when the message names it (id or label); all when it says MCP', async () => {
    const reg = await installRegistry([])
    expect(mcpToolsForMessage('what is the weather', reg)).toEqual([])
    expect(mcpToolsForMessage('look this up in crm', reg).map(t => t.name)).toEqual(['mcp__crm__lookup', 'mcp__crm__delete_record'])
    expect(mcpToolsForMessage('check the records server', reg)).toHaveLength(2)
    expect(mcpToolsForMessage('use an mcp tool for this', reg)).toHaveLength(2)
    expect(mcpToolsForMessage('mcpx is not a word here', reg)).toEqual([])
  })
})
