// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { ToolCall, ToolContext, ToolDef } from './forgeTools'
import { executeTool } from './forgeTools'
import { callProvider, modelSupportsTools } from './modelProviders'
import type { ChatMessage, ProviderId } from './modelProviders'

// Runs a bounded sub-agent loop through ForgeClaw's active OpenRouter runtime.
export async function runSubAgent(
  systemPrompt: string,
  task: string,
  allowedTools: string[] | undefined,
  provider: ProviderId,
  model: string,
  apiKey: string,
  allTools: ToolDef[],
  toolCtx: ToolContext,
): Promise<string> {
  const tools = allowedTools
    ? allTools.filter(t => allowedTools.includes(t.name))
    : allTools

  const messages: ChatMessage[] = [{ role: 'user', content: task }]
  const maxIters = 8

  for (let i = 0; i < maxIters; i++) {
    const isLast = i === maxIters - 1
    const result = await callProvider(provider, model, systemPrompt, messages, apiKey, {
      tools: isLast || !modelSupportsTools(provider, model) ? undefined : tools,
    })

    if (!result.toolCalls?.length) {
      return result.text || '(no response)'
    }

    const iterResults = await Promise.all(
      result.toolCalls.map(async (tc: ToolCall) => ({
        toolCallId: tc.id,
        output: await executeTool(tc, toolCtx),
      })),
    )

    messages.push({
      role: 'assistant',
      content: result.text || '',
      tool_calls: result.toolCalls.map((tc: ToolCall) => ({
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
