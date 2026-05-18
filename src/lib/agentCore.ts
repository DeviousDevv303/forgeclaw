// ForgeClaw — Agent Core
// Self-correction controller: failure classification, retry decisions, governance constants.

export const MAX_AGENT_ITERATIONS = 40
export const SOFT_REVIEW_ITERS = 30
export const AGENT_CONFIDENCE_THRESHOLD = 0.72

export type ToolFailureClass =
  | 'TOOL_FAILURE'
  | 'AUTH_FAILURE'
  | 'NETWORK_FAILURE'
  | 'DEPENDENCY_FAILURE'
  | 'INVALID_ASSUMPTION'
  | 'USER_CONSTRAINT'
  | 'UNKNOWN'

export type RetryDecision = {
  shouldRetry: boolean
  reason: string
  alternativeStrategy?: string
  requiresUserApproval?: boolean
}

const DESTRUCTIVE_TOOL_PATTERN = /github_run_workflow|run_js|gmail_send|calendar_create|send_whatsapp|github_write_file/i

export function isDestructiveTool(toolName: string): boolean {
  return DESTRUCTIVE_TOOL_PATTERN.test(toolName)
}

export function classifyToolFailure(errorMsg: string): ToolFailureClass {
  if (/401|403|unauthorized|forbidden|api.?key|invalid.{0,20}key/i.test(errorMsg)) return 'AUTH_FAILURE'
  if (/failed to fetch|network|timeout|econnrefused|enotfound|net::err/i.test(errorMsg)) return 'NETWORK_FAILURE'
  if (/not found|missing|no such|dependency|module|package/i.test(errorMsg)) return 'DEPENDENCY_FAILURE'
  if (/tool error|invalid input|bad request|malformed/i.test(errorMsg)) return 'TOOL_FAILURE'
  if (/assumption|expected.*but got|unexpected.*result/i.test(errorMsg)) return 'INVALID_ASSUMPTION'
  if (/permission denied|access denied|not allowed/i.test(errorMsg)) return 'USER_CONSTRAINT'
  return 'UNKNOWN'
}

export type DiscardedPath = {
  label: string
  probability: number   // synthetic decision weight — not exhaustive, reflects relative utility
}

// Returns the paths NOT taken for a given failure class and tool, so the UI
// can show what was considered and why it was collapsed away.
export function getDiscardedPaths(
  failureClass: ToolFailureClass,
  toolName: string,
): DiscardedPath[] {
  const t = toolName.replace(/_/g, '-')
  switch (failureClass) {
    case 'NETWORK_FAILURE':
      return [
        { label: `${t}/static-fallback`,    probability: 12.7 },
        { label: `${t}/alternate-endpoint`, probability:  8.3 },
        { label: `${t}/cached-response`,    probability:  5.1 },
        { label: 'wait/retry-backoff',       probability:  2.4 },
      ]
    case 'DEPENDENCY_FAILURE':
      return [
        { label: 'install/direct',           probability: 14.2 },
        { label: 'simplify/execution',       probability:  9.1 },
        { label: 'pin/older-version',        probability:  6.3 },
        { label: 'skip/optional-dep',        probability:  3.8 },
      ]
    case 'TOOL_FAILURE':
      return [
        { label: `${t}/adjusted-params`,     probability: 11.4 },
        { label: `${t}/simplified-input`,    probability:  7.6 },
        { label: 'alternate/tool-call',      probability:  5.2 },
        { label: 'manual/override',          probability:  2.9 },
      ]
    case 'INVALID_ASSUMPTION':
      return [
        { label: 're-read/source-of-truth',  probability: 16.3 },
        { label: 'revise/assumption-model',  probability:  9.7 },
        { label: 'fallback/heuristic',       probability:  4.1 },
      ]
    case 'AUTH_FAILURE':
      return [
        { label: 'refresh/token',            probability: 18.5 },
        { label: 'use/alternate-credential', probability:  7.2 },
        { label: 'elevate/scope',            probability:  3.3 },
      ]
    case 'USER_CONSTRAINT':
      return [
        { label: 'request/permission',       probability: 21.0 },
        { label: 'find/alternate-path',      probability:  5.8 },
      ]
    default:
      return [
        { label: 'manual/intervention',      probability:  8.1 },
        { label: 'alternate/approach',       probability:  4.5 },
        { label: 'defer/to-user',            probability:  2.1 },
      ]
  }
}

export function decideRetry(
  failureClass: ToolFailureClass,
  attemptCount: number,
  destructive: boolean,
): RetryDecision {
  if (destructive) {
    return {
      shouldRetry: false,
      reason: 'Destructive action requires user approval before retry.',
      requiresUserApproval: true,
    }
  }

  if (attemptCount >= 3) {
    return {
      shouldRetry: false,
      reason: `Retry limit reached after ${attemptCount} attempts.`,
    }
  }

  switch (failureClass) {
    case 'NETWORK_FAILURE':
      return {
        shouldRetry: true,
        reason: 'Network failure may be transient.',
        alternativeStrategy: 'Retry with exponential backoff or use an alternate fetch endpoint.',
      }
    case 'AUTH_FAILURE':
      return {
        shouldRetry: false,
        reason: 'Authentication failure requires new credentials or permission grant.',
        requiresUserApproval: true,
      }
    case 'DEPENDENCY_FAILURE':
      return {
        shouldRetry: true,
        reason: 'Dependency may be installable or substitutable.',
        alternativeStrategy: 'Install the missing dependency, use a fallback package, or simplify execution.',
      }
    case 'TOOL_FAILURE':
      return {
        shouldRetry: true,
        reason: 'Tool failed — adjusted input or alternate tool may succeed.',
        alternativeStrategy: 'Change parameters, simplify the input, or call a different tool that achieves the same result.',
      }
    case 'INVALID_ASSUMPTION':
      return {
        shouldRetry: true,
        reason: 'Assumption was wrong — retry with corrected model.',
        alternativeStrategy: 'Re-read the source, revise the assumption, and retry with accurate inputs.',
      }
    case 'USER_CONSTRAINT':
      return {
        shouldRetry: false,
        reason: 'Permission denied — user must grant access.',
        requiresUserApproval: true,
      }
    default:
      return {
        shouldRetry: false,
        reason: 'Unknown failure — verification required before retry.',
      }
  }
}
