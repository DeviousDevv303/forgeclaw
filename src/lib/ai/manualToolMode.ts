// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Manual Tool Mode ───────────────────────────────────────────────────────
// For providers/models that don't support native tool calling (e.g. OpenRouter free).
// Injects tool schema into system prompt and parses structured output.

import type { ToolDef } from '../../lib/forgeTools'

export interface ManualToolAction {
  toolName: string
  params: Record<string, unknown>
  rawOutput: string
}

const TOOL_PATTERN = /TOOL:\s*(\w+)\s*\((.*)\)/s

/**
 * Inject tool descriptions into system prompt for manual mode.
 */
export function injectToolSchema(systemPrompt: string, tools: ToolDef[]): string {
  if (!tools.length) return systemPrompt

  const toolDescriptions = tools.map(t => {
    const params = Object.entries(t.parameters.properties)
      .map(([key, p]) => {
        const param = p as { type: string; description: string }
        return `  - ${key}: ${param.type} — ${param.description}`
      })
      .join('\n')
    return `- ${t.name}: ${t.description}\n${params}`
  }).join('\n\n')

  return `${systemPrompt}

You have access to these tools:
${toolDescriptions}

When you need to use a tool, respond ONLY with:
TOOL: tool_name({"param": "value"})

No other text before or after the TOOL: line.`
}

/**
 * Parse response text for manual tool calls.
 */
export function parseManualToolCalls(text: string): ManualToolAction[] {
  const actions: ManualToolAction[] = []
  const matches = text.matchAll(new RegExp(TOOL_PATTERN, 'g'))

  for (const match of matches) {
    const [, toolName, argsStr] = match
    try {
      const params = JSON.parse(argsStr.trim()) as Record<string, unknown>
      actions.push({ toolName, params, rawOutput: match[0] })
    } catch {
      // Invalid JSON in params — skip this match
      console.warn('Failed to parse manual tool params:', argsStr)
    }
  }

  return actions
}

/**
 * Convert manual tool actions to ToolCall format for the orchestrator.
 */
export function toToolCalls(actions: ManualToolAction[]): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return actions.map((a, i) => ({
    id: `manual_${i}_${Date.now()}`,
    name: a.toolName,
    input: a.params,
  }))
}

/**
 * Strip manual tool syntax from response text for display.
 */
export function stripToolSyntax(text: string): string {
  return text.replace(new RegExp(TOOL_PATTERN, 'g'), '').trim()
}

/**
 * Render manual tool action for UI display.
 */
export function renderManualToolAction(action: ManualToolAction, toolDef?: ToolDef): string {
  const params = Object.entries(action.params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')

  return `[MANUAL TOOL: ${action.toolName}]
Parameters: ${params}

${toolDef ? `Description: ${toolDef.description}` : ''}

Copy and run this command, or paste the result below.`
}
