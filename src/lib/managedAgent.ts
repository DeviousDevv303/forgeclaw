// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { ToolDef, ToolCall, ToolContext } from './forgeTools'
import { executeTool } from './forgeTools'
import { callProvider } from './modelProviders'
import type { ProviderId } from './modelProviders'

// ─── Sub-agent runner ─────────────────────────────────────────────────────────
// Runs a mini agentic loop (max 8 iterations) with a custom system prompt.
// Used by the spawn_agent tool so ForgeMind can delegate complex subtasks.

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

  type Msg = { role: 'user' | 'assistant'; content: unknown }
  const messages: Msg[] = [{ role: 'user', content: task }]
  const MAX_ITERS = 8

  for (let i = 0; i < MAX_ITERS; i++) {
    const isLast = i === MAX_ITERS - 1
    const result = await callProvider(provider, model, systemPrompt, messages as Parameters<typeof callProvider>[3], apiKey, {
      tools: isLast ? undefined : tools,
    })

    if (!result.toolCalls?.length) {
      return result.text || '(no response)'
    }

    const iterResults = await Promise.all(
      result.toolCalls.map(async (tc: ToolCall) => ({
        toolCallId: tc.id,
        name: tc.name,
        output: await executeTool(tc, toolCtx),
      }))
    )

    if (provider === 'anthropic') {
      messages.push({
        role: 'assistant',
        content: [
          ...(result.text ? [{ type: 'text', text: result.text }] : []),
          ...result.toolCalls.map((tc: ToolCall) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })),
        ],
      })
      messages.push({
        role: 'user',
        content: iterResults.map(r => ({ type: 'tool_result', tool_use_id: r.toolCallId, content: r.output })),
      })
    } else {
      messages.push({ role: 'assistant', content: result.text || '' })
      for (const r of iterResults) {
        messages.push({ role: 'user', content: `[Tool: ${r.name}] ${r.output}` })
      }
    }
  }

  return '(sub-agent reached iteration limit)'
}

// ─── Managed Agent session API ────────────────────────────────────────────────

const BASE = 'https://api.anthropic.com/v1'

const betaHeaders = (apiKey: string) => ({
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'x-api-key': apiKey,
  'anthropic-dangerous-direct-browser-access': 'true',
})

export async function createManagedSession(agentId: string, apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: betaHeaders(apiKey),
    body: JSON.stringify({ agent_id: agentId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
  const data = await res.json() as { id: string }
  return data.id
}

export async function sendManagedMessage(sessionId: string, message: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: betaHeaders(apiKey),
    body: JSON.stringify({ role: 'user', content: message }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
}

export async function streamManagedSession(
  sessionId: string,
  apiKey: string,
  onToken: (chunk: string) => void,
  onDone: () => void,
): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/events/stream`, {
    headers: { ...betaHeaders(apiKey), Accept: 'text/event-stream' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Anthropic ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') { onDone(); return }
        try {
          const evt = JSON.parse(raw) as {
            type?: string
            delta?: { type?: string; text?: string }
            content_block?: { type?: string; text?: string }
          }
          // content_block_delta: streaming text token
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            onToken(evt.delta.text)
          }
          // message_stop: stream finished
          if (evt.type === 'message_stop') { onDone(); return }
        } catch { /* skip malformed lines */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  onDone()
}
