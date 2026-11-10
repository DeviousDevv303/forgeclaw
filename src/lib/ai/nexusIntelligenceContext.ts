// ForgeClaw — Nexus Intelligence (provider id 'nexus-intelligence'): the owner's trained
// Nexus model ALONE — the Run 25 checkpoint, no Qwen, no walk, no NEXUS guidance, no corpus
// context. This module builds what the nexus-intelligence.yml workflow receives and parses
// what one generation segment returns. (Not to be confused with nexusContext.ts, the older
// context limiter for the browser-local managed-agent path.)
//
// The checkpoint is a 4.48M-parameter specialist with a 640-token window (cfg.ctx). It was
// trained on a single-prompt frame ("User: {prompt}\n<|mode:create|>", see nexus-llm
// train/common.py), so a chat is flattened into that prompt: earlier turns first (oldest
// dropped first when the budget bites), the current message last — the same adaptation the
// standalone server (nexus-standalone/server.py) uses. Tool flow keeps the model's own
// grammar: a segment that ends with <|call|>{json}<|/call|> becomes a normal app tool call,
// its result is injected as a <|result:ok|error|> span in the next dispatch's transcript
// prefix, exactly as nexus-llm/train/loop.py drives the closed loop (max 3 calls).

import { extractOriginalQwenTask } from './qwenContext'
import type { AIMessage } from './types'

export const NEXUS_MODEL_ID = 'nexus-run25'
export const NEXUS_MODEL_LABEL = 'Nexus Intelligence · Run 25 checkpoint'
export const NEXUS_CHECKPOINT_SHA256 = 'c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6'
/** loop.py's --max-calls default: the closed loop the checkpoint was graded in. */
export const NEXUS_MAX_CALLS = 3
/**
 * App-side prompt budget in characters (~4 chars/token against the 640-token window,
 * leaving room for the transcript prefix and the 160-token generation reserve). The
 * workflow enforces the token-exact bound as a backstop and reports prompt_trimmed.
 */
export const NEXUS_PROMPT_MAX_CHARS = 1_200
/** Injected tool results are capped for the same window reason; loop sidecar results are short. */
export const NEXUS_RESULT_INJECT_MAX_CHARS = 1_200

export interface NexusTaskPayload {
  task: string
  context?: string
  mode: 'create'
}

/**
 * Flatten a chat into the checkpoint's single prompt: prior turns (user/assistant text,
 * runtime envelopes stripped from user turns) followed by the current task, joined with
 * newlines as the standalone server joins message contents. When the budget bites, lines
 * are dropped from the FRONT — the oldest history goes first, the current task stays.
 */
export function buildNexusPrompt(prior: ReadonlyArray<{ role: string; content: string }>, rawTask: string): string {
  const task = extractOriginalQwenTask(rawTask).trim()
  const lines: string[] = []
  for (const m of prior) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text = (m.role === 'user' ? extractOriginalQwenTask(m.content) : m.content.replace(/\s*[—–-]+\s*ForgeClaw\s*$/i, '')).trim()
    if (text) lines.push(text)
  }
  lines.push(task)
  let prompt = lines.join('\n')
  while (prompt.length > NEXUS_PROMPT_MAX_CHARS && lines.length > 1) {
    lines.shift()
    prompt = lines.join('\n')
  }
  if (prompt.length > NEXUS_PROMPT_MAX_CHARS) prompt = prompt.slice(prompt.length - NEXUS_PROMPT_MAX_CHARS)
  return prompt
}

/**
 * Rebuild this turn's Nexus transcript prefix from the app's own message record: every
 * completed tool call the model emitted (name + arguments, canonical compact JSON) followed
 * by its injected result span. nexus_reason's own results are segments, not transcript —
 * they are skipped; the calls they produced are what the transcript is made of.
 */
export function buildNexusTranscript(turn: ReadonlyArray<AIMessage>): { transcript: string; calls: number } {
  const results = new Map<string, string>()
  for (const m of turn) {
    if (m.role === 'tool' && m.tool_call_id) results.set(m.tool_call_id, m.content)
  }
  let transcript = ''
  let calls = 0
  for (const m of turn) {
    if (m.role !== 'assistant') continue
    for (const call of m.tool_calls ?? []) {
      if (call.name === 'nexus_reason') continue
      const result = results.get(call.id)
      if (result === undefined) continue
      const failed = /^\s*\[(?:TOOL ERROR|GUARDIAN)/i.test(result)
      const body = result.length > NEXUS_RESULT_INJECT_MAX_CHARS ? result.slice(0, NEXUS_RESULT_INJECT_MAX_CHARS) : result
      transcript += `<|route:tool|><|call|>${JSON.stringify({ name: call.name, arguments: call.input ?? {} })}<|/call|>`
      transcript += `<|result:${failed ? 'error' : 'ok'}|>${body}<|/result|>`
      calls++
    }
  }
  return { transcript, calls }
}

export type NexusSegment =
  | { kind: 'call'; name: string; input: Record<string, unknown>; raw: string }
  | { kind: 'answer'; text: string; raw: string }
  | { kind: 'failed'; message: string; raw: string }

const SPECIAL_TOKEN_RE = /<\|\/?[a-z_]+(?::[a-z_]+)?\|>/g

/** Strip the transcript grammar (route/evidence/end tokens) from model text for display. */
export function stripNexusGrammar(text: string): string {
  return text.replace(SPECIAL_TOKEN_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Parse one generation segment exactly as the graded path emits it:
 *   <|route:tool|><|call|>{"name":…,"arguments":{…}}<|/call|>            → a tool call
 *   <|route:direct|><|ev:…|><|answer|>…<|/answer|><|end|>                → a final answer
 *   <|ev:…|><|answer|>…<|/answer|><|end|>  (continuation after a result) → a final answer
 * Anything else with text in it is shown grammar-stripped rather than dropped.
 */
export function parseNexusSegment(segment: string): NexusSegment {
  const raw = segment.trim()
  if (!raw) return { kind: 'failed', message: 'Nexus Intelligence produced an empty segment.', raw }
  const failed = /\[NEXUS RUN FAILED\]\s*(.*)/.exec(raw)
  if (failed) return { kind: 'failed', message: failed[1] || 'The Nexus workflow run failed.', raw }
  const call = /<\|call\|>([\s\S]*?)<\|\/call\|>/.exec(raw)
  if (call) {
    try {
      const parsed = JSON.parse(call[1]) as { name?: unknown; arguments?: unknown }
      if (typeof parsed.name === 'string' && parsed.name) {
        const input = parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
          ? parsed.arguments as Record<string, unknown>
          : {}
        return { kind: 'call', name: parsed.name, input, raw }
      }
    } catch { /* fall through to answer rendering */ }
  }
  const answer = /<\|answer\|>([\s\S]*?)(?:<\|\/answer\|>|$)/.exec(raw)
  if (answer && answer[1].trim()) return { kind: 'answer', text: answer[1].trim(), raw }
  const text = stripNexusGrammar(raw)
  if (text) return { kind: 'answer', text, raw }
  return { kind: 'failed', message: 'Nexus Intelligence produced a segment with no readable answer.', raw }
}
