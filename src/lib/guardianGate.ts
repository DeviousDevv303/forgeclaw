import type { ToolCall } from './forgeTools'

// Tools that cause side effects outside the browser session.
// Read-only and in-memory tools are never intercepted.
export const DESTRUCTIVE_TOOLS = new Set([
  'github_write_file',
  'github_run_workflow',
  'send_whatsapp',
  'run_js',
])

// HTTP methods that modify state
const DESTRUCTIVE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const THINKING_RE = /\[FM:THINK\]([\s\S]*?)\[FM:THINK_END\]/i

export function extractThinking(text: string): string | null {
  const m = THINKING_RE.exec(text)
  return m ? m[1].trim() : null
}

export function isDestructive(call: ToolCall): boolean {
  if (DESTRUCTIVE_TOOLS.has(call.name)) return true
  // http_fetch with mutating method
  if (call.name === 'http_fetch') {
    const method = (call.input.method as string | undefined)?.toUpperCase()
    if (method && DESTRUCTIVE_HTTP_METHODS.has(method)) return true
  }
  return false
}
