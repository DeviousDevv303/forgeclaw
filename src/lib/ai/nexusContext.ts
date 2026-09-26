import type { AIMessage } from './types'

export type NexusMessage = { role: 'user' | 'assistant'; content: string }

/** WebLLM has no tool role; represent dispatcher results as user continuations. */
export function adaptNexusMessages(messages: AIMessage[]): NexusMessage[] {
  return messages.map(message => ({
    role: message.role === 'tool' ? 'user' : message.role,
    content: message.role === 'tool'
      ? `[TOOL RESULT ${message.tool_call_id || 'unknown'}]\n${message.content}`
      : message.content,
  }))
}

/** Hard upper bound for the browser-local NEXUS prompt budget. */
export const MAX_NEXUS_CONTEXT_TOKENS = 4096

/**
 * UTF-8 byte count is a conservative token upper bound: byte-level tokenizers
 * cannot produce more tokens than input bytes. This avoids character-count
 * truncation and remains safe before the model-specific tokenizer is loaded.
 */
export function conservativeTokenCount(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function takePrefixByBudget(value: string, budget: number): string {
  if (conservativeTokenCount(value) <= budget) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (conservativeTokenCount(value.slice(0, middle)) <= budget) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

/**
 * Preserve the system instruction and newest conversation messages while
 * enforcing a hard, conservative prompt budget. Older messages are dropped
 * whole before any remaining message is prefix-truncated.
 */
export function limitNexusContext(
  systemPrompt: string,
  messages: AIMessage[],
  maxTokens = MAX_NEXUS_CONTEXT_TOKENS,
): { systemPrompt: string; messages: AIMessage[]; tokenCount: number } {
  const safeBudget = Math.max(1, Math.floor(maxTokens))
  // Never spend the whole budget on the system prompt. WebLLM requires the
  // final conversation turn to be user/tool; dropping a fresh "hello" here
  // produced: "Last message should be from either user or tool."
  const latest = messages[messages.length - 1]
  const latestCost = latest ? Math.min(safeBudget - 1, Math.max(1, conservativeTokenCount(latest.content))) : 0
  const boundedSystem = takePrefixByBudget(systemPrompt, Math.max(1, safeBudget - latestCost))
  let used = conservativeTokenCount(boundedSystem)
  const selected: AIMessage[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const cost = conservativeTokenCount(message.content)
    if (used + cost <= safeBudget) {
      selected.unshift(message)
      used += cost
      continue
    }
    const remaining = safeBudget - used
    if (remaining > 0) {
      selected.unshift({ ...message, content: takePrefixByBudget(message.content, remaining) })
      used = safeBudget
    }
    break
  }

  return { systemPrompt: boundedSystem, messages: selected, tokenCount: used }
}
