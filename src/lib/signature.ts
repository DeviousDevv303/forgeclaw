// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/** Every completed chat answer ends with this line (Cristian, 2026-10-19). */
export const FORGECLAW_SIGNATURE = '— Nexus Intelligence'

/** Signatures from before the 2026-10-24 rename: a stored reply signed with one is not signed again. */
const EARLIER_SIGNATURES = ['— ForgeClaw', '-- ForgeClaw', '- ForgeClaw', '-- Nexus Intelligence', '- Nexus Intelligence']

/**
 * Appended in code rather than asked of the model: DeepSeek answers never see ForgeClaw's system
 * prompt, and a prompt rule can be ignored. A reply the model already signed is left as is.
 */
export function withForgeClawSignature(text: string): string {
  const body = text.trimEnd()
  if (!body) return text
  const lastLine = body.split('\n').pop()?.trim() ?? ''
  if (lastLine === FORGECLAW_SIGNATURE || EARLIER_SIGNATURES.includes(lastLine)) return body
  return `${body}\n\n${FORGECLAW_SIGNATURE}`
}
