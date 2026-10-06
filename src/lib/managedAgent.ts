// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { ToolCall, ToolContext, ToolDef } from './forgeTools'
import { executeTool } from './forgeTools'
import { callProvider, modelSupportsTools } from './modelProviders'
import type { ChatMessage, ProviderId } from './modelProviders'
import {
  injectToolSchemaWithinBudget,
  parseManualToolCalls,
  stripToolSyntax,
  toToolCalls,
} from './ai/manualToolMode'
import { boundPrefixByBudget, conservativeTokenCount } from './ai/nexusContext'

// ─── Agent capability profiles ───────────────────────────────────────────────
// The runtime — not an agent's system prompt — decides which tools an agent may
// reach. A saved agent is filtered here before any tool description is handed to
// a provider, so a prompt that claims extra authority gains nothing.

export type AgentCapability = 'chat' | 'coding-readonly' | 'coding'

/** Tools that change repository state, spend external quota, or execute code. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'github_write_file',
  'github_create_issue',
  'github_run_workflow',
  'shell_exec',
  'send_whatsapp',
  'gmail_send',
  'calendar_create',
])

/**
 * Priority order for repository work, highest value first. Order matters: a
 * browser-local provider has a small prompt budget, so the tools that establish
 * repository truth must be offered before optional ones. Inspection and
 * verification precede writes, which is also the safe sequence for a change.
 */
export const CODING_TOOL_ORDER: readonly string[] = [
  'deepseek_reason',
  'ask_deepseek',
  'github_repo_state',
  'github_read_file',
  'github_list_files',
  'github_search_code',
  'github_verify_commit',
  'github_write_file',
  'github_create_issue',
  'github_run_workflow',
  'github_get_run_status',
  'github_get_run_logs',
  'coding_task_update',
]

/** Repository inspection only: read, verify, and task-state persistence. */
export const CODING_READONLY_TOOL_NAMES: readonly string[] =
  CODING_TOOL_ORDER.filter(name => !WRITE_TOOL_NAMES.has(name))

export const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  chat: 'Chat (no tools)',
  'coding-readonly': 'Repository read-only',
  coding: 'Repository read + authorized writes',
}

/**
 * Resolve the tool set a capability grants. `chat` deliberately exposes nothing.
 * `coding` is the read set plus the write tools that already exist, so writes keep
 * flowing through the dispatcher's Guardian gate rather than a parallel path.
 */
export function toolsForCapability(
  capability: AgentCapability,
  allTools: ToolDef[],
  allowedToolNames?: string[],
): ToolDef[] {
  if (capability === 'chat') return []
  const base = capability === 'coding'
    ? [...CODING_TOOL_ORDER]
    : [...CODING_READONLY_TOOL_NAMES]
  const permitted = new Set(allowedToolNames && allowedToolNames.length ? allowedToolNames : base)
  const byName = new Map(allTools.map(tool => [tool.name, tool]))
  const selected = base.flatMap(name => {
    const tool = byName.get(name)
    return tool && permitted.has(name) ? [tool] : []
  })
  // A caller may only ever narrow the capability, never widen it.
  return capability === 'coding' ? selected : selected.filter(tool => !WRITE_TOOL_NAMES.has(tool.name))
}

// ─── Browser-local context budget ────────────────────────────────────────────
// Non-native providers here are the browser-local WebGPU runtimes, which carry a
// hard, small prompt budget. The tool catalog and the task are budgeted against it
// so the provider's own limiter cannot silently truncate the tool instructions
// away and leave the model believing it has no hands.

/** Bytes reserved for the tool catalog, including the explicit protocol guard. */
const TOOL_CATALOG_RESERVE = 2000
/** Bytes reserved for the task/instruction turn this call adds. */
export const SUB_AGENT_TASK_RESERVE = 1024
/** Total system-prompt allowance for a budgeted provider. */
export const SUB_AGENT_SYSTEM_RESERVE = TOOL_CATALOG_RESERVE + 1024

export interface SubAgentBudgetReport {
  nativeTools: boolean
  catalogTools: string[]
  unavailableTools: string[]
  taskBytes: number
}

export interface SubAgentOptions {
  /** Resolved capability profile. Defaults to the caller-supplied tool list. */
  capability?: AgentCapability
  /** Called with the factual budget decision so the UI can report it honestly. */
  onBudget?: (report: SubAgentBudgetReport) => void
  /**
   * Provider transport seam. Production callers omit this and get `callProvider`.
   * Overriding it swaps only the transport; capability filtering, prompt
   * budgeting, manual-tool parsing, dispatch and Guardian behavior are identical,
   * so a test exercises the real routing decision rather than a copy of it.
   */
  callProviderFn?: typeof callProvider
}

// Runs a bounded sub-agent loop through ForgeClaw's active provider runtime.
export async function runSubAgent(
  systemPrompt: string,
  task: string,
  allowedTools: string[] | undefined,
  provider: ProviderId,
  model: string,
  apiKey: string,
  allTools: ToolDef[],
  toolCtx: ToolContext,
  options: SubAgentOptions = {},
): Promise<string> {
  const capability = options.capability
  const tools = capability
    ? toolsForCapability(capability, allTools, allowedTools)
    : allowedTools
      ? allTools.filter(t => allowedTools.includes(t.name))
      : allTools

  const supportsNativeTools = modelSupportsTools(provider, model)

  // Budgeted path applies to the browser-local runtimes that lack native tools.
  const budgeted = !supportsNativeTools

  let effectiveSystemPrompt = systemPrompt
  let effectiveTask = task
  let catalogTools: string[] = []
  let unavailableTools: string[] = []

  if (budgeted) {
    // The agent's own prose is capped first so the tool catalog keeps its reserve;
    // otherwise a long saved prompt would evict every tool definition.
    const prose = boundPrefixByBudget(systemPrompt, Math.max(1, SUB_AGENT_SYSTEM_RESERVE - TOOL_CATALOG_RESERVE))
    const injected = injectToolSchemaWithinBudget(prose, tools, SUB_AGENT_SYSTEM_RESERVE)
    effectiveSystemPrompt = injected.systemPrompt
    catalogTools = injected.included
    unavailableTools = injected.omitted
    // The newest turn must fit beside the system prompt or the provider limiter
    // would spend the whole budget on it and drop the catalog.
    effectiveTask = boundPrefixByBudget(task, SUB_AGENT_TASK_RESERVE)
  } else {
    catalogTools = tools.map(tool => tool.name)
  }

  options.onBudget?.({
    nativeTools: supportsNativeTools,
    catalogTools,
    unavailableTools,
    taskBytes: conservativeTokenCount(effectiveTask),
  })

  const messages: ChatMessage[] = [{ role: 'user', content: effectiveTask }]
  const maxIters = 8
  const sendToProvider = options.callProviderFn ?? callProvider

  for (let i = 0; i < maxIters; i++) {
    if (toolCtx.signal?.aborted) return '[SUB-AGENT ABORTED]'
    const isLast = i === maxIters - 1
    const result = await sendToProvider(provider, model, effectiveSystemPrompt, messages, apiKey, {
      tools: isLast || !supportsNativeTools ? undefined : tools,
      signal: toolCtx.signal,
    })

    let text = result.text || ''
    let calls: ToolCall[] = result.toolCalls ?? []

    // Providers without native function calling emit the manual tool-call syntax
    // instead, so parse it here rather than ending the run with a description of
    // the work the model wanted to do.
    if (!supportsNativeTools && !calls.length && text) {
      const actions = parseManualToolCalls(text)
      if (actions.length) {
        calls = toToolCalls(actions)
        text = stripToolSyntax(text)
      }
    }

    if (!calls.length) {
      return budgeted ? stripToolSyntax(text) || '(no response)' : text || '(no response)'
    }

    const iterResults = await Promise.all(
      calls.map(async (tc: ToolCall) => ({
        toolCallId: tc.id,
        output: await executeTool(tc, toolCtx),
      })),
    )

    messages.push({
      role: 'assistant',
      content: text,
      tool_calls: calls.map((tc: ToolCall) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    })

    for (const r of iterResults) {
      messages.push({
        role: 'tool',
        content: r.output,
        tool_call_id: r.toolCallId,
      })
    }
  }

  return '(sub-agent reached iteration limit)'
}
