// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Read a repository file whole, or in pages ──────────────────────────────────────────────────
// github_read_file returned the first 8,000 characters of any file with a bare "[truncated]" and no way to read the
// rest, so a model working on a larger file saw part of it. It also decoded the base64 with atob alone, which reads the
// bytes as Latin-1: every "—" or "→" in ForgeClaw's own sources came back as mojibake, and a rewrite from that read
// would have corrupted them. Files now decode as UTF-8 and larger ones come in pages of whole lines.

/** A file up to this many characters is returned whole; larger ones in pages of about this size. */
export const READ_PAGE_CHARS = 20_000

/** UTF-8 text from GitHub's base64 file content (which contains line breaks). */
export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
}

/**
 * The github_read_file result. A whole file keeps the long-standing shape (`File: path (N bytes)` and a fence), which
 * the DeepSeek and /sculpt chains parse. A page says which lines it holds and how to get the next one, and ends with
 * "[truncated]" so a chain that needs the whole file refuses it instead of rewriting part of it.
 */
export function formatFileRead(path: string, size: number | undefined, text: string, startLine = 1): string {
  const bytes = size ?? new TextEncoder().encode(text).length
  if (startLine <= 1 && text.length <= READ_PAGE_CHARS) return `File: ${path} (${bytes} bytes)\n\`\`\`\n${text}\n\`\`\``
  const lines = text.split('\n')
  const total = lines.length
  const first = Math.max(1, Math.floor(startLine))
  if (first > total) throw new Error(`start_line ${first} is past the end of ${path}, which has ${total} lines.`)
  let end = first - 1
  let chars = 0
  // Whole lines only; at least one line, even if it alone is longer than a page.
  while (end < total && (end === first - 1 || chars + lines[end].length + 1 <= READ_PAGE_CHARS)) {
    chars += lines[end].length + 1
    end += 1
  }
  const page = lines.slice(first - 1, end).join('\n')
  const next = end < total ? ` · next: call github_read_file with start_line ${end + 1}` : ' · end of file'
  const header = `File: ${path} (${bytes} bytes) · lines ${first}–${end} of ${total}${next}`
  return `${header}\n\`\`\`\n${page}${end < total || first > 1 ? '\n[truncated]' : ''}\n\`\`\``
}
