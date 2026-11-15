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
