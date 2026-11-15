// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Keep a long tool loop lean ──────────────────────────────────────────────────────────────────
// Every tool result stays in the conversation and is sent again on every later step of the run, so one 40,000-character
// log or research dump early on is paid for on each of the following requests. Older results of bulky tools that can be
// fetched again are cut to their head with a note; file contents are never cut, because a rewrite needs the whole file.

import type { AIMessage } from './ai/types'

/** Tools whose results are large, re-fetchable evidence. github_read_file is deliberately absent. */
export const COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'github_get_run_logs', 'deep_research', 'web_search', 'error_report', 'shell_exec', 'browser_run', 'github_search_code', 'github_get_run_status',
])

export interface CompactionOptions {
  /** Tool rounds (assistant turns with tool calls) at the end that stay whole. */
  keepRecentRounds?: number
  /** A result longer than this is cut. */
  maxChars?: number
  /** Characters kept from the start of a cut result. */
  headChars?: number
}

/** A copy of `messages` with older bulky tool results cut. The input is not modified; nothing is removed or reordered. */
export function compactToolHistory(messages: AIMessage[], options: CompactionOptions = {}): AIMessage[] {
  const keepRecentRounds = options.keepRecentRounds ?? 2
  const maxChars = options.maxChars ?? 4_000
  const headChars = Math.min(options.headChars ?? 3_000, maxChars)
  const rounds = messages.map((m, i) => (m.role === 'assistant' && m.tool_calls?.length ? i : -1)).filter(i => i >= 0)
  if (rounds.length <= keepRecentRounds) return messages
  const cutoff = rounds[rounds.length - keepRecentRounds]
  const toolName = new Map<string, string>()
  for (const m of messages) for (const call of m.tool_calls ?? []) toolName.set(call.id, call.name)
  return messages.map((m, i) => {
    if (i >= cutoff || m.role !== 'tool' || !m.tool_call_id || m.content.length <= maxChars) return m
    const name = toolName.get(m.tool_call_id) ?? ''
    if (!COMPACTABLE_TOOLS.has(name)) return m
    return { ...m, content: `${m.content.slice(0, headChars)}\n…[older ${name} result cut from ${m.content.length} characters to keep the run lean; call ${name} again if you need the rest]` }
  })
}
