const DIRECT_QWEN_COMMAND = /^\s*\/qwen(?:\s+([\s\S]*))?\s*$/i

export interface DirectQwenCommand {
  matched: true
  question: string
}

/** Parse only a whole-message /qwen command; ordinary slash-containing text is untouched. */
export function parseDirectQwenCommand(text: string): DirectQwenCommand | null {
  const match = text.match(DIRECT_QWEN_COMMAND)
  if (!match) return null
  return { matched: true, question: (match[1] ?? '').trim() }
}

const QWEN_FAST_PATH_KEYWORDS = [
  'design', 'architecture', 'analyze', 'analyse', 'review', 'explain', 'compare',
  'debug', 'investigate', 'refactor', 'migration plan', 'tradeoffs', 'trade-offs',
]

/** Complex requests can dispatch to the Qwen workflow without a local-model routing turn. */
export function shouldDispatchComplexTaskToQwen(task: string): boolean {
  const normalized = task.toLowerCase()
  return QWEN_FAST_PATH_KEYWORDS.some(keyword => normalized.includes(keyword))
}
