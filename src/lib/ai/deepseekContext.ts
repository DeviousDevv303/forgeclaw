import { corpusRepository, formatCorpusContext } from '../corpus'

export interface DeepSeekTaskPayload {
  task: string
  context?: string
}

const MAX_CONTEXT_CHARS = 12_000
const MAX_CORPUS_CHARS = 3_000
const MAX_VERIFIED_TOOL_CHARS = 8_000

/**
 * Source-backed reference facts for project-architecture questions. These describe
 * the current ForgeClaw contract; they are not evidence of a live tool action or
 * the current repository HEAD.
 */
export const FORGECLAW_ARCHITECTURE_CONTEXT = [
  'ForgeClaw architecture facts (checked-in runtime configuration; static design facts, not live repository-state evidence):',
  '- DEFAULT_PROVIDER is `corpus`; CORPUS retrieves only approved local corpus records and delegates local synthesis to NEXUS WebGPU.',
  '- For CORPUS/NEXUS requests, the provider router deterministically dispatches `deepseek_reason` as the primary reasoning step. A repository-state request can first dispatch `github_repo_state` when that tool is available.',
  '- The GitHub Actions workflow named `DeepSeek 16B` currently runs the public `deepseek-ai/deepseek-coder-6.7b-instruct` checkpoint; it falls back to the public 1.3B checkpoint only if the primary cannot load or run. The workflow name is legacy; neither checkpoint is a 16B model.',
  '- The App executes actual tool calls through the ForgeTools dispatcher and appends returned tool output to the next turn. DeepSeek text is not proof that an action happened; only a real dispatcher result is. A result marked [TOOL ERROR], [GUARDIAN BLOCK], or [GUARDIAN REJECTED] is not evidence of successful execution.',
  '- Qwen2.5 WebGPU is the local secondary synthesis/fallback (3B default, 1.5B fallback), not the primary reasoner. NEXUS has no native tool authority. If both Qwen attempts fail after a real DeepSeek result, the router returns that actual DeepSeek result rather than inventing a replacement.',
  '- Current repository contents, branch, commit, workflow status, and other live facts must come from an actual successful GitHub tool result; do not infer them from these static architecture notes.',
].join('\n')

function separateRuntimeEnvelope(rawTask: string): { task: string; runtimeContext?: string } {
  const marker = '[RUNTIME_STATE '
  const start = rawTask.lastIndexOf(marker)
  if (start < 0) return { task: rawTask.trim() }
  const closing = '[/RUNTIME_STATE]'
  const end = rawTask.indexOf(closing, start)
  if (end < 0) return { task: rawTask.trim() }
  const prefix = rawTask.slice(0, start).trim()
  const trailing = rawTask.slice(end + closing.length).trim()
  const task = [prefix, trailing].filter(Boolean).join('\n\n').trim()
  return { task, runtimeContext: rawTask.slice(start, end + closing.length).trim() }
}

/** Extract only the user's textual objective, excluding appended runtime/image payloads. */
export function extractOriginalDeepSeekTask(rawTask: string): string {
  const { task } = separateRuntimeEnvelope(rawTask)
  const imageMarker = '\n\n[IMAGE_ATTACHMENT]\n'
  const imageStart = task.indexOf(imageMarker)
  return (imageStart >= 0 ? `${task.slice(0, imageStart).trim()}\n[An image attachment was present; its data payload is not included in this text-only fallback.]` : task).trim()
}

function asksAboutForgeClawArchitecture(task: string): boolean {
  return /\bforgeclaw\b|\bdefault reasoning (?:flow|path)\b|\bprimary reason(?:er|ing)\b|\bsecondary synthesis\b/i.test(task)
}

/**
 * Keep the exact user objective separate from relevant context. Only approved
 * CORPUS records are selected; live GitHub/tool facts remain explicitly labelled.
 */
export function buildDeepSeekTaskPayload(rawTask: string, verifiedToolResults = ''): DeepSeekTaskPayload {
  const { task, runtimeContext } = separateRuntimeEnvelope(rawTask)
  const sections: string[] = []

  if (asksAboutForgeClawArchitecture(task)) sections.push(FORGECLAW_ARCHITECTURE_CONTEXT)
  if (runtimeContext) sections.push(`ForgeClaw runtime envelope (identity/routing hints only; not repository evidence):\n${runtimeContext}`)

  const corpusContext = formatCorpusContext(corpusRepository.retrieve(task, 3)).slice(0, MAX_CORPUS_CHARS)
  if (corpusContext) sections.push(`Approved CORPUS context retrieved for this task (informational, not tool authorization):\n${corpusContext}`)

  const boundedToolResults = verifiedToolResults.trim().slice(-MAX_VERIFIED_TOOL_CHARS)
  if (boundedToolResults) sections.push(`Actual ForgeTools results from this turn (the only evidence of actions performed):\n${boundedToolResults}`)

  if (!sections.length) return { task }
  const toolSection = boundedToolResults
    ? `Actual ForgeTools results from this turn (the only evidence of actions performed):\n${boundedToolResults}`
    : ''
  const nonToolSections = sections.filter(section => !section.startsWith('Actual ForgeTools results from this turn'))
  const toolBudget = toolSection ? Math.min(toolSection.length, MAX_VERIFIED_TOOL_CHARS + 100) : 0
  const prefixBudget = Math.max(0, MAX_CONTEXT_CHARS - toolBudget - (toolSection ? 2 : 0))
  const context = [nonToolSections.join('\n\n').slice(0, prefixBudget), toolSection]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_CONTEXT_CHARS)
  return { task, context }
}
