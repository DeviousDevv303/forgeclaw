import type { ToolCall } from './forgeTools'

// Tools that cause side effects outside the browser session.
// Read-only and in-memory tools are never blocked.
const DESTRUCTIVE_TOOLS = new Set([
  'github_write_file',
  'github_create_issue',
  'github_run_workflow',
  'send_whatsapp',
  'run_js',
])

// Linguistic markers that reduce scored confidence.
// Each match subtracts 0.15 (floored at 0.0).
const UNCERTAINTY_MARKERS: RegExp[] = [
  /\b(not sure|unsure|uncertain|unclear)\b/i,
  /\b(don['']?t know|might|maybe|perhaps|possibly|could be)\b/i,
  /\b(not confident|i think|i believe|i['']?m guessing|i guess|i assume)\b/i,
  /\b(probably|likely|seems like|appears to)\b/i,
  /\b(double.?check|verify first|confirm|hold on|wait|actually|reconsider)\b/i,
]

const THINKING_RE = /\[FM:THINK\]([\s\S]*?)\[FM:THINK_END\]/i

function extractThinking(text: string): string | null {
  const m = THINKING_RE.exec(text)
  return m ? m[1].trim() : null
}

function scoreConfidence(thinking: string): number {
  let score = 1.0
  for (const pattern of UNCERTAINTY_MARKERS) {
    if (pattern.test(thinking)) score -= 0.15
  }
  return Math.max(0, Math.round(score * 100) / 100)
}

export interface GuardianResult {
  blocked: boolean
  confidence?: number
  reason?: string
}

/**
 * Check whether a tool call should be blocked.
 *
 * A call is blocked when ALL three are true:
 *  1. The tool is destructive (writes/sends outside the browser session)
 *  2. The model emitted a [FM:THINK] block in the same response
 *  3. The Guardian-scored confidence of that thinking is < 0.70
 *
 * If no thinking block is present we give the benefit of the doubt.
 */
export function guardianCheck(call: ToolCall, responseText: string): GuardianResult {
  if (!DESTRUCTIVE_TOOLS.has(call.name)) return { blocked: false }

  const thinking = extractThinking(responseText)
  if (!thinking) return { blocked: false }

  const confidence = scoreConfidence(thinking)

  if (confidence < 0.70) {
    return {
      blocked: true,
      confidence,
      reason: `Guardian blocked \`${call.name}\` — confidence ${confidence.toFixed(2)} < 0.70. Co-sign required.`,
    }
  }

  return { blocked: false, confidence }
}
