// ForgeClaw — Nexus Intelligence transport for the sub-agent loop.
// The Nexus provider adapter (providers/nexusProvider) intentionally throws:
// Nexus runs only through the GitHub Actions workflow dispatcher, reached via
// the provider router's Nexus branch (nexus_reason dispatch -> segment parse ->
// app tool call -> re-dispatch). The main chat loop drives that state machine
// through sendViaRouter; saved agents and spawn_agent drove the raw adapter
// instead and died on the throw, so no agent turn under the Nexus provider
// ever dispatched. This adapter gives runSubAgent the router's contract in
// callProvider's shape: the caller supplies the turn's dispatch tool set (the
// agent's tools plus the nexus_reason definition — the router refuses a Nexus
// request whose tools lack nexus_reason), executes whatever calls come back
// under its own allowlist + Guardian path, and appends the results to the
// message history the router reads on the next call.
import type { ToolCall, ToolDef } from '../forgeTools'
import type { CallResult, ChatMessage } from '../modelProviders'
import { sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

export async function callNexusViaRouter(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  apiKey: string,
  options: { signal?: AbortSignal; maxTokens?: number },
  dispatchTools: ToolDef[],
): Promise<CallResult> {
  const request: AIRequest = {
    systemPrompt,
    messages,
    model: model || 'nexus-run25',
    tools: dispatchTools,
    signal: options.signal,
    maxTokens: options.maxTokens,
  }
  const result = await sendViaRouter(request, apiKey, 'nexus-intelligence')
  if (!result.success) throw new Error(result.error.message)
  const { response } = result
  return {
    text: response.text,
    provider: 'nexus-intelligence',
    model: response.model,
    toolCalls: response.toolCalls?.map((tc): ToolCall => ({ id: tc.id, name: tc.name, input: tc.input })),
    stopReason: response.stopReason,
  }
}
