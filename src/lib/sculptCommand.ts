// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Provider-independent self-sculpt commands ───────────────────────────────
//   /sculpt <file> <what to change>   read -> rewrite with the free workflow model (Qwen3-8B, code
//                                     profile) -> sculpt_self (build-validated pull request)
//   /patch <one-line reason>          followed by a unified diff on the next lines -> shell_patch
// Neither uses the selected chat provider, so both work with Kimi, Claude, DeepSeek or no provider key
// at all. Every step still goes through executeTool (Guardian, co-sign, journal) and the self-sculpt
// key; nothing is merged automatically.

import { extractRewrittenFile, readFileBody, sculptTask } from './ai/deepseekSculpt'
import { isSculptUnlocked, SCULPT_LOCKED_MESSAGE } from './sculptKey'
import type { ToolCall } from './forgeTools'

export type SculptCommand =
  | { kind: 'sculpt'; path: string; instruction: string }
  | { kind: 'patch'; reason: string; patch: string }

const PATH_RE = /^[A-Za-z0-9._/-]+\.[A-Za-z0-9]+$/

/** Parse a whole-message /sculpt or /patch command; null for anything else. */
export function parseSculptCommand(text: string): SculptCommand | null | { kind: 'usage'; message: string } {
  const trimmed = text.trim()
  const sculpt = /^\/sculpt(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (sculpt) {
    const [path = '', ...rest] = (sculpt[1] ?? '').trim().split(/\s+/)
    const instruction = rest.join(' ').trim()
    if (!PATH_RE.test(path) || !instruction) return { kind: 'usage', message: 'Usage: /sculpt <file path> <what to change>, e.g. /sculpt src/lib/elapsed.ts show milliseconds under one second' }
    return { kind: 'sculpt', path, instruction }
  }
  const patch = /^\/patch[ \t]+([^\n]+)\n([\s\S]+)$/i.exec(trimmed)
  if (patch) return { kind: 'patch', reason: patch[1].trim(), patch: `${patch[2].trim()}\n` }
  if (/^\/patch\b/i.test(trimmed)) return { kind: 'usage', message: 'Usage: /patch <one-line reason>, then the unified diff (git diff format) on the following lines.' }
  return null
}

export interface SculptStep { tool: string; output: string }
export interface SculptCommandResult { ok: boolean; text: string; steps: SculptStep[] }

const failed = (output: string) => /^\s*\[(?:TOOL ERROR|GUARDIAN)/i.test(output)

/** Run a parsed command. `run` is executeTool bound to the current tool context. */
export async function runSculptCommand(command: SculptCommand, run: (call: ToolCall) => Promise<string>, unlocked = isSculptUnlocked()): Promise<SculptCommandResult> {
  const steps: SculptStep[] = []
  if (!unlocked) return { ok: false, text: SCULPT_LOCKED_MESSAGE, steps }
  const step = async (name: string, input: Record<string, unknown>) => {
    const output = await run({ id: `cmd-${name}-${Date.now()}`, name, input })
    steps.push({ tool: name, output })
    return output
  }
  if (command.kind === 'patch') {
    const out = await step('shell_patch', { patch: command.patch, reason: command.reason.slice(0, 240) })
    return { ok: !failed(out), text: out, steps }
  }
  const read = await step('github_read_file', { path: command.path })
  const file = readFileBody(read)
  if ('error' in file) return { ok: false, text: `Self-sculpt of ${command.path} stopped before any change: ${file.error}`, steps }
  const rewrite = await step('deepseek_reason', { task: sculptTask(command.instruction, command.path, file.content), profile: 'code', nexus_learn: true })
  if (failed(rewrite) || !rewrite.startsWith('✓ Qwen/Qwen3-8B completed as ')) return { ok: false, text: `The workflow model could not rewrite ${command.path}, so nothing was proposed. ${rewrite.slice(0, 300)}`, steps }
  const next = extractRewrittenFile(rewrite.split('\n\n').slice(1).join('\n\n'), file.content)
  if ('error' in next) return { ok: false, text: `${next.error}, so nothing was proposed for ${command.path}.`, steps }
  const proposed = await step('sculpt_self', { file_path: command.path, content: next.content, reason: `/sculpt ${command.path}: ${command.instruction.replace(/\s+/g, ' ').slice(0, 200)}` })
  return { ok: !failed(proposed), text: proposed, steps }
}
