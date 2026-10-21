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
  'shell_patch',         // dispatches shell-repair.yml: pushes a branch and opens a pull request
  'generate_image',      // dispatches external image generation compute
  'generateimage',       // execution alias for generate_image
  'gmail_send',          // external email, irreversible
  'calendar_create',     // creates real calendar events
  'shell_exec',          // dispatches GitHub Actions runner — real external execution
  'github_merge_pr',     // merges a pull request into the default branch (irreversible from here)
])

/** Clicking, typing and key presses act on a page; goto/scroll/wait/back only look. Unreadable input counts as acting. */
function browserActionsInteractive(raw: unknown): boolean {
  let list: unknown = raw
  if (typeof raw === 'string') { try { list = JSON.parse(raw) } catch { return true } }
  if (!Array.isArray(list)) return true
  return list.some(a => !['goto', 'scroll', 'wait', 'back'].includes((a as { type?: string } | null)?.type ?? ''))
}

// Co-signed even under the 'autonomous' posture: a merge changes what runs in production and cannot be undone from chat.
const NEVER_AUTONOMOUS = new Set(['github_merge_pr'])

// Autonomous in the default operator-shell posture, co-signed under full-cosign. Authorized by Cristian
// Nunez on 2026-10-20 ("fully autonomous" site deployment): publishing a static site to a non-default
// branch of a repository other than ForgeClaw, and creating the repository it lives in. The publisher
// itself refuses the default branch, workflow paths and the ForgeClaw repository (githubPublish.ts).
const OPERATOR_AUTONOMOUS = new Set(['shell_exec', 'github_publish_site', 'github_create_repo', 'github_build_site'])

// Co-signed under full-cosign only (operator-shell runs them freely; see OPERATOR_AUTONOMOUS).
const FULL_COSIGN_ONLY = new Set(['github_publish_site', 'github_create_repo', 'github_build_site'])

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
// 'operator-shell': shell_exec, github_publish_site and github_create_repo are
//                   autonomous; other repo writes and mutating operations
//                   require co-sign per full-cosign rules.
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

/** Lower-case, trim, and strip a leading refs/heads/ or heads/ prefix. Non-strings read as unspecified. */
export function normalizeBranchName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().trim().replace(/^(?:refs\/)?heads\//, '')
}

// Tier gate — returns true if the operation needs a human co-sign.
export function requiresCoSign(call: ToolCall, posture: GuardianPosture | boolean): boolean {
  // Backward compat: boolean maps to legacy postures
  const resolved: GuardianPosture = typeof posture === 'boolean'
    ? postureFromTier1Active(posture)
    : posture

  if (NEVER_AUTONOMOUS.has(call.name)) return true
  if (resolved === 'autonomous') return false  // fully autonomous — no gates

  // The cloud browser: looking is free in operator-shell; acting on a page (click, type, key press) is co-signed.
  if (call.name === 'browser_run') return resolved === 'full-cosign' || browserActionsInteractive(call.input.actions)

  if (resolved === 'operator-shell') {
    // Operator's shell commands and site deployment are autonomous — no obstacles.
    if (OPERATOR_AUTONOMOUS.has(call.name)) return false
    // Everything else follows full-cosign rules below.
  }

  // full-cosign (and operator-shell fallthrough for non-shell tools):
  // Always co-sign these
  if (ALWAYS_COSIGN.has(call.name)) return true
  if (FULL_COSIGN_ONLY.has(call.name)) return true

  // Branch-aware: writes to main/master (or unspecified) require co-sign
  if (call.name === 'github_write_file') {
    // Normalize fully-qualified ref spellings ("refs/heads/main", "heads/main")
    // so they cannot slip past the protected-branch check.
    const branch = normalizeBranchName(call.input.branch)
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
