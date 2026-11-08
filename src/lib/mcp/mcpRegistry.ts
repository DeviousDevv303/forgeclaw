// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// MCP registry: which servers are configured, which tools they offer, and how those tools appear to the models.
// Tool names are namespaced mcp__<server>__<tool> so an MCP tool can never shadow a built-in ForgeClaw tool.
//
// AUTHORITY: nothing here executes on its own. executeMcpTool() is meant to be called ONLY from executeTool() in
// forgeTools.ts, after its Guardian co-sign check, so MCP tools pass through exactly the gates every other tool does
// (the Founder's Principle: one authority path). Until that hook exists, MCP tools are discoverable but not runnable.

import type { ToolCall, ToolDef, ToolParam } from '../forgeTools'
import { McpClient, McpError, invalidServerReason, redact, type FetchLike, type McpCallResult, type McpServerConfig, type McpTool } from './mcpClient'

export const MCP_STORAGE_KEY = 'forgeclaw_mcp_servers'
export const MCP_TOOL_PREFIX = 'mcp__'
/** Provider limit on tool names: the hosted model APIs cap tool names at 64 characters. */
const MAX_TOOL_NAME = 64
const MAX_RESULT_CHARS = 20_000

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const defaultStorage = (): StorageLike | null => (typeof localStorage !== 'undefined' ? localStorage : null)

export function loadMcpServers(storage: StorageLike | null = defaultStorage()): McpServerConfig[] {
  if (!storage) return []
  try {
    const raw = JSON.parse(storage.getItem(MCP_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((s): s is McpServerConfig => !!s && typeof s === 'object' && typeof (s as McpServerConfig).id === 'string' && typeof (s as McpServerConfig).url === 'string')
  } catch { return [] }
}

/** Save the server list. Refuses (returns the reason) when any entry is invalid or ids collide. */
export function saveMcpServers(servers: McpServerConfig[], storage: StorageLike | null = defaultStorage()): string | null {
  const ids = new Set<string>()
  for (const s of servers) {
    const bad = invalidServerReason(s)
    if (bad) return `${s.id || '(no id)'}: ${bad}`
    if (ids.has(s.id)) return `${s.id}: duplicate id`
    ids.add(s.id)
  }
  if (!storage) return 'no storage available'
  storage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers))
  return null
}

/** A deterministic short hash, so a truncated name stays unique and stable across sessions. */
function shortHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36).slice(0, 6)
}

/** The model-facing name for a server's tool: mcp__<server>__<tool>, [a-z0-9_] only, at most 64 chars. */
export function mcpToolName(serverId: string, toolName: string): string {
  const clean = (x: string) => x.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const full = `${MCP_TOOL_PREFIX}${clean(serverId)}__${clean(toolName) || 'tool'}`
  if (full.length <= MAX_TOOL_NAME) return full
  const suffix = `_${shortHash(`${serverId}/${toolName}`)}`
  return full.slice(0, MAX_TOOL_NAME - suffix.length) + suffix
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

/** JSON Schema property -> ForgeClaw ToolParam (the subset every provider accepts). */
function toParam(name: string, schema: unknown): ToolParam {
  const s = (schema && typeof schema === 'object' ? schema : {}) as Record<string, unknown>
  const rawType = Array.isArray(s.type) ? (s.type as unknown[]).find(t => t !== 'null') : s.type
  const type = typeof rawType === 'string' && JSON_TYPES.has(rawType) ? rawType : 'string'
  const desc = typeof s.description === 'string' && s.description.trim() ? s.description : name
  const p: ToolParam = { type, description: type === 'object' ? `${desc} (a JSON object)` : desc }
  if (Array.isArray(s.enum) && s.enum.every(v => typeof v === 'string')) p.enum = s.enum as string[]
  if (type === 'array') p.items = (s.items && typeof s.items === 'object' ? s.items : { type: 'string' }) as Record<string, unknown>
  return p
}

export function toToolDef(serverId: string, tool: McpTool, serverLabel?: string): ToolDef {
  const props = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>
  const properties: Record<string, ToolParam> = {}
  for (const [k, v] of Object.entries(props)) properties[k] = toParam(k, v)
  const required = (tool.inputSchema?.required ?? []).filter(r => r in properties)
  const what = tool.description?.trim() || tool.title || tool.annotations?.title || tool.name
  return {
    name: mcpToolName(serverId, tool.name),
    description: `[MCP · ${serverLabel || serverId}] ${what}`.slice(0, 1024),
    parameters: { type: 'object', properties, required },
  }
}

interface Entry { serverId: string; toolName: string; tool: McpTool; def: ToolDef }
interface ServerState { config: McpServerConfig; client: McpClient; error: string | null; refreshedAt: number | null }

export interface McpRegistryOptions { fetch?: FetchLike; timeoutMs?: number; now?: () => number }

/** In-memory view of the configured servers and their discovered tools. */
export class McpRegistry {
  private servers = new Map<string, ServerState>()
  private tools = new Map<string, Entry>()
  private readonly opts: McpRegistryOptions

  constructor(configs: McpServerConfig[], opts: McpRegistryOptions = {}) {
    this.opts = opts
    for (const c of configs) {
      if (c.enabled === false) continue
      try { this.servers.set(c.id, { config: c, client: new McpClient(c, opts), error: null, refreshedAt: null }) }
      catch (e) { this.servers.set(c.id, { config: c, client: null as unknown as McpClient, error: e instanceof Error ? e.message : String(e), refreshedAt: null }) }
    }
  }

  /** Re-list every server's tools. One server failing never hides another's tools. */
  async refresh(signal?: AbortSignal): Promise<{ serverId: string; tools: number; error: string | null }[]> {
    const report: { serverId: string; tools: number; error: string | null }[] = []
    await Promise.all([...this.servers.values()].map(async st => {
      if (!st.client) { report.push({ serverId: st.config.id, tools: 0, error: st.error }); return }
      for (const [k, e] of this.tools) if (e.serverId === st.config.id) this.tools.delete(k)
      try {
        const list = await st.client.listTools(signal)
        for (const t of list) {
          const def = toToolDef(st.config.id, t, st.config.label)
          if (this.tools.has(def.name)) continue // first wins; a collision is reported by count, never shadowed
          this.tools.set(def.name, { serverId: st.config.id, toolName: t.name, tool: t, def })
        }
        st.error = null
        st.refreshedAt = (this.opts.now ?? Date.now)()
        report.push({ serverId: st.config.id, tools: list.length, error: null })
      } catch (e) {
        st.error = redact(e instanceof Error ? e.message : String(e), st.config.token)
        report.push({ serverId: st.config.id, tools: 0, error: st.error })
      }
    }))
    return report.sort((a, b) => a.serverId.localeCompare(b.serverId))
  }

  toolDefs(): ToolDef[] { return [...this.tools.values()].map(e => e.def) }

  /** The tool definitions offered by the given servers only. */
  toolDefsForServers(serverIds: ReadonlySet<string>): ToolDef[] { return [...this.tools.values()].filter(e => serverIds.has(e.serverId)).map(e => e.def) }

  has(name: string): boolean { return this.tools.has(name) }

  /** Per MCP spec annotations are hints from the server; only an explicit readOnlyHint counts as read-only. */
  isReadOnly(name: string): boolean { return this.tools.get(name)?.tool.annotations?.readOnlyHint === true }

  /** Run a discovered tool. Returns text in ForgeClaw's tool-result convention ([TOOL ERROR] on failure). */
  async execute(call: ToolCall, signal?: AbortSignal): Promise<string> {
    const entry = this.tools.get(call.name)
    if (!entry) return `[TOOL ERROR] ${call.name} is not a known MCP tool (refresh the MCP servers, or the server no longer offers it).`
    const st = this.servers.get(entry.serverId)!
    try {
      const result = await st.client.callTool(entry.toolName, call.input ?? {}, signal)
      return formatCallResult(result, st.config.token)
    } catch (e) {
      const kind = e instanceof McpError ? e.kind : 'transport'
      return `[TOOL ERROR] MCP ${entry.serverId}/${entry.toolName} (${kind}): ${redact(e instanceof Error ? e.message : String(e), st.config.token)}`
    }
  }

  status(): { serverId: string; label?: string; url: string; tools: number; error: string | null; refreshedAt: number | null }[] {
    return [...this.servers.values()].map(st => ({
      serverId: st.config.id, label: st.config.label, url: st.config.url,
      tools: [...this.tools.values()].filter(e => e.serverId === st.config.id).length, error: st.error, refreshedAt: st.refreshedAt,
    }))
  }
}

export function formatCallResult(result: McpCallResult, secret?: string): string {
  const parts: string[] = []
  for (const c of result.content ?? []) {
    const block = c as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image' || block.type === 'audio') parts.push(`[${block.type}: ${block.mimeType ?? 'unknown type'}, ${typeof block.data === 'string' ? Math.floor(block.data.length * 3 / 4) : 0} bytes]`)
    else if (block.type === 'resource') {
      const r = (block.resource ?? {}) as { uri?: string; text?: string }
      parts.push(typeof r.text === 'string' ? r.text : `[resource ${r.uri ?? ''}]`)
    } else if (block.type === 'resource_link') parts.push(`[link ${block.name ?? ''} ${block.uri ?? ''}]`.replace(/\s+/g, ' '))
    else parts.push(`[${String(block.type)} content]`)
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent))
  let text = redact(parts.join('\n'), secret) || '(the tool returned no content)'
  if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ${text.length - MAX_RESULT_CHARS} more characters]`
  return result.isError ? `[TOOL ERROR] ${text}` : text
}
