// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Manual Tool Mode ───────────────────────────────────────────────────────
// For providers without native function-calling (NEXUS/Corpus Browser WebGPU).
// Injects a compact tool schema into the system prompt and parses
// model-emitted tool call blocks so the App agent loop can execute them.

import type { ToolDef } from '../../lib/forgeTools'
import { conservativeTokenCount } from './nexusContext'

export interface ManualToolAction {
  toolName: string
  params: Record<string, unknown>
  rawOutput: string
}

/**
 * The tool-call contract stated to a model that has no native function calling.
 * Kept as one constant so every injection site states the same protocol.
 */
export const MANUAL_TOOL_INSTRUCTIONS = `When you need to call a tool, emit EXACTLY this format (one block per call):
\`\`\`tool_call
{"name":"tool_name","arguments":{"param":"value"}}
\`\`\`

After tool results are returned, continue until STATUS: COMPLETE or STATUS: BLOCKED.
Never claim a GitHub write/read succeeded without an actual tool result.
Do not invent tool results.`

const MANUAL_TOOL_HEADER = 'AVAILABLE TOOLS (you MUST use them to act; do not only describe actions):'

/** Full parameter listing, one line per parameter. */
function describeToolVerbose(tool: ToolDef): string {
  const params = Object.entries(tool.parameters.properties)
    .map(([k, p]) => `  ${k}${tool.parameters.required.includes(k) ? '*' : ''}: ${p.type} — ${p.description}`)
    .join('\n')
  return `- ${tool.name}: ${tool.description}\n${params}`
}

/** One line per tool. Same callable contract, a fraction of the bytes. */
function describeToolCompact(tool: ToolDef): string {
  const params = Object.entries(tool.parameters.properties)
    .map(([k, p]) => `${k}${tool.parameters.required.includes(k) ? '*' : ''}:${p.type}`)
    .join(' ')
  return `${tool.name}(${params}) — ${tool.description}`
}

/** Inject a compact tool catalog so non-native models know how to call tools. */
export function injectToolSchema(systemPrompt: string, tools: ToolDef[]): string {
  if (!tools.length) return systemPrompt
  const catalog = tools.map(describeToolVerbose).join('\n\n')
  return `${systemPrompt}

${MANUAL_TOOL_HEADER}
${catalog}

${MANUAL_TOOL_INSTRUCTIONS}`
}

/**
 * Inject the tool catalog without exceeding a hard prompt budget.
 *
 * A browser-local WebGPU model has a small, hard context budget, and the full
 * 24-tool registry does not fit inside it: measured at 8054 bytes against a
 * 4096-byte budget. Injecting it anyway let the provider's context limiter
 * truncate the catalog away, so the model was never told that tools existed and
 * answered by asking the operator for repository contents instead of reading it.
 *
 * Tools are offered in registry order (highest-value repository read first) and
 * rendered one line each. Tools that do not fit are named as unavailable so the
 * model reports a real limitation instead of inventing an action.
 */
export function injectToolSchemaWithinBudget(
  systemPrompt: string,
  tools: ToolDef[],
  budgetBytes: number,
): { systemPrompt: string; included: string[]; omitted: string[] } {
  if (!tools.length) return { systemPrompt, included: [], omitted: [] }

  const notice = (omittedNames: string[], omittedCount: number): string => {
    if (!omittedCount) return ''
    return omittedNames.length
      ? `\n\nNOT AVAILABLE IN THIS RUNTIME (do not attempt these; report the limitation): ${omittedNames.join(', ')}`
      : `\n\n${omittedCount} additional tool(s) are NOT AVAILABLE in this runtime (report the limitation).`
  }

  const render = (included: ToolDef[], omittedNames: string[], omittedCount: number): string =>
    `${systemPrompt}\n\n${MANUAL_TOOL_HEADER}\n${included.map(describeToolCompact).join('\n')}` +
    `${notice(omittedNames, omittedCount)}\n\n${MANUAL_TOOL_INSTRUCTIONS}`

  let included: ToolDef[] = []
  let omitted: ToolDef[] = []
  for (const tool of tools) {
    const trial = render([...included, tool], omitted.map(t => t.name), omitted.length)
    if (conservativeTokenCount(trial) <= budgetBytes) included.push(tool)
    else omitted.push(tool)
  }

  // The unavailable-tools notice is the lowest-value content, so shrink its name
  // list (never the protocol) until the whole block fits the budget.
  let names = omitted.map(t => t.name)
  let output = render(included, names, omitted.length)
  while (conservativeTokenCount(output) > budgetBytes && names.length) {
    names = names.slice(0, -1)
    output = render(included, names, omitted.length)
  }

  // Last resort: if a bare count still overflows, withdraw trailing tools. The
  // protocol statement and the highest-priority tools are kept; the budget is a
  // hard contract because exceeding it means the provider limiter truncates the
  // catalog and the model loses its tools entirely.
  while (conservativeTokenCount(output) > budgetBytes && included.length) {
    omitted = [included[included.length - 1], ...omitted]
    included = included.slice(0, -1)
    output = render(included, [], omitted.length)
  }

  return { systemPrompt: output, included: included.map(t => t.name), omitted: omitted.map(t => t.name) }
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
