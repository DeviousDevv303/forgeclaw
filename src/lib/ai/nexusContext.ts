import type { AIMessage } from './types'

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
  const boundedSystem = takePrefixByBudget(systemPrompt, safeBudget)
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
