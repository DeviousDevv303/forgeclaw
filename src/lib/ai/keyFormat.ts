// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// One source of truth for an API key's format. A provider's isConfigured (the gate send() throws on) is
// "keyFormatProblem(key, rule) === null", and the Diagnostics panel words its reason from the same problem,
// so the verdict and its explanation cannot disagree (F-017 follow-up: the panel said "expected sk-ant-..."
// for a short sk-ant- key, because it kept its own prefix-only copy of a prefix-and-length rule).

export interface KeyFormatRule {
  prefix: string
  /** The shortest key, in characters after trimming, the provider accepts. */
  minLength: number
}

export type KeyFormatProblem =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'length'; prefix: string; length: number; minLength: number }

export function keyFormatProblem(apiKey: string, rule: KeyFormatRule): KeyFormatProblem | null {
  const key = apiKey.trim()
  if (!key.startsWith(rule.prefix)) return { kind: 'prefix', prefix: rule.prefix }
  if (key.length < rule.minLength) return { kind: 'length', prefix: rule.prefix, length: key.length, minLength: rule.minLength }
  return null
}

/**
 * What a key looks like once the debris of copying it is gone: invisible characters (zero-width, BOM, no-break space) that
 * ride along when a key is copied from a web page, surrounding quotes or backticks, a leading "Bearer " or "Authorization: Bearer ",
 * and any whitespace or line break inside it (a wrapped paste). Real keys contain none of these, so removing them can only turn a
 * mangled paste into the key that was meant; a key that is still wrong afterwards is rejected by the format rule as before.
 */
export function normalizePastedKey(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00A0]/g, '')
    .trim()
    .replace(/^(?:authorization:\s*)?bearer\s+/i, '')
    .replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g, '')
    .replace(/\s+/g, '')
}

/**
 * Words what is wrong with a key that failed its rule, from its SHAPE alone: the first few characters (a provider's prefix, never
 * the secret part) and its length. Names the common mix-ups so the owner can see which key was actually pasted.
 */
export function describeKeyShape(apiKey: string, rule: KeyFormatRule): string {
  const key = apiKey
  if (key.length === 0) return 'The field is empty.'
  // Only a KNOWN provider prefix is ever echoed (sk-or-v1-, sk-ant-, sk-proj-: the label, not the secret). A legacy sk- key has random
  // characters right after "sk-", so for anything else the message shows "sk-" at most, or two characters of a non-sk string.
  const known = /^(sk-or-v1-|sk-ant-|sk-proj-)/i.exec(key)
  const head = known ? known[0] : key.toLowerCase().startsWith('sk-') ? key.slice(0, 3) : key.slice(0, 2)
  if (key.toLowerCase().startsWith(rule.prefix) && !key.startsWith(rule.prefix)) {
    return `It starts with "${head}": the prefix must be lowercase ${rule.prefix} exactly. Copy the key again without changing its case.`
  }
  if (key.startsWith(rule.prefix)) return `It starts with ${rule.prefix} but is only ${key.length} characters; a real key is longer (minimum ${rule.minLength}). It was probably cut off when copied.`
  if (key.startsWith('sk-ant-')) return 'It starts with sk-ant-: that is an Anthropic key, not this provider\'s.'
  if (key.startsWith('sk-or-')) return 'It is an OpenRouter key (sk-or-), which this provider does not use.'
  if (key.startsWith('sk-')) return `It starts with "${head}": that is another provider's key (for example OpenAI or Moonshot), not this one.`
  return `It starts with "${head}" and is ${key.length} characters long.`
}
