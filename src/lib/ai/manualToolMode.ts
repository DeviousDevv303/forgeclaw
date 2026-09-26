// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Manual Tool Mode ───────────────────────────────────────────────────────
// Disabled intentionally: normal chat must not turn model text into a second
// execution request or inject the tool catalog into the prompt.

import type { ToolDef } from '../../lib/forgeTools'

export interface ManualToolAction {
  toolName: string
  params: Record<string, unknown>
  rawOutput: string
}

// NORMAL CHAT MODE: do not inject tool descriptions into any provider prompt.
export function injectToolSchema(systemPrompt: string, _tools: ToolDef[]): string {
  void _tools
  return systemPrompt
}

// NORMAL CHAT MODE: model text is always ordinary answer text, never a tool call.
export function parseManualToolCalls(_text: string): ManualToolAction[] {
  void _text
  return []
}

export function toToolCalls(actions: ManualToolAction[]): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return actions.map((a, i) => ({ id: `manual_${i}_${Date.now()}`, name: a.toolName, input: a.params }))
}

export function stripToolSyntax(text: string): string {
  return text
}

export function renderManualToolAction(action: ManualToolAction, toolDef?: ToolDef): string {
  const params = Object.entries(action.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
  return `[MANUAL TOOL DISABLED: ${action.toolName}]\nParameters: ${params}\n\n${toolDef ? `Description: ${toolDef.description}` : ''}`
}
