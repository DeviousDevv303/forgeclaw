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
