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

/**
 * Where shell_exec really runs (.github/workflows/shell-exec.yml), so a hosted model stops guessing.
 * 2026-10-19: Claude's first shell_exec was `git clone .../forgeclaw.git`, which failed (exit 128,
 * "destination path 'forgeclaw' already exists") because the repo is already checked out there; it
 * also used shell_exec (a 1-2 minute runner job) for a grep that github_search_code answers in seconds.
 */
export const SHELL_EXEC_GUIDANCE =
  'Tool choice: read and search with github_read_file, github_list_files and github_search_code (seconds). ' +
  'Use shell_exec only to RUN something (tests, builds, scripts, git history); each call is a separate 1-2 minute GitHub Actions job. ' +
  'shell_exec facts: it starts in a fresh shallow checkout of the repository at main (working directory = repo root), so never git clone it; ' +
  'node_modules is not installed (run `npm ci` first in the same command, e.g. `npm ci && npx vitest run src/lib`); ' +
  'git history is one commit deep (run `git fetch --unshallow` first if you need it); there are no git credentials, so it cannot push; ' +
  'nothing persists between calls; each job is limited to 10 minutes. Chain related steps into one command with &&.'

/** Tools a model legitimately calls repeatedly with the same input while it waits on a run. */
const POLLING_TOOLS: ReadonlySet<string> = new Set(['github_get_run_status', 'github_get_run_logs', 'github_repo_state'])

/** How many identical calls in one run count as a loop. */
export function repeatedCallLimit(toolName: string): number {
  return POLLING_TOOLS.has(toolName) ? 8 : 3
}

/**
 * Tool result for a call whose arguments were cut off by the output limit or were not valid JSON.
 * The call is not executed: before this, Kimi's truncated github_write_file ran with input {} and
 * failed with an unrelated "path" error, and the model retried the same oversized call.
 */
export function truncatedToolCallResult(toolName: string, reason: string): string {
  return `[TOOL ERROR] ${toolName} was not executed: ${reason}. ` +
    'Retry with smaller output: write one file per call, keep each file under about 300 lines, ' +
    'and split a large file into a small first version plus follow-up edits.'
}

/** How a hosted model builds and ships a static site, so it does not commit file-by-file or into ForgeClaw. */
export const SITE_DEPLOY_GUIDANCE =
  'Website deployment: (1) unless the user named an existing repository, call github_create_repo with a short name; ' +
  '(2) write the complete static site (index.html plus CSS/JS/assets, relative links) and call github_publish_site ONCE with every file, ' +
  'owner and repo from step 1; never publish into forgeclaw; (3) call github_pages_status until status is built for the published commit ' +
  '(the first build takes about a minute; errored means read the error and republish); (4) only then report the live URL. ' +
  'Static files only: there is no build step on Pages, so do not rely on npm install or a bundler.'

/** Repositories one run may create; a prompt-injected loop cannot fill the account with public repos. */
export const MAX_REPO_CREATIONS_PER_RUN = 2

/** Dispatcher aliases (executeTool normalizes these) that count as the offered tool. */
const TOOL_ALIASES: Readonly<Record<string, string>> = { generateimage: 'generate_image', deepseekreason: 'deepseek_reason' }

/** True when the router itself issued the calls (deterministic bootstraps), not the model. */
export function isRouterIssued(stopReason: string | undefined): boolean {
  return !!stopReason && (stopReason.startsWith('deterministic-') || stopReason === 'direct-image-intent')
}

/**
 * Why a model's tool call must not run, or null. A model may only call tools this turn offered it:
 * text it read (a web page, a file, a tool result) can name any tool, and before this a call to an
 * unoffered tool, such as github_create_repo on a plain question, still reached the dispatcher.
 */
export function toolCallRefusal(name: string, offered: ReadonlySet<string>, routerIssued: boolean, priorRepoCreations: number): string | null {
  const canonical = TOOL_ALIASES[name] ?? name
  if (!routerIssued && !offered.has(canonical) && !offered.has(name)) {
    return `[GUARDIAN BLOCKED] ${name} was not offered for this request, so it was not executed. Use only the tools listed for this turn.`
  }
  if (canonical === 'github_create_repo' && priorRepoCreations >= MAX_REPO_CREATIONS_PER_RUN) {
    return `[GUARDIAN BLOCKED] github_create_repo was not executed: this run already created ${priorRepoCreations} repositories (limit ${MAX_REPO_CREATIONS_PER_RUN}). Publish to one of them.`
  }
  return null
}
