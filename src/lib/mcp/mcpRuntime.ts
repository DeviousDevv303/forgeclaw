// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// The one shared MCP registry for this app session. forgeTools.ts dispatches MCP calls through it (after the Guardian
// check), guardianGate.ts asks it whether a tool is read-only, and App.tsx offers its tool definitions to the models.

import { McpRegistry, loadMcpServers } from './mcpRegistry'

let registry: McpRegistry | null = null

export function mcpRegistry(): McpRegistry {
  if (!registry) registry = new McpRegistry(loadMcpServers())
  return registry
}

/** Replace the shared registry (after the server list is saved, or in tests). Null rebuilds it from storage on next use. */
export function setMcpRegistry(next: McpRegistry | null): void {
  registry = next
}

/** Discover every configured server's tools. Never throws: per-server errors come back in the report. */
export async function refreshMcpTools(signal?: AbortSignal) {
  return mcpRegistry().refresh(signal)
}

/** Read-only only when the server explicitly says so (MCP annotations are hints; absence means "may act"). */
export function mcpToolIsReadOnly(name: string): boolean {
  return mcpRegistry().isReadOnly(name)
}

/**
 * The MCP tools to offer the model for this message. Ordinary chat stays free of the tool catalog (local models
 * degrade when a large tool protocol is injected for nothing): a server's tools are offered only when the message
 * names that server (its id or label) or asks for MCP by name.
 */
export function mcpToolsForMessage(messageLower: string, reg: Pick<McpRegistry, 'toolDefsForServers' | 'status'> = mcpRegistry()) {
  const text = messageLower.toLowerCase()
  const wantsAll = /\bmcp\b/.test(text)
  const named = new Set(reg.status()
    .filter(s => wantsAll || text.includes(s.serverId.toLowerCase()) || (!!s.label && text.includes(s.label.toLowerCase())))
    .map(s => s.serverId))
  if (named.size === 0) return []
  return reg.toolDefsForServers(named)
}
