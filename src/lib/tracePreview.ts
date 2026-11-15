// ForgeClaw - Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
/** Labels the app itself writes into a trace (phase, plan, tools, scaffold sections). A line that starts with one is safe to show on the closed bar. */
const SYSTEM_TRACE_LABELS = /^(?:Phase|Plan|Tools|Execution steps|Objective|Constraints|Next action|Execution|Verification):/

/** What the closed bar shows. A provider's own reasoning text (Kimi reasoning_content, often cut mid-sentence) must not leak into the chat as a preview. */
export function tracePreview(lines: string[], lineCount: (n: number) => string, ready: string): string {
  if (!lines.length) return ready
  return SYSTEM_TRACE_LABELS.test(lines[0].trim()) ? lines[0] : lineCount(lines.length)
}
