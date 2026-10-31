// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── DeepSeek self-sculpt: deterministic chain ───────────────────────────────
// DeepSeek has no tool loop, so "improve <file>" runs a fixed chain from this turn's real tool results:
// read the file -> rewrite it (deepseek_reason, code profile) -> sculpt_self (build-validated PR) -> report.
// The model never sees a partial file: a file github_read_file had to truncate is refused, because a
// rewrite of a truncated file would delete its tail.

const SCULPT_INTENT_RE = /\b(sculpt|self[- ]?improve|improve yourself|upgrade yourself|modify yourself|self[- ]?modify|evolve yourself|refactor yourself)\b/i
const PATH_RE = /(?:^|[\s`'"(])((?:src|docs|public|test|tests|nexus|database)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+|README\.md)\b/

/** The repository file a self-sculpt request names, or null when it is not one. */
export function sculptTarget(text: string): string | null {
  if (!SCULPT_INTENT_RE.test(text)) return null
  return PATH_RE.exec(text)?.[1] ?? null
}

const DEEPSEEK_SCULPT_MAX_CHARS = 8_000
const TOO_LARGE = 'the file is larger than 8,000 characters, too large for DeepSeek to rewrite whole in its 8K context. Use Kimi or Claude, which can propose a shell_patch diff.'

/** File body from a github_read_file result, or an error when it was truncated or unreadable. */
export function readFileBody(output: string): { content: string } | { error: string } {
  if (/^\s*\[(?:TOOL ERROR|GUARDIAN)/i.test(output)) return { error: output.slice(0, 300) }
  if (/\n\[truncated\]\n```\s*$/.test(output)) return { error: TOO_LARGE }
  const m = /^File: .*\n```\n([\s\S]*)\n```\s*$/.exec(output)
  if (!m) return { error: 'could not read the file content from the tool result' }
  // Reads now return up to 20,000 characters whole; DeepSeek's 8K context still cannot rewrite that much.
  if (m[1].length > DEEPSEEK_SCULPT_MAX_CHARS) return { error: TOO_LARGE }
  return { content: m[1] }
}

export function sculptTask(request: string, path: string, content: string): string {
  return `Edit the ForgeClaw source file ${path} to do this:\n${request.trim()}\n\nCurrent content of ${path}:\n\`\`\`\n${content}\n\`\`\`\n\n` +
    'Return the COMPLETE updated file in one fenced code block. Keep every line that the change does not need to touch exactly as it is.'
}

/** The rewritten file, or why it must not be proposed. */
export function extractRewrittenFile(reply: string, original: string): { content: string } | { error: string } {
  const blocks = [...reply.matchAll(/```[A-Za-z0-9_+-]*\n([\s\S]*?)```/g)].map(m => m[1])
  const content = (blocks.sort((a, b) => b.length - a.length)[0] ?? '').replace(/\s+$/, '\n')
  if (!content.trim()) return { error: 'DeepSeek did not return the file in a code block' }
  if (content.trim() === original.trim()) return { error: 'Qwen/Qwen3-8B returned the file unchanged' }
  if (content.length < original.length * 0.5) return { error: `Qwen/Qwen3-8B returned ${content.length} characters for a ${original.length}-character file, which looks like an incomplete rewrite` }
  if (/\b(?:rest of (?:the )?(?:file|code) (?:unchanged|remains)|\.\.\. ?(?:existing|unchanged) code)\b/i.test(content)) return { error: 'DeepSeek left a placeholder instead of the complete file' }
  return { content }
}
