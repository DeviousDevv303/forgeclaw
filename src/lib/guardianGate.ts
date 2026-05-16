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
// Tier rules:
//   ALWAYS co-sign:  run_js, send_whatsapp, github_run_workflow, mutating http_fetch
//   Branch-aware:    github_write_file → co-sign on main/master, auto on feature branch
//   Kill switch:     autonomyFrozen=true forces co-sign on everything that would be auto
//
export function requiresCoSign(call: ToolCall, autonomyFrozen: boolean): boolean {
  // Kill switch: freeze all auto-approved writes back to manual
  if (autonomyFrozen) {
    if (ALWAYS_COSIGN.has(call.name)) return true
    if (call.name === 'github_write_file') return true
    if (call.name === 'http_fetch') {
      const method = ((call.input.method as string) || 'GET').toUpperCase()
      return DESTRUCTIVE_HTTP_METHODS.has(method)
    }
    return false
  }

  // Always co-sign regardless of branch
  if (ALWAYS_COSIGN.has(call.name)) return true

  // Branch-aware: writes to main/master (or unspecified branch) require co-sign;
  // writes to an explicit feature branch are auto-allowed.
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

// Backward-compat alias (used in places that don't have autonomyFrozen context)
export function isDestructive(call: ToolCall): boolean {
  return requiresCoSign(call, false)
}
