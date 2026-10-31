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
 * 3. The deepseek_reason tool result header (✓ Qwen/Qwen3-8B completed...)
 *
 * It does NOT strip English phrases like "I need to" or "Let me check" —
 * those appear in legitimate responses and must be preserved.
 */

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const LABELED_BLOCK_RE = /^(?:reasoning|analysis|thought process|internal monologue):\s*\n([\s\S]*?)(?=\n\n|\n[A-Z#])/gim;
const TOOL_HEADER_RE = /^✓ Qwen\/Qwen3-8B completed as [^\n]*\n\n/;
// Application identity blocks that leak from the prompt into model output
const APP_IDENTITY_RE = /\[APPLICATION_IDENTITY[\s\S]*?\[\/APPLICATION_IDENTITY\]/gi;
const APP_IDENTITY_FRAGMENT_RE = /^What's the state of the POLYMARKET\s*\[APPLICATION_IDENTITY[^\]]*\]?/gim;
// A lone envelope tag with no matching close. The model echoes it with its spaces removed
// ([APPLICATION_IDENTITYapplication="ForgeClaw"...]), sometimes opened with "(" or as [END RUNTIME_STATE],
// at the start or end of an answer. Strip only the tag so real answer text around it survives.
// Seen in 29 of the stored DeepSeek results.
const ENVELOPE_TAG_RE = /[[(](?:\/|END\s+)?(?:APPLICATION_?IDENTITY|RUNTIME_?STATE)[^\])\n]*[\])]?/gi;

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
  cleaned = cleaned.replace(ENVELOPE_TAG_RE, '');

  // 5. Cut a verbatim repetition loop (below) — the answer up to the loop is real; the loop is not.
  cleaned = truncateRepetitionLoop(cleaned);

  // Collapse excessive blank lines left behind, trim
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

const LOOP_MARKER = '\n\n[ForgeClaw cut the rest of this answer: the model fell into a repetition loop.]';

/**
 * A small model on a slow runner can fall into a verbatim loop (the 2026-10-20 site run repeated
 * one CSS selector until its token budget ran out; chat generation carries no repetition penalty).
 * Detect a phrase of 3–12 words repeated 3+ times back-to-back, spanning at least 15 words, and
 * cut the text at the second occurrence. Fenced code is exempt: repeated lines there are data,
 * not a loop. The marker keeps the cut visible instead of silently shortening the answer.
 */
export function truncateRepetitionLoop(response: string): string {
  const parts = response.split(/(```[\s\S]*?(?:```|$))/g);
  for (let i = 0; i < parts.length; i += 2) {
    const cut = cutLoopInProse(parts[i]);
    if (cut !== null) {
      const kept = parts.slice(0, i).join('') + cut;
      return kept.replace(/\s+$/, '') + LOOP_MARKER;
    }
  }
  return response;
}

function cutLoopInProse(prose: string): string | null {
  const words: Array<{ start: number; text: string }> = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(prose)) !== null) words.push({ start: m.index, text: m[0].toLowerCase() });
  if (words.length < 15) return null;
  for (let s = 0; s + 15 <= words.length; s++) {
    for (let len = 12; len >= 3; len--) {
      if (s + len * 3 > words.length) continue;
      const phrase = words.slice(s, s + len).map(w => w.text).join(' ');
      let occurrences = 1;
      while (s + len * (occurrences + 1) <= words.length
        && words.slice(s + len * occurrences, s + len * (occurrences + 1)).map(w => w.text).join(' ') === phrase) {
        occurrences++;
      }
      if (occurrences >= 3 && len * occurrences >= 15) {
        return prose.slice(0, words[s + len].start);
      }
    }
  }
  return null;
}
