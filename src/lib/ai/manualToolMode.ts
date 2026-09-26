// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Manual Tool Mode ───────────────────────────────────────────────────────
// For providers without native function-calling (NEXUS/Corpus Browser WebGPU).
// Injects a compact tool schema into the system prompt and parses
// model-emitted tool call blocks so the App agent loop can execute them.

import type { ToolDef } from '../../lib/forgeTools'

export interface ManualToolAction {
  toolName: string
  params: Record<string, unknown>
  rawOutput: string
}

/** Inject a compact tool catalog so non-native models know how to call tools. */
export function injectToolSchema(systemPrompt: string, tools: ToolDef[]): string {
  if (!tools.length) return systemPrompt
  const catalog = tools
    .map(t => {
      const params = Object.entries(t.parameters.properties)
        .map(([k, p]) => `  ${k}${t.parameters.required.includes(k) ? '*' : ''}: ${p.type} — ${p.description}`)
        .join('\n')
      return `- ${t.name}: ${t.description}\n${params}`
    })
    .join('\n\n')

  return `${systemPrompt}

AVAILABLE TOOLS (you MUST use them to act; do not only describe actions):
${catalog}

When you need to call a tool, emit EXACTLY this format (one block per call):
\`\`\`tool_call
{"name":"tool_name","arguments":{"param":"value"}}
\`\`\`

After tool results are returned, continue until STATUS: COMPLETE or STATUS: BLOCKED.
Never claim a GitHub write/read succeeded without an actual tool result.
Do not invent tool results.`
}

/** Parse model text for manual tool call blocks. */
export function parseManualToolCalls(text: string): ManualToolAction[] {
  if (!text) return []
  const actions: ManualToolAction[] = []

  // Format A: ```tool_call\n{json}\n```
  const fenceRe = /```tool_call\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    try {
      const body = m[1].trim()
      const parsed = JSON.parse(body) as { name?: string; arguments?: Record<string, unknown>; input?: Record<string, unknown> }
      if (parsed.name) {
        actions.push({
          toolName: parsed.name,
          params: parsed.arguments || parsed.input || {},
          rawOutput: m[0],
        })
      }
    } catch {
      // skip malformed
    }
  }

  // Format B: TOOL_CALL: name\n{json}
  const lineRe = /TOOL_CALL:\s*([a-zA-Z0-9_]+)\s*\n(\{[\s\S]*?\})/gi
  while ((m = lineRe.exec(text)) !== null) {
    try {
      const params = JSON.parse(m[2]) as Record<string, unknown>
      actions.push({ toolName: m[1], params, rawOutput: m[0] })
    } catch {
      // skip
    }
  }

  // Format C: <tool_call name="...">...</tool_call>
  const xmlRe = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi
  while ((m = xmlRe.exec(text)) !== null) {
    try {
      const params = JSON.parse(m[2].trim()) as Record<string, unknown>
      actions.push({ toolName: m[1], params, rawOutput: m[0] })
    } catch {
      // skip
    }
  }

  return actions
}

export function toToolCalls(
  actions: ManualToolAction[],
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return actions.map((a, i) => ({
    id: `manual_${i}_${Date.now()}`,
    name: a.toolName,
    input: a.params,
  }))
}

export function stripToolSyntax(text: string): string {
  return text
    .replace(/```tool_call\s*\n[\s\S]*?```/gi, '')
    .replace(/TOOL_CALL:\s*[a-zA-Z0-9_]+\s*\n\{[\s\S]*?\}/gi, '')
    .replace(/<tool_call\s+name=["'][^"']+["']\s*>[\s\S]*?<\/tool_call>/gi, '')
    .trim()
}

export function renderManualToolAction(action: ManualToolAction, toolDef?: ToolDef): string {
  const params = Object.entries(action.params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
  return `[MANUAL TOOL: ${action.toolName}]\nParameters: ${params}\n\n${toolDef ? `Description: ${toolDef.description}` : ''}`
}
