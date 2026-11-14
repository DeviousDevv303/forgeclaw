// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * The main tool loop's refusal for a GitHub read call whose arguments cannot mean anything.
 *
 * The RULES live in githubArgCheck.ts, the one place that decides what a usable read call is: executeTool runs it for
 * every caller (the main loop, sub-agents, direct routes). This module only asks it earlier, in App.tsx before the
 * loop detector and dispatch, so the loop can treat a refused call as a call that NEVER RAN. A refusal that arrives
 * through executeTool is an ordinary failed result, which the completion guard resolves only by a retry with the same
 * input; a model that corrects its arguments would still end BLOCKED. Recorded as a never-run call (TRUNCATED_ATTEMPT,
 * the marker for calls whose arguments were cut off), a later success of the tool resolves it, and the completion
 * guard's own code is untouched: garbage with no recovery still ends BLOCKED.
 *
 * History: forgeclaw #235 (owner directive 2026-11-13, Nexus github_read_file with path ":", owner ".", start_line
 * 257257207). Two sessions of the Claude lane each fixed it: #425 (githubArgCheck.ts) and #427 (this module, with its
 * own copy of the rules). The copy refused owners that work today (underscore accounts, more than 39 characters) and
 * negative or fractional start_line values; it is gone, and this module delegates so there is one rule set.
 */
import { checkGithubReadArgs } from './githubArgCheck'

/** Why a GitHub read call must not be dispatched, or null. Reads as the failed tool result it is. */
export function toolArgumentRefusal(name: string, input: Record<string, unknown> | undefined): string | null {
  const problem = checkGithubReadArgs(name, input && typeof input === 'object' ? input : {})
  return problem ? `[TOOL ERROR] ${problem}` : null
}
