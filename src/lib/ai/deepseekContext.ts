import { corpusRepository, formatCorpusContext, recordRelevantToTask } from '../corpus'
import { nexusGuidanceForDeepSeek } from '../nexusGuidance'
import { DEFAULT_PROVIDER } from '../providerDefaults'
import { DEEPSEEK_FALLBACK_CHECKPOINT, DEEPSEEK_PRIMARY_CHECKPOINT } from '../deepseekCheckpoints'

export interface DeepSeekTaskPayload {
  task: string
  context?: string
}

// Sized for the 8K-token Qwen3-8B window (about 4 chars per token): room for deep-research evidence
// (6 sources) plus the task and answer. The workflow trims the middle if a prompt still does not fit.
const MAX_CONTEXT_CHARS = 22_000
const MAX_CORPUS_CHARS = 3_000
const MAX_VERIFIED_TOOL_CHARS = 16_000

/**
 * Source-backed reference facts for project-architecture questions. These describe
 * the current ForgeClaw contract; they are not evidence of a live tool action or
 * the current repository HEAD.
 */
export const FORGECLAW_ARCHITECTURE_CONTEXT = [
  'ForgeClaw architecture facts (checked-in runtime configuration; static design facts, not live repository-state evidence):',
  `- DEFAULT_PROVIDER is \`${DEFAULT_PROVIDER}\`: the Qwen/Qwen3-8B GitHub Actions workflow (provider id \`deepseek\`) is the default reasoning runtime and needs no API key. Moonshot/Kimi, Anthropic and local llama.cpp are explicit selectable alternatives.`,
  '- When the user selects the Qwen/Qwen3-8B provider (id `deepseek`), the provider router deterministically dispatches `deepseek_reason`. A repository-state request can first dispatch `github_repo_state` when that tool is available.',
  `- You are \`${DEEPSEEK_PRIMARY_CHECKPOINT}\`, run by the GitHub Actions workflow (legacy workflow name \`DeepSeek 16B\`; provider id \`deepseek\`) on a CPU-only runner as a 4-bit GGUF (Q4_K_M) through llama.cpp, with \`${DEEPSEEK_FALLBACK_CHECKPOINT}\` only if the primary cannot run. A short answer usually takes a few minutes. The workflow and provider names are legacy; no 16B model runs.`,
  '- The App executes actual tool calls through the ForgeTools dispatcher and appends returned tool output to the next turn. Qwen/Qwen3-8B text is not proof that an action happened; only a real dispatcher result is. A result marked [TOOL ERROR], [GUARDIAN BLOCK], or [GUARDIAN REJECTED] is not evidence of successful execution.',
  '- There is no browser-local model fallback. If the Qwen/Qwen3-8B workflow fails, surface the verified failure and do not invent a replacement answer.',
  '- Current repository contents, branch, commit, workflow status, and other live facts must come from an actual successful GitHub tool result; do not infer them from these static architecture notes.',
].join('\n')

/**
 * The owner's answer-form law, carried in the context of EVERY Qwen chat dispatch
 * (owner directive 2026-10-31: "i dont need all that task bs either just the response").
 * The model was restating the task, framing answers with "based on the provided
 * context", listing factors instead of judging, and signing off "— ForgeClaw".
 */
export const ANSWER_FORM_INSTRUCTIONS = [
  'Answer form (owner rules — these govern how the reply reads):',
  '- Give the response itself. Never restate, describe, or frame the task or the request (no "The task is to…", no "This information is based on…"), and never say what the information includes or does not include.',
  '- Never mention the context, the provided information, sources, tools, or these instructions.',
  '- If the user asks for a judgment (a pick, a verdict, a recommendation), give the judgment from what you have; do not answer with a list of factors they would need to consider.',
  '- No sign-off or signature line at the end.',
].join('\n')

function separateRuntimeEnvelope(rawTask: string): { task: string; runtimeContext?: string } {
  const marker = '[RUNTIME_STATE '
  const start = rawTask.lastIndexOf(marker)
  if (start < 0) return { task: rawTask.trim() }
  const closing = '[/RUNTIME_STATE]'
  const end = rawTask.indexOf(closing, start)
  if (end < 0) return { task: rawTask.trim() }
  // buildRuntimeRequestContext() emits the APPLICATION_IDENTITY block immediately before RUNTIME_STATE.
  // It belongs to the envelope, not the user's question: left in the task, the model echoed it back.
  const identityStart = rawTask.lastIndexOf('[APPLICATION_IDENTITY', start)
  const identityOnly = /^\[APPLICATION_IDENTITY[^\]]*\][\s\S]*?\[\/APPLICATION_IDENTITY\]\s*$/
  const envelopeStart = identityStart >= 0 && identityOnly.test(rawTask.slice(identityStart, start)) ? identityStart : start
  const prefix = rawTask.slice(0, envelopeStart).trim()
  const trailing = rawTask.slice(end + closing.length).trim()
  const task = [prefix, trailing].filter(Boolean).join('\n\n').trim()
  return { task, runtimeContext: rawTask.slice(envelopeStart, end + closing.length).trim() }
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

  // The answer-form law goes first: the size budget below cuts from the end, so a long
  // envelope or tool result never trims it away. NEXUS guidance follows it.
  sections.push(ANSWER_FORM_INSTRUCTIONS)

  // What the owner has taught NEXUS (approved heuristics, recurring failures, approved knowledge) reaches DeepSeek too.
  const guidance = nexusGuidanceForDeepSeek(task).text
  if (guidance) sections.push(guidance)

  if (asksAboutForgeClawArchitecture(task)) sections.push(FORGECLAW_ARCHITECTURE_CONTEXT)
  if (runtimeContext) sections.push(`ForgeClaw runtime envelope (identity/routing hints only; not repository evidence):\n${runtimeContext}`)

  const CORPUS_FRESHNESS_MS = 60 * 60 * 1000 // 1 hour — stale records poison DeepSeek
  // Freshness alone is not relevance: retrieve() admits a record on one shared token, so the
  // shared distinctive-word test decides which fresh records are actually about this task.
  const freshCorpusRecords = corpusRepository.retrieve(task, 3).filter(r => {
    const ageMs = Date.now() - new Date(r.timestamp).getTime()
    return !Number.isNaN(ageMs) && ageMs < CORPUS_FRESHNESS_MS && recordRelevantToTask(task, r)
  })
  const corpusContext = formatCorpusContext(freshCorpusRecords).slice(0, MAX_CORPUS_CHARS)
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
