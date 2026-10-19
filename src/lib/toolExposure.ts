// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Which tools a chat turn is offered. ForgeClaw normally offers tools by keyword, so browser-local
// models do not drown in a large tool protocol. Hosted models with native tool calling (Claude, Kimi)
// do not have that problem, and the keyword gate left them with no tools at all for ordinary repo
// requests: "look through my GitHub repo and look for efficiency improvements on workflows" matched
// nothing, so Claude truthfully said it had no GitHub access, and on earlier turns invented commits.

/** Providers whose models call tools natively and reliably; local llama.cpp is deliberately excluded. */
export const HOSTED_TOOL_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'moonshot'])

/** Read-only evidence tools a hosted model always gets. Writes stay keyword/task-gated and behind Guardian. */
export const READ_ONLY_BASELINE_TOOLS = [
  'github_repo_state',
  'github_read_file',
  'github_list_files',
  'github_search_code',
  'github_get_run_status',
  'github_get_run_logs',
  'web_search',
] as const

export function baselineToolNames(providerId: string): string[] {
  return HOSTED_TOOL_PROVIDERS.has(providerId) ? [...READ_ONLY_BASELINE_TOOLS] : []
}

/** Appended to the prompt of a turn that has no tools, so the model cannot pretend it used any. */
export const NO_TOOLS_NOTICE =
  'No tools are available in this message. You cannot read the repository, run commands, check workflow runs, or make commits right now. ' +
  'Never claim or imply that you did; never invent commit IDs, file contents, or run results. If the request needs them, say so plainly.'
