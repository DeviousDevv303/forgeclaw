// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Reply-language instructions keyed by the UI language selected in the header.
// Providers that accept a system prompt receive these there; the DeepSeek
// workflow builds its own system prompt from `task`/`context`, so the selected
// language has to travel inside the task text.

export const RESPONSE_LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  en: 'Respond in English unless the user asks for another language.',
  es: 'Respond in Spanish (Latin American, as spoken in Mexico; use "tú" unless the user uses "usted") unless the user asks for another language.',
  ru: 'Respond in Russian unless the user asks for another language.',
  zh: 'Respond in Chinese unless the user asks for another language.',
}

/**
 * Append the reply-language instruction to a DeepSeek task. English is the
 * workflow's default, so English and unknown values leave the task unchanged.
 */
export function withResponseLanguage(task: string, lang?: string): string {
  if (!task || !lang || lang === 'en') return task
  const instruction = RESPONSE_LANGUAGE_INSTRUCTIONS[lang]
  return instruction ? `${task}\n\nReply language: ${instruction}` : task
}
