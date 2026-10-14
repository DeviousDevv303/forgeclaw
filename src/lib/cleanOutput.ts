// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { stripRuntimeEnvelopes } from './canonicalIdentity'

/**
 * Strip markdown decoration and internal scaffolding from assistant text for display.
 * Fenced code blocks are preserved verbatim. Identifiers (snake_case names, paths,
 * issue numbers, arrows) are evidence the operator relies on and are never altered.
 */
export function cleanOutput(text: string): string {
  // Preserve fenced code blocks — extract them, clean the rest, reinsert
  const codeBlocks: string[] = []
  const placeholderPrefix = String.fromCharCode(0)
  const codePlaceholderPattern = new RegExp(`${placeholderPrefix}CODE(\\d+)${placeholderPrefix}`, 'g')
  const withPlaceholders = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `${placeholderPrefix}CODE${codeBlocks.length - 1}${placeholderPrefix}`
  })
  const cleaned = withPlaceholders
    .replace(/\[FM:[A-Z_0-9]+\][\s\S]*?\[FM:[A-Z_0-9]+_END\]/gi, '')
    .replace(/\[FM:(THINK|TRACE)\][\s\S]*/i, '')
    .replace(/\[FM:[A-Z_0-9]+\]/gi, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/\*+/g, '')
    // Headings only at line start, so "#12" and "C#" survive.
    .replace(/^#{1,6}\s+/gm, '')
    // Strip emphasis delimiters only at word boundaries; snake_case identifiers,
    // tool names, and file paths must reach the reader unchanged.
    .replace(/(^|[^A-Za-z0-9_])(_{1,2})([^_\n]+?)\2(?![A-Za-z0-9_]|\.[A-Za-z0-9])/g, '$1$3')
    .replace(/^-{3,}\s*$/gm, '')
    // Blockquote markers only at line start, so "=>", "->" and comparisons survive.
    .replace(/^>\s?/gm, '')
    .replace(/`[^`]+`/g, (m) => m.replace(/`/g, ''))  // inline code only
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return stripRuntimeEnvelopes(cleaned.replace(codePlaceholderPattern, (_, i) => codeBlocks[parseInt(i)]))
}
