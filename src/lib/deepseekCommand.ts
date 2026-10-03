const DIRECT_DEEPSEEK_COMMAND = /^\s*\/deepseek(?:\s+([\s\S]*))?\s*$/i

export interface DirectDeepSeekCommand {
  matched: true
  question: string
}

/** Parse only a whole-message /deepseek command; ordinary slash-containing text is untouched. */
export function parseDirectDeepSeekCommand(text: string): DirectDeepSeekCommand | null {
  const match = text.match(DIRECT_DEEPSEEK_COMMAND)
  if (!match) return null
  return { matched: true, question: (match[1] ?? '').trim() }
}

const DEEPSEEK_FAST_PATH_KEYWORDS = [
  'design', 'architecture', 'analyze', 'analyse', 'review', 'explain', 'compare',
  'debug', 'investigate', 'refactor', 'migration plan', 'tradeoffs', 'trade-offs',
]

/** Complex requests can dispatch to the DeepSeek workflow without a local-model routing turn. */
export function shouldDispatchComplexTaskToDeepSeek(task: string): boolean {
  const normalized = task.toLowerCase()
  return DEEPSEEK_FAST_PATH_KEYWORDS.some(keyword => normalized.includes(keyword))
}
