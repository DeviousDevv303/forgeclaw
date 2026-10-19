// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Strips reasoning artifacts from model responses before they reach the user.
 *
 * This is a bounded deterministic detector targeting structural markers —
 * NOT a word blacklist. It removes:
 * 1. <think>...</think> blocks (DeepSeek-R1 style reasoning wrappers)
 * 2. Leading "Reasoning:"/"Analysis:" labeled blocks
 * 3. The deepseek_reason tool result header (✓ DeepSeek-16B completed...)
 *
 * It does NOT strip English phrases like "I need to" or "Let me check" —
 * those appear in legitimate responses and must be preserved.
 */

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const LABELED_BLOCK_RE = /^(?:reasoning|analysis|thought process|internal monologue):\s*\n([\s\S]*?)(?=\n\n|\n[A-Z#])/gim;
const TOOL_HEADER_RE = /^✓ DeepSeek-16B completed as [^\n]*\n\n/;
// Application identity blocks that leak from the prompt into model output
const APP_IDENTITY_RE = /\[APPLICATION_IDENTITY[\s\S]*?\[\/APPLICATION_IDENTITY\]/gi;
const APP_IDENTITY_FRAGMENT_RE = /^What's the state of the POLYMARKET\s*\[APPLICATION_IDENTITY[^\]]*\]?/gim;

export function stripReasoningArtifacts(response: string): string {
  let cleaned = response;

  // 1. Remove <think> blocks (structural, unambiguous)
  cleaned = cleaned.replace(THINK_BLOCK_RE, '');

  // 2. Remove labeled reasoning blocks at the start
  cleaned = cleaned.replace(LABELED_BLOCK_RE, '');

  // 3. Remove the tool result header
  cleaned = cleaned.replace(TOOL_HEADER_RE, '');

  // 4. Remove leaked application identity blocks
  cleaned = cleaned.replace(APP_IDENTITY_RE, '');
  cleaned = cleaned.replace(APP_IDENTITY_FRAGMENT_RE, '');

  // Collapse excessive blank lines left behind, trim
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
