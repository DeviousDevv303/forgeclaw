// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import type { ToolCall } from './forgeTools'

// Always requires human co-sign regardless of autonomy level or branch.
// These are irreversible or can expose secrets.
const ALWAYS_COSIGN = new Set([
  'run_js',              // unsandboxed — full localStorage access including API keys
  'send_whatsapp',       // external message, irreversible
  'github_run_workflow', // triggers production pipelines
  'sculpt_self',         // creates a self-modification pull request
  'generate_image',      // dispatches external image generation compute
  'generateimage',       // execution alias for generate_image
  'gmail_send',          // external email, irreversible
  'calendar_create',     // creates real calendar events
  'shell_exec',          // dispatches GitHub Actions runner — real external execution
])

// HTTP methods that modify state
const DESTRUCTIVE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const THINKING_RE = /\[FM:THINK\]([\s\S]*?)\[FM:THINK_END\]/i

export function extractThinking(text: string): string | null {
  const m = THINKING_RE.exec(text)
  return m ? m[1].trim() : null
}

// Guardian posture — controls which operations require human co-sign.
//
// 'autonomous':     fully autonomous — everything runs without co-sign.
//                   (legacy tier1Active=false)
// 'operator-shell': shell_exec is autonomous (operator's shell commands run
//                   without obstacles); repo writes and other mutating
//                   operations require co-sign per full-cosign rules.
// 'full-cosign':    everything in ALWAYS_COSIGN requires co-sign, plus
//                   branch-aware github_write_file and mutating http_fetch.
//                   (legacy tier1Active=true)
//
export type GuardianPosture = 'autonomous' | 'operator-shell' | 'full-cosign'

/** Default posture: operator shell runs free, repo changes need approval. */
export const DEFAULT_GUARDIAN_POSTURE: GuardianPosture = 'operator-shell'

/** Map legacy boolean tier1Active to the new posture model. */
export function postureFromTier1Active(tier1Active: boolean): GuardianPosture {
  return tier1Active ? 'full-cosign' : 'autonomous'
}

// Tier gate — returns true if the operation needs a human co-sign.
export function requiresCoSign(call: ToolCall, posture: GuardianPosture | boolean): boolean {
  // Backward compat: boolean maps to legacy postures
  const resolved: GuardianPosture = typeof posture === 'boolean'
    ? postureFromTier1Active(posture)
    : posture

  if (resolved === 'autonomous') return false  // fully autonomous — no gates

  if (resolved === 'operator-shell') {
    // Operator's shell commands are autonomous — no obstacles.
    if (call.name === 'shell_exec') return false
    // Everything else follows full-cosign rules below.
  }

  // full-cosign (and operator-shell fallthrough for non-shell tools):
  // Always co-sign these
  if (ALWAYS_COSIGN.has(call.name)) return true

  // Branch-aware: writes to main/master (or unspecified) require co-sign
  if (call.name === 'github_write_file') {
    const branch = (call.input.branch as string | undefined)?.toLowerCase().trim()
    return !branch || branch === 'main' || branch === 'master'
  }

  // Mutating HTTP requires co-sign
  if (call.name === 'http_fetch') {
    const method = ((call.input.method as string) || 'GET').toUpperCase()
    return DESTRUCTIVE_HTTP_METHODS.has(method)
  }

  return false
}

// Backward-compat alias
export function isDestructive(call: ToolCall): boolean {
  return requiresCoSign(call, 'full-cosign')
}
