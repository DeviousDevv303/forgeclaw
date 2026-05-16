// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
import type { ToolCall } from './forgeTools'

// Always requires human co-sign regardless of autonomy level or branch.
// These are irreversible or can expose secrets.
const ALWAYS_COSIGN = new Set([
  'run_js',              // unsandboxed — full localStorage access including API keys
  'send_whatsapp',       // external message, irreversible
  'github_run_workflow', // triggers production pipelines
])

// HTTP methods that modify state
const DESTRUCTIVE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const THINKING_RE = /\[FM:THINK\]([\s\S]*?)\[FM:THINK_END\]/i

export function extractThinking(text: string): string | null {
  const m = THINKING_RE.exec(text)
  return m ? m[1].trim() : null
}

// Tier 1 gate — returns true if the operation needs a human co-sign.
//
// tier1Active=false (default): fully autonomous — everything runs without co-sign.
// tier1Active=true  (safety):  branch-aware gate —
//   ALWAYS co-sign:  run_js, send_whatsapp, github_run_workflow, mutating http_fetch
//   Branch-aware:    github_write_file → co-sign on main/master, auto on feature branch
//
export function requiresCoSign(call: ToolCall, tier1Active: boolean): boolean {
  if (!tier1Active) return false  // fully autonomous — no gates

  // Always co-sign in Tier 1
  if (ALWAYS_COSIGN.has(call.name)) return true

  // Branch-aware: writes to main/master (or unspecified) require co-sign
  if (call.name === 'github_write_file') {
    const branch = (call.input.branch as string | undefined)?.toLowerCase().trim()
    return !branch || branch === 'main' || branch === 'master'
  }

  // Mutating HTTP requires co-sign in Tier 1
  if (call.name === 'http_fetch') {
    const method = ((call.input.method as string) || 'GET').toUpperCase()
    return DESTRUCTIVE_HTTP_METHODS.has(method)
  }

  return false
}

// Backward-compat alias
export function isDestructive(call: ToolCall): boolean {
  return requiresCoSign(call, true)
}
