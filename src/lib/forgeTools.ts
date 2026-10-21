// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw Tool Suite ─────────────────────────────────────────────────────
// Gives ForgeMind hands. Each tool maps to a real browser-executable action.
// Tool calling is routed through the active provider adapter.

import { safeGetItem, safeSetItem } from './storage'
import { resolveGithubToken } from './githubAuth'
import { describeGithubDispatchFailure } from './githubDispatchErrors'
import { describeGithubHttpFailure, describeGithubTransportFailure, toolFetch } from './githubFetch'
import { normalizeKnownShellExecutable } from './shellCommand'
import {
  FORGECLAW_AGENT_ID,
  FORGECLAW_AGENT_LABEL,
  buildAttributedCommitMessage,
} from './githubAttribution'
import {
  loadCodingAgentState as loadPersistedCodingAgentState,
  saveCodingAgentState as savePersistedCodingAgentState,
  appendActivity,
  type CodingAgentState,
} from './codingAgentState'
import { CANONICAL_IDENTITY } from './canonicalIdentity'
import { requiresCoSign, type GuardianPosture, DEFAULT_GUARDIAN_POSTURE, postureFromTier1Active } from './guardianGate'
import { runDdgWorkflowSearch } from './ddgWorkflowSearch'
import { explainShellRunMismatch, isCorrelatedShellRun, normalizeShellWorkingDirectoryInput, parseShellExecutionLog, SHELL_LOG_POLL_INTERVAL_MS, SHELL_LOG_RETRIEVAL_TIMEOUT_MS, SHELL_RUN_LIST_TIMEOUT_MS, type ShellWorkflowRun } from './shellCorrelation'
import { appendDeepSeekLearning, appendImageGenerationLearning, corpusRepository, suggestImprovedPrompt } from './corpus'
import { createShellRawExperience, shellExperienceAsCorpusInput } from './shellLearning'
import { getShellExercise } from './shellCompetency'
import { downloadImagePng, registerGeneratedImage, waitForImageRun } from './imageArtifact'
import { tasteForImagePrompt } from './nexusTaste'
import { DEEPSEEK_GITHUB_READ_TIMEOUT_MS, isEmptyDeepSeekResponse, waitForDeepSeekResult } from './deepseekArtifact'
import { journalRecord, type RunJournal } from './runRollback'
import { createRepo, publishSite, waitForPagesBuild, PAGES_WAIT_MAX_MS, type GithubRequest, type PublishFile } from './githubPublish'
import { buildAndPublishSite } from './siteBuild'
import { formatResearchResult, normalizeQueries, runDeepResearch } from './deepResearch'
import { findPullRequest, waitForCorrelatedRun } from './workflowRun'
import { jobFailureEvidence } from './runDiagnosis'
import { PUBLIC_RELAY_URL, runPublicReasoning, runPublicResearch } from './publicRelay'
import { ATTACHED_IMAGE, currentAttachedImage } from './imageInput'
import { formatImageAnalysis, runImageAnalysis } from './visionInput'
import { formatCodeReview, runCodeReview } from './codeReview'
import { weatherForecast } from './weather'
import { isSculptUnlocked, SCULPT_LOCKED_MESSAGE, SCULPT_TOOLS } from './sculptKey'

/**
 * Wait for a self-modification run (self-sculpt or shell-repair) and report what really happened:
 * the pull request it opened, a run that changed nothing, or the failing run. A dispatch alone used to
 * be reported as done, although the build check or the protected-path policy could still reject it.
 */
async function reportProposalRun(request: GithubRequest, input: { owner: string; repo: string; token: string; workflow: string; needle: string; since: number; branch: string; label: string; signal?: AbortSignal }): Promise<string> {
  const run = await waitForCorrelatedRun(request, { ...input, maxWaitMs: PROPOSAL_MAX_WAIT_MS })
  if (run.conclusion !== 'success') {
    const facts = await describeFailedRun(request, { ...input, runId: run.id })
    if (facts) throw new Error(`${input.label} run #${run.run_number} concluded "${run.conclusion}": ${facts} Logs: ${run.html_url}`)
    throw new Error(`${input.label} run #${run.run_number} concluded "${run.conclusion}": nothing was proposed (protected path, patch that does not apply, or a failing build). Logs: ${run.html_url}`)
  }
  const pr = await findPullRequest(request, input.owner, input.repo, input.token, input.branch)
  if (!pr) return `✓ ${input.label} run #${run.run_number} succeeded but made no change (the content was identical), so no pull request was opened. Run: ${run.html_url}`
  return `✓ ${input.label}: build-validated and proposed as pull request #${pr.number} on ${input.branch} (not merged; review it).\n  pr: ${pr.html_url}\n  run: ${run.html_url}`
}

/**
 * What a failed self-modification run actually did, from GitHub, not guessed: the failing step, the steps that
 * passed before it, and whether the branch reached the remote. A step that exits 0 is not proof it did its job
 * (the commit step once said "No repair changes to publish", exited 0, and pushed nothing), so the branch is checked.
 * Returns '' when GitHub cannot be asked, and the caller falls back to the generic message.
 */
async function describeFailedRun(request: GithubRequest, input: { owner: string; repo: string; token: string; branch: string; runId: number }): Promise<string> {
  try {
    const headers = { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }
    const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
    const jobsRes = await request(`${base}/actions/runs/${input.runId}/jobs`, { headers })
    if (!jobsRes.ok) return ''
    const jobs = ((await jobsRes.json()) as { jobs?: Array<{ id: number; conclusion: string | null; steps?: Array<{ name: string; conclusion: string | null }> }> }).jobs ?? []
    const steps = jobs.flatMap(job => job.steps ?? [])
    const failed = steps.find(step => step.conclusion === 'failure')
    if (!failed) return ''
    const failedJob = jobs.find(job => job.conclusion === 'failure')
    const evidence = failedJob ? await jobFailureEvidence(request, { owner: input.owner, repo: input.repo, token: input.token, jobId: failedJob.id }) : ''
    const passed = steps.filter(step => step.conclusion === 'success' && !/^(Set up job|Post |Complete job|Run actions\/)/.test(step.name)).map(step => step.name)
    const refRes = await request(`${base}/git/ref/heads/${encodeURIComponent(input.branch).replace(/%2F/g, '/')}`, { headers })
    const pushed = refRes.ok
    return `it failed at the step "${failed.name}". Steps that passed before it: ${passed.length ? passed.join('; ') : '(none)'}. ` +
      `Branch ${input.branch} on GitHub: ${pushed ? 'EXISTS (pushed)' : 'NOT FOUND, so nothing was persisted'}. ` +
      'A step that exited 0 is not proof it did what its name says. Do not claim a branch or pull request that does not exist.' +
      (evidence ? `\n${evidence}\nDiagnose from this evidence and say what you found.` : '')
  } catch {
    return ''
  }
}

const PROPOSAL_MAX_WAIT_MS = 25 * 60 * 1000

/** Models send files as an array or as a JSON string of one; anything else is rejected by the publisher. */
function parsePublishFiles(raw: unknown): PublishFile[] {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as PublishFile[] } catch { throw new Error('files must be an array of {path, content} (got a string that is not JSON)') }
  }
  return raw as PublishFile[]
}

// These runtime envelopes are for the chat/model boundary only. They must not
// become part of a user-facing image prompt, where Stable Diffusion may render
// the labels as visible text or use them as semantic prompt content.
function cleanImagePrompt(prompt: string): string {
  return prompt
    .replace(/\[APPLICATIONIDENTITY\b[^\]]*\][\s\S]*?\[\/APPLICATIONIDENTITY\]/gi, '')
    .replace(/\[RUNTIMESTATE\b[^\]]*\][\s\S]*?\[\/RUNTIMESTATE\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolParam {
  type: string
  description: string
  enum?: string[]
  /** Element schema for type 'array'; some providers reject an array parameter without it. */
  items?: Record<string, unknown>
}

export interface ToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParam>
    required: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  name: string
  output: string
  isError: boolean
  reasoningStepId?: string
}

export interface ToolContext {
  ghToken: string
  ghOwner: string
  ghRepo: string
  /** Public relay for visitors without a GitHub token (src/lib/publicRelay.ts); empty for the owner. */
  publicRelayUrl?: string
  /** Whether the self-sculpt key is unlocked; defaults to the live check in sculptKey.ts. */
  sculptUnlocked?: boolean
  sessionId?: string
  waPhoneNumberId?: string
  waAccessToken?: string
  waRecipient?: string
  braveKey?: string
  googleToken?: string
  agentId?: string
  runId?: string
  signal?: AbortSignal
  /** Records how to undo this run's changes (STOP uses it). Defaults to the active run's journal. */
  journal?: RunJournal
  /** Called when a DeepSeek workflow is dispatched, with the invocation ID for resume. */
  onDeepSeekDispatch?: (invocationId: string, dispatchedAt: number) => void
  tier1Active?: boolean
  guardianPosture?: GuardianPosture
  /** 'operator' for commands the human typed directly; otherwise writes are attributed to the agent. */
  actor?: 'agent' | 'operator'
  requestGuardianApproval?: (call: ToolCall) => Promise<boolean>
  spawnAgent?: (systemPrompt: string, task: string, tools?: string[]) => Promise<string>
}

function normalizeRepositoryPath(path: string): string {
  return path.replace(/^\/+/, '')
}

// Allowlist mirrored by MODELS in .github/scripts/generate_image.py (a test keeps them in sync).
export const IMAGE_MODELS = ['sd15', 'sdxl-turbo', 'sd-turbo'] as const

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const FORGE_TOOLS: ToolDef[] = [
  {
    name: 'github_read_file',
    description: 'Read the contents of a file from a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'File path relative to repo root, e.g. src/App.tsx' },
        owner: { type: 'string', description: 'GitHub owner (defaults to configured repo owner)' },
        repo:  { type: 'string', description: 'GitHub repo name (defaults to configured repo)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'github_write_file',
    description: 'Create or update a file in a GitHub repository with a commit message. Use a feature branch (not main) for autonomous writes — main requires Guardian co-sign.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Full file content to write' },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Branch to write to. Omit or use "main" to write to the default branch (requires co-sign). Use a feature branch name for autonomous writes.' },
        owner:   { type: 'string', description: 'GitHub owner (defaults to configured)' },
        repo:    { type: 'string', description: 'GitHub repo (defaults to configured)' },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'github_list_files',
    description: 'List files and directories at a path in a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Directory path (empty string for root)' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: [],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search for code matching a query in a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "useState" or "TODO fixme"' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a GitHub issue in a repository.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        body:  { type: 'string', description: 'Issue body (markdown supported)' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'github_run_workflow',
    description: 'Trigger a GitHub Actions workflow dispatch.',
    parameters: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow file name, e.g. deploy.yml' },
        ref:      { type: 'string', description: 'Branch or tag to run on (default: main)' },
        owner:    { type: 'string', description: 'GitHub owner' },
        repo:     { type: 'string', description: 'GitHub repo' },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'deepseek_reason',
    description: 'Primary complex-task reasoning via the repository-owned DeepSeek GitHub Actions workflow. The existing DeepSeek-16B route/API name is retained; the workflow currently runs Qwen/Qwen3-8B (4-bit GGUF, CPU) as primary and uses deepseek-ai/deepseek-coder-1.3b-instruct only if the primary cannot load or run. The request may be recorded as an unapproved learning candidate when enabled.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task for the DeepSeek reasoning workflow' },
        context: { type: 'string', description: 'Additional context for the task' },
        nexus_learn: { type: 'boolean', description: 'Record the dispatch as an unapproved learning candidate (default true)' },
        ref: { type: 'string', description: 'Branch or tag to run the workflow from (default main)' },
      },
      required: ['task'],
    },
  },
  {
    name: 'ask_deepseek',
    description: 'Ask the existing DeepSeek reasoning workflow directly. No routing delay; Qwen/Qwen3-8B is primary, with deepseek-ai/deepseek-coder-1.3b-instruct used only if the primary cannot load or run.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to dispatch directly to the DeepSeek reasoning workflow' },
        context: { type: 'string', description: 'Optional additional context' },
        ref: { type: 'string', description: 'Branch or tag for the workflow (default main)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'sculpt_self',
    description: 'Improve ForgeClaw itself: replace ONE file (up to 60,000 characters) through the guarded self-sculpt workflow, which rejects protected paths, build-validates the change, pushes a sculpt/* branch and opens a pull request for human review (never merged automatically). Read the current file first with github_read_file and send the COMPLETE new content. For a small change to a large file use shell_patch instead. Waits for the run and returns the pull request URL or the failing run.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Repository-relative file path to update' },
        content: { type: 'string', description: 'Complete replacement file content' },
        reason: { type: 'string', description: 'One-line reason for the change, at most 240 characters' },
        branch: { type: 'string', description: 'Optional new branch sculpt/<name>; generated when omitted' },
      },
      required: ['file_path', 'content', 'reason'],
    },
  },
  {
    name: 'shell_patch',
    description: 'Improve ForgeClaw with a unified diff (any size of file, several files at once) through the guarded shell-repair workflow, which checks the protected-path policy (symlinks refused), applies the diff with git, build-validates it, pushes a forge/repair/* branch it names itself and opens a pull request for human review; nothing is merged. Requires Guardian co-sign. Waits for the run and returns the pull request URL or the failing run.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Unified diff (git apply format), applied from the repository root. Up to 60,000 characters.' },
        reason: { type: 'string', description: 'One-line reason for the change, at most 240 characters.' },
      },
      required: ['patch', 'reason'],
    },
  },
  {
    name: 'http_fetch',
    description: 'Fetch content from a public URL. Returns response body as text. Only works for CORS-permissive endpoints.',
    parameters: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'URL to fetch' },
        method:  { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        headers: { type: 'string', description: 'JSON object of request headers' },
        body:    { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'memory_write',
    description: 'Store a value in ForgeClaw persistent memory (survives page reloads). Use for tracking state across tasks.',
    parameters: {
      type: 'object',
      properties: {
        key:   { type: 'string', description: 'Memory key' },
        value: { type: 'string', description: 'Value to store (use JSON for structured data)' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read a value from ForgeClaw persistent memory.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to read' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_list',
    description: 'List all keys stored in ForgeClaw persistent memory.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'send_whatsapp',
    description: 'Send a WhatsApp message via the configured Meta Cloud API connector.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text to send' },
        to:   { type: 'string', description: 'Recipient phone number in E.164 format (uses default if omitted)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'run_js',
    description: 'Execute JavaScript code in the browser and return the result. Use for calculations, data transformations, JSON processing.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute. Use return to return a value.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'github_get_run_status',
    description: 'Get the status and conclusion of a GitHub Actions workflow run by run ID.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Workflow run ID (returned by github_run_workflow)' },
        owner:  { type: 'string', description: 'GitHub owner' },
        repo:   { type: 'string', description: 'GitHub repo' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'github_get_run_logs',
    description: 'Get job and step details for a GitHub Actions workflow run. Returns each job name, its conclusion, and the status of every step — useful for diagnosing CI failures.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Workflow run ID' },
        owner:  { type: 'string', description: 'GitHub owner' },
        repo:   { type: 'string', description: 'GitHub repo' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Uses Brave Search if an API key is configured, otherwise real DuckDuckGo results via the ddg_search GitHub workflow (needs a GitHub token; takes ~15-40s), falling back to DuckDuckGo instant answers.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results to return, default 5, max 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read recent emails from Gmail. Requires a Google OAuth access token in Settings.',
    parameters: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Gmail search query, e.g. "from:boss@co.com is:unread". Omit for all recent.' },
        max_results: { type: 'number', description: 'Max emails to return, default 10, max 20.' },
      },
      required: [],
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email via Gmail. Requires a Google OAuth access token. Always requires co-sign in Tier 1.',
    parameters: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body:    { type: 'string', description: 'Email body (plain text)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'calendar_read',
    description: 'Read upcoming events from Google Calendar. Requires a Google OAuth access token.',
    parameters: {
      type: 'object',
      properties: {
        days_ahead:  { type: 'number', description: 'How many days ahead to look, default 7' },
        max_results: { type: 'number', description: 'Max events to return, default 10' },
      },
      required: [],
    },
  },
  {
    name: 'calendar_create',
    description: 'Create a new event in Google Calendar. Requires a Google OAuth access token. Requires co-sign in Tier 1.',
    parameters: {
      type: 'object',
      properties: {
        summary:     { type: 'string', description: 'Event title' },
        start:       { type: 'string', description: 'Start time ISO 8601, e.g. 2026-05-18T14:00:00-05:00' },
        end:         { type: 'string', description: 'End time ISO 8601' },
        description: { type: 'string', description: 'Event description (optional)' },
        location:    { type: 'string', description: 'Event location (optional)' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command in a GitHub Actions runner. Results are returned asynchronously. Requires a shell-exec.yml workflow in the target repository. Useful for builds, tests, deployments, and system operations. Always requires Guardian co-sign for destructive commands.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute. Can include &&, ||, pipes, redirects. Runs in bash -c.' },
        working_directory: { type: 'string', description: 'Working directory inside the checked-out repository. Use "." for the root or a relative path like "src/lib". Local models may emit "/workspace" or "/workspace/<repo>"; these are normalized to the repository root. Do not use any other absolute path.' },
        timeout_seconds: { type: 'number', description: 'Maximum seconds to wait for completion. Default: 600. Max: 600.' },
        wait: { type: 'boolean', description: 'If true (default), polls until completion or timeout. If false, dispatches and returns immediately with run ID.' },
        exercise_id: { type: 'string', description: 'Optional stable Shell competency exercise ID. Verified results become an unapproved CORPUS candidate.' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo: { type: 'string', description: 'GitHub repo' },
      },
      required: ['command'],
    },
  },
  {
    name: 'spawn_agent',
    description: 'Spawn a temporary sub-agent with a custom system prompt to handle a complex subtask autonomously. The sub-agent has its own reasoning loop and returns a synthesized answer.',
    parameters: {
      type: 'object',
      properties: {
        system_prompt: { type: 'string', description: 'System prompt defining the sub-agent role and expertise' },
        task:          { type: 'string', description: 'The specific task for the sub-agent to complete' },
        tools:         { type: 'string', description: 'Comma-separated tool names to allow (omit for all tools)' },
      },
      required: ['system_prompt', 'task'],
    },
  },

  
  {
    name: 'analyze_image',
    description: 'Look at a picture with the free GitHub Actions vision model (Qwen2-VL-2B, a few minutes) and return what it shows.',
    parameters: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'A public https image URL, or "attached" for the picture attached to this message' },
        prompt: { type: 'string', description: 'What to analyze' }
      },
      required: ['image_url']
    }
  },
  {
    name: 'generate_image',
    description: 'Generate an image on CPU through the repository-owned GitHub Actions workflow. Default model is public Stable Diffusion v1.5; optional model "sdxl-turbo" or "sd-turbo" is faster but limited to 512x512 and carries Stability AI Community License terms. IMPORTANT: use the exact tool name generate_image with an underscore. The result is returned as a short-lived workflow artifact and the request may be recorded as an unapproved learning candidate.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image description, up to 4000 characters' },
        style: { type: 'string', description: 'Style such as realistic, artistic, or cartoon' },
        width: { type: 'number', description: 'Width in pixels, 256-1024, divisible by 8; defaults to 512' },
        height: { type: 'number', description: 'Height in pixels, 256-1024, divisible by 8; defaults to 512' },
        model: { type: 'string', enum: [...IMAGE_MODELS], description: 'Optional model key; defaults to sd15. Turbo models are limited to 512x512.' },
      },
      required: ['prompt'],
    },
  },


  {
    name: 'weather_forecast',
    description: 'Real weather forecast for a place (Open-Meteo: temperatures in °F, rain chance, wind), today and the next days. Use this for any weather question instead of web_search.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'City, e.g. "Oklahoma City" or "Denver, CO" (nicknames like OKC work)' },
        day: { type: 'number', description: 'Day to lead with: 0 = today, 1 = tomorrow (optional)' },
      },
      required: ['place'],
    },
  },
  {
    name: 'review_code',
    description: 'Review code on GitHub Actions (DeepSeek-Coder 6.7B, a few minutes) and return the review. Up to 12,000 characters of code.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to review' },
        language: { type: 'string', description: 'Programming language' }
      },
      required: ['code']
    }
  },

// ── Coding agent: repository state, verification, persistence ───────────────
  {
    name: 'github_repo_state',
    description: 'Read the live repository state: metadata, default branch, current HEAD commit, and a file sample. Use this to identify the current HEAD before making changes. IMPORTANT: Leave branch empty to use the repository default branch (usually main, not master).',
    parameters: {
      type: 'object',
      properties: {
        owner:        { type: 'string', description: 'GitHub owner (defaults to configured)' },
        repo:         { type: 'string', description: 'GitHub repo (defaults to configured)' },
        branch:       { type: 'string', description: 'Branch to inspect (defaults to the repository default branch)' },
        sample_path:  { type: 'string', description: 'File to include in the sample preview' },
      },
      required: [],
    },
  },
  {
    name: 'github_verify_commit',
    description: 'Verify that a commit exists on GitHub after a push and confirm it changed the expected files. Use this to prove a push landed instead of assuming it did.',
    parameters: {
      type: 'object',
      properties: {
        sha:    { type: 'string', description: 'Commit SHA to verify' },
        branch: { type: 'string', description: 'Branch the commit should be on' },
        owner:  { type: 'string', description: 'GitHub owner' },
        repo:   { type: 'string', description: 'GitHub repo' },
      },
      required: ['sha'],
    },
  },
  {
    name: 'deep_research',
    description: 'Deep web research: runs up to 6 searches server-side, fetches the result pages, extracts their main text and returns numbered evidence excerpts with URLs (2-6 minutes). Use for questions that need several current sources; answer only from the returned sources and cite them as [n]. For a quick fact use web_search instead.',
    parameters: {
      type: 'object',
      properties: {
        question:    { type: 'string', description: 'The research question' },
        queries:     { type: 'array', description: '3-6 distinct search queries covering different angles of the question', items: { type: 'string' } },
        max_sources: { type: 'number', description: 'Sources to fetch, 1-15, default 8' },
      },
      required: ['question'],
    },
  },
  // ── Site deployment (githubPublish.ts) ──────────────────────────────────────
  {
    name: 'github_create_repo',
    description: 'Create a new public GitHub repository under the token owner, initialized with a main branch, to hold a website. Use before github_publish_site when the site needs its own repository. Never use the ForgeClaw repository for a site.',
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Repository name, e.g. bakery-site' },
        description: { type: 'string', description: 'One-line repository description' },
        private:     { type: 'boolean', description: 'Default false. GitHub Pages on free plans needs a public repository.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'github_publish_site',
    description: 'Publish a static website (HTML/CSS/JS) to GitHub Pages: writes ALL files in ONE commit to a site branch (default gh-pages, never main) and enables Pages for that branch if needed. Returns the commit and the site URL. A new site must include index.html; an existing branch is only updated if ForgeClaw published it. Then call github_pages_status until it reports built for that commit. Prefer this over many github_write_file calls for a site.',
    parameters: {
      type: 'object',
      properties: {
        owner:   { type: 'string', description: 'Repository owner (from github_create_repo)' },
        repo:    { type: 'string', description: 'Repository name (not forgeclaw)' },
        files:   { type: 'array', description: 'Files to write, each {path, content}. Paths are relative, e.g. index.html, css/style.css. Max 100 files, 2 MB.', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Site branch, default gh-pages' },
        enable_pages: { type: 'boolean', description: 'Default true. Use false to store SOURCE code on a branch such as "source" for github_build_site (no index.html needed, Pages untouched).' },
      },
      required: ['repo', 'files', 'message'],
    },
  },
  {
    name: 'github_pages_status',
    description: 'Read the GitHub Pages site URL and the latest build status (queued, building, built, errored) and its commit. A publish is verified only when status is built for the published commit. Pass commit and wait_seconds to wait for that build instead of polling.',
    parameters: {
      type: 'object',
      properties: {
        owner:        { type: 'string', description: 'Repository owner' },
        repo:         { type: 'string', description: 'Repository name' },
        commit:       { type: 'string', description: 'The published commit SHA to wait for' },
        wait_seconds: { type: 'number', description: 'Wait up to this long (max 300) for the build to finish. Default 0: read once.' },
      },
      required: ['repo'],
    },
  },
  {
    name: 'github_build_site',
    description: 'Build a site that needs a build step (npm, Vite, React, a bundler) and publish the output to GitHub Pages. First store the source with github_publish_site (enable_pages false, branch "source") in a public repository; this runs the build in an isolated GitHub Actions job, then publishes the output directory in one commit to gh-pages. Takes 2-6 minutes. Then verify with github_pages_status.',
    parameters: {
      type: 'object',
      properties: {
        owner:          { type: 'string', description: 'Site repository owner' },
        repo:           { type: 'string', description: 'Site repository name (public; not forgeclaw)' },
        source_branch:  { type: 'string', description: 'Branch holding the source, default "source"' },
        build_command:  { type: 'string', description: 'Default "npm ci && npm run build". Must create the output directory with an index.html.' },
        output_dir:     { type: 'string', description: 'Build output directory, default "dist" (Vite). Create React App uses "build".' },
        publish_branch: { type: 'string', description: 'Pages branch, default gh-pages' },
      },
      required: ['repo'],
    },
  },
  {
    name: 'coding_task_update',
    description: 'Persist coding-agent task state so the task can resume after a page reload or session restart. Record the objective, current HEAD, completed and pending steps, verified results, and any blockers.',
    parameters: {
      type: 'object',
      properties: {
        task:               { type: 'string', description: 'The assigned objective' },
        instructions:       { type: 'string', description: 'Instructions and constraints for this task' },
        status:             { type: 'string', description: 'Task status', enum: ['in_progress', 'blocked', 'complete', 'idle'] },
        owner:              { type: 'string', description: 'Repository owner' },
        repo:               { type: 'string', description: 'Repository name' },
        branch:             { type: 'string', description: 'Working branch' },
        head_sha:           { type: 'string', description: 'Current known HEAD commit SHA' },
        completed_steps:    { type: 'string', description: 'Completed steps — JSON array of strings' },
        pending_steps:      { type: 'string', description: 'Pending steps — JSON array of strings' },
        files_modified:     { type: 'string', description: 'Files modified — JSON array of strings' },
        verification_result:{ type: 'string', description: 'Verification evidence to record' },
        error:              { type: 'string', description: 'An error to record' },
        blocker:            { type: 'string', description: 'A blocker to record' },
        continuation:       { type: 'string', description: 'What to do next on resume' },
      },
      required: ['status'],
    },
  },
]

// ─── Context loader ────────────────────────────────────────────────────────────

export function loadToolContext(): ToolContext {
  let wa: Record<string, string> = {}
  try { wa = JSON.parse(safeGetItem('wa_credentials') || '{}') } catch { /* ignore */ }
  return {
    // Single resolution path: .env seed (VITE_GITHUB_TOKEN) → localStorage `gh_token`.
    // Reading localStorage directly here previously skipped the .env seed, so an operator
    // token provided through the environment never reached the tool dispatcher.
    ghToken:         resolveGithubToken(),
    ghOwner:         safeGetItem('fc_gh_owner') || CANONICAL_IDENTITY.owner,
    ghRepo:          safeGetItem('fc_gh_repo')  || CANONICAL_IDENTITY.repository,
    publicRelayUrl:  PUBLIC_RELAY_URL || undefined,
    waPhoneNumberId: wa.phoneNumberId,
    waAccessToken:   wa.accessToken,
    waRecipient:     wa.recipientNumber,
    braveKey:        safeGetItem('fc_brave_key')     || undefined,
    googleToken:     safeGetItem('fc_google_token')  || undefined,
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────
// The hardened browser → api.github.com boundary lives in ./githubFetch so the
// DeepSeek path shares exactly the same timeout, retry, cache and abort
// behaviour as every other GitHub tool. Re-exported here for existing callers.

export { toolFetch } from './githubFetch'

/**
 * Format the user-visible deepseek_reason success output.
 * Internal bookkeeping (learning-persistence status) is reported in the
 * Stages line, which surfaces in the reasoning trace — it must never be
 * appended to the chat-visible answer.
 */
export function formatDeepSeekResultText(
  invocationId: string,
  owner: string,
  repo: string,
  ref: string,
  stages: string,
  runUrl: string,
  result: string,
): string {
  return `✓ DeepSeek-16B completed as ${invocationId} on ${owner}/${repo}@${ref}.\n${stages}\nRun: ${runUrl}\n\n${result}`
}

/** Tools whose effects leave the repository or cannot be recalled; STOP reports them instead of claiming an undo. */
const SHELL_PATCH_MAX_CHARS = 60_000

const IRREVERSIBLE_TOOLS: ReadonlySet<string> = new Set(['send_whatsapp', 'gmail_send', 'calendar_create', 'github_create_issue', 'github_create_repo'])

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const output = await executeToolCore(call, ctx)
  if (IRREVERSIBLE_TOOLS.has(call.name) && !/^\s*\[(?:TOOL ERROR|GUARDIAN)/.test(output)) {
    journalRecord(ctx.journal, { kind: 'irreversible', label: `${call.name} (already sent or created; cannot be recalled automatically)` })
  }
  return output
}

async function executeToolCore(call: ToolCall, ctx: ToolContext): Promise<string> {
  const name = call.name === 'generateimage' ? 'generate_image' : call.name === 'deepseekreason' || call.name === 'ask_deepseek' ? 'deepseek_reason' : call.name
  const input = { ...call.input }
  if (call.name === 'ask_deepseek') {
    input.task = typeof input.question === 'string' ? input.question : ''
    input.nexus_learn = false
  }
  if (name === 'deepseek_reason' && input.nexus_learn === undefined) {
    if (input.nexuslearn !== undefined) input.nexus_learn = input.nexuslearn
    else if (input.nexusLearn !== undefined) input.nexus_learn = input.nexusLearn
  }
  const normalizedCall = name === call.name && input === call.input ? call : { ...call, name, input }
  if (ctx.signal?.aborted) return '[TOOL ERROR] Run aborted before tool execution.'
  // Self-modification needs the owner's self-sculpt key, whatever the provider or posture (sculptKey.ts).
  if (SCULPT_TOOLS.has(name) && !(ctx.sculptUnlocked ?? isSculptUnlocked())) return SCULPT_LOCKED_MESSAGE
  const posture: GuardianPosture = ctx.guardianPosture
    ?? (ctx.tier1Active !== undefined ? postureFromTier1Active(ctx.tier1Active) : DEFAULT_GUARDIAN_POSTURE)
  if (requiresCoSign(normalizedCall, posture)) {
    if (!ctx.requestGuardianApproval) {
      return `[GUARDIAN BLOCK] ${name} requires Guardian co-sign approval, but no project-owned approval handler is attached.`
    }
    const approved = await ctx.requestGuardianApproval(normalizedCall)
    if (!approved || ctx.signal?.aborted) return `[GUARDIAN REJECTED] ${name} was not executed.`
  }
  const loadState = () => loadPersistedCodingAgentState(ctx.agentId)
  const saveState = (partial: Partial<CodingAgentState>) =>
    ctx.signal?.aborted ? loadState() : savePersistedCodingAgentState(partial, ctx.agentId)
  const owner = (input.owner as string) || ctx.ghOwner
  const repo  = (input.repo  as string) || ctx.ghRepo
  const token = ctx.ghToken
  const githubRequest: GithubRequest = (url, init) => toolFetch(ctx, url, init ?? {})

  try {
    switch (name) {

      // ── GitHub: read file ────────────────────────────────────────────────────
      case 'github_read_file': {
        const path = normalizeRepositoryPath(input.path as string)
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
        if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`)
        const data = await res.json() as { content?: string; encoding?: string; size?: number }
        if (!data.content) throw new Error('No content returned (may be a directory)')
        const decoded = atob(data.content.replace(/\n/g, ''))
        return `File: ${path} (${data.size} bytes)\n\`\`\`\n${decoded.slice(0, 8000)}${decoded.length > 8000 ? '\n[truncated]' : ''}\n\`\`\``
      }

      // ── GitHub: write file ───────────────────────────────────────────────────
      case 'github_write_file': {
        const path    = normalizeRepositoryPath(input.path as string)
        const content = input.content as string
        const requestedMessage = input.message as string
        const branch  = input.branch  as string | undefined
        if (!token) throw new Error('No GitHub token configured. Add gh_token in memory or settings.')

        // Agent attribution contract: every repository write states the acting agent,
        // what changed, and why. The dispatcher owns this so no caller can produce a
        // silent or generic commit.
        const state = loadState()
        const message = buildAttributedCommitMessage({
          actor: ctx.actor,
          agentId: FORGECLAW_AGENT_ID,
          agentLabel: FORGECLAW_AGENT_LABEL,
          what: requestedMessage,
          why: requestedMessage,
          task: state.task,
          verification: state.verificationResults[state.verificationResults.length - 1],
          branch: branch || state.branch,
          headSha: state.headShaShort || state.headSha,
        })

        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        // Get existing SHA (required by GitHub API to update an existing file)
        const existingUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`
        let sha: string | undefined
        const existing = await toolFetch(ctx, existingUrl, { headers }).then(r => r.json()).catch(() => null) as { sha?: string } | null
        if (existing?.sha) sha = existing.sha

        // Last known state for STOP/rollback: the branch head before this write.
        let headBefore: string | undefined
        if (branch) {
          try {
            const refRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers })
            if (refRes.ok) headBefore = ((await refRes.json()) as { object?: { sha?: string } }).object?.sha
          } catch { /* rollback info is best-effort */ }
        }
        const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))) }
        if (sha) body.sha = sha
        if (branch) body.branch = branch
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string }
          throw new Error(err.message || `GitHub ${res.status}`)
        }
        const written = await res.json() as { commit?: { sha?: string; html_url?: string }; content?: { sha?: string } }
        if (branch && headBefore && written.commit?.sha) {
          journalRecord(ctx.journal, { kind: 'branch_advanced', branch, beforeSha: headBefore, afterSha: written.commit.sha, label: `github_write_file ${path}` })
        } else {
          journalRecord(ctx.journal, { kind: 'irreversible', label: `github_write_file ${path}${branch ? ` on ${branch}` : ' on the default branch'} (commit ${(written.commit?.sha || 'unknown').slice(0, 7)}; no automatic revert, use a revert commit)` })
        }
        // Record the change against the persisted task so the push is traceable and resumable.
        const filesModified = state.filesModified.includes(path)
          ? state.filesModified
          : [...state.filesModified, path]
        saveState({
          owner,
          repo,
          branch: branch || state.branch,
          filesModified,
          lastCommitSha: written.commit?.sha || '',
          lastCommitMessage: requestedMessage,
          activity: appendActivity(state, 'github_write_file', `${path} → ${(written.commit?.sha || 'unknown').slice(0, 7)}`),
        })
        const branchLabel = branch ? ` on branch ${branch}` : ''
        const commitSha = written.commit?.sha || ''
        return `✓ ${sha ? 'Updated' : 'Created'} ${path} in ${owner}/${repo}${branchLabel}\n  commit: ${commitSha || '(sha unavailable)'}\n  url: ${written.commit?.html_url || `https://github.com/${owner}/${repo}/commits`}\n  attributed: ${message.split('\n')[0]}${requestedMessage ? `\n  message: "${requestedMessage}"` : ''}`
      }

      // ── GitHub: get run status ───────────────────────────────────────────────
      case 'github_get_run_status': {
        const runId = input.run_id as string
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, { headers })
        if (!res.ok) {
          if (res.status === 404) throw new Error(`Run not found: "${runId}" is not a valid run ID for ${owner}/${repo}. Run IDs are long numbers (e.g. 39333499997).`)
          throw new Error(`GitHub ${res.status}`)
        }
        type Run = { id: number; name: string; status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string }
        const run = await res.json() as Run
        return `Run #${run.id} — ${run.name}\nStatus: ${run.status}\nConclusion: ${run.conclusion ?? 'pending'}\nStarted: ${run.created_at}\nUpdated: ${run.updated_at}\n${run.html_url}`
      }

      // ── GitHub: get run logs (job + step details) ────────────────────────────
      case 'github_get_run_logs': {
        const runId = input.run_id as string
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers })
        if (!res.ok) {
          if (res.status === 404) throw new Error(`Run not found: "${runId}" is not a valid run ID for ${owner}/${repo}. Run IDs are long numbers (e.g. 39333499997).`)
          throw new Error(`GitHub ${res.status}`)
        }
        type Step = { name: string; status: string; conclusion: string | null; number: number }
        type Job  = { id: number; name: string; status: string; conclusion: string | null; steps: Step[] }
        const data = await res.json() as { jobs: Job[] }
        const lines: string[] = []
        for (const job of data.jobs) {
          lines.push(`\nJOB: ${job.name} — ${job.conclusion ?? job.status}`)
          for (const step of job.steps) {
            const icon = step.conclusion === 'success' ? '✅' : step.conclusion === 'failure' ? '❌' : step.conclusion === 'skipped' ? '⏭' : '⏳'
            lines.push(`  ${icon} Step ${step.number}: ${step.name} (${step.conclusion ?? step.status})`)
          }
          // Step names alone never say why; add the error text of a failed job (first two, to bound the result).
          if (job.conclusion === 'failure' && token && lines.filter(l => l.startsWith('  Evidence:')).length < 2) {
            lines.push(`  Evidence: ${(await jobFailureEvidence((url, init) => toolFetch(ctx, url, init), { owner, repo, token, jobId: job.id })).replace(/\n/g, '\n    ')}`)
          }
        }
        return lines.join('\n').trim() || '(no jobs found)'
      }

      // ── GitHub: list files ───────────────────────────────────────────────────
      case 'github_list_files': {
        const path = normalizeRepositoryPath((input.path as string) || '')
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
        const items = await res.json() as Array<{ name: string; type: string; size?: number }>
        const lines = items.map(i => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}${i.size ? ` (${i.size}b)` : ''}`)
        return `Contents of ${path || '/'}:\n${lines.join('\n')}`
      }

      // ── GitHub: search code ──────────────────────────────────────────────────
      case 'github_search_code': {
        const query = input.query as string
        if (!token.trim()) throw new Error('GitHub code search requires authentication. Add a GitHub token in Settings; public file reads may still work without one.')
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        headers.Authorization = `token ${token}`
        const q = encodeURIComponent(`${query} repo:${owner}/${repo}`)
        // Try the search API first; fall back to git trees on transport failure.
        // The /search/code endpoint has stricter rate limits (10/min) and different
        // CORS behavior than the repos API, causing "Failed to fetch" in browsers.
        let res: Response | null = null
        let searchFailed = false
        let searchFailureMessage = ''
        try {
          res = await toolFetch(ctx, `https://api.github.com/search/code?q=${q}&per_page=10`, { headers })
        } catch (error) {
          void error
          searchFailed = true
          searchFailureMessage = describeGithubTransportFailure('GitHub code search', error)
        }
        if (res && !res.ok) {
          const body = await res.json().catch(() => null) as { message?: unknown } | null
          searchFailureMessage = typeof body?.message === 'string'
            ? body.message.replace(/\s+/g, ' ').trim().slice(0, 300)
            : ''
        }
        if (res && res.ok) {
          const data = await res.json() as { total_count: number; items: Array<{ path: string; html_url: string }> }
          const hits = data.items.map(i => `• ${i.path}`).join('\n')
          return `Found ${data.total_count} matches for "${query}":\n${hits || '(none)'}`
        }
        // Fallback: use git trees API (repos endpoint, no search rate limit)
        // to list all files and match against the query client-side.
        if (searchFailed || (res && !res.ok)) {
          let treesRes: Response
          try {
            treesRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`, { headers })
          } catch (error) {
            const fallbackFailure = describeGithubTransportFailure('GitHub code search tree fallback', error)
            throw new Error(`${searchFailureMessage || fallbackFailure} (search API unavailable, trees fallback also failed: ${fallbackFailure})`)
          }
          if (!treesRes.ok) {
            const failure = describeGithubHttpFailure('GitHub code search', res?.status ?? 0, res?.statusText ?? 'transport failure')
            const detail = searchFailureMessage ? ` GitHub message: ${searchFailureMessage}` : ''
            throw new Error(`${failure}${detail} (search API unavailable, trees fallback also failed)`)
          }
          const treesData = await treesRes.json() as { tree?: Array<{ path: string; type: string }> }
          const queryLower = query.toLowerCase()
          const matches = (treesData.tree || [])
            .filter(t => t.type === 'blob' && t.path.toLowerCase().includes(queryLower))
            .slice(0, 10)
          const hits = matches.map(m => `• ${m.path}`).join('\n')
          return `Found ${matches.length} matches for "${query}" (via file listing):\n${hits || '(none)'}`
        }
        // Should not reach here, but handle it
        throw new Error(describeGithubTransportFailure('GitHub code search', new Error('Unknown failure')))
      }

      // ── GitHub: create issue ─────────────────────────────────────────────────
      case 'github_create_issue': {
        const title = input.title as string
        const body  = input.body  as string
        if (!token) throw new Error('No GitHub token configured.')
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/issues`, { method: 'POST', headers, body: JSON.stringify({ title, body }) })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
        const data = await res.json() as { number: number; html_url: string }
        return `✓ Created issue #${data.number}: "${title}"\n${data.html_url}`
      }

      // ── GitHub: run workflow ─────────────────────────────────────────────────
      case 'github_run_workflow': {
        const workflow = input.workflow as string
        const ref = (input.ref as string) || 'main'
        if (!token) throw new Error('No GitHub token configured.')
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        const runWorkflowSince = Date.now()
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref }) })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
        journalRecord(ctx.journal, { kind: 'workflow_dispatch', workflow, since: runWorkflowSince, label: `github_run_workflow ${workflow}` })
        return `✓ Triggered ${workflow} on ${ref} in ${owner}/${repo}`
      }

      // ── DeepSeek: repository-owned primary reasoning ────────────────────────
      case 'deepseek_reason': {
        let task = typeof input.task === 'string' ? input.task.trim() : ''
        let context = typeof input.context === 'string' ? input.context : ''
        const ref = typeof input.ref === 'string' && input.ref.trim() ? input.ref.trim() : 'main'
        const nexusLearn = input.nexus_learn !== false
        const resumeInvocationId = typeof input.resume_invocation_id === 'string' && input.resume_invocation_id.trim()
          ? input.resume_invocation_id.trim()
          : null
        // Resume path: skip dispatch, go straight to waiting for the existing run.
        // Used when the app was backgrounded/killed mid-run and the user returns.
        if (resumeInvocationId) {
          const resumeDispatchedAt = typeof input.resume_dispatched_at === 'number'
            ? input.resume_dispatched_at
            : Date.now() - 5 * 60_000 // conservative: assume dispatched 5 min ago
          const completed = await waitForDeepSeekResult(ctx, owner, repo, resumeInvocationId, resumeDispatchedAt)
          if (isEmptyDeepSeekResponse(completed.result)) {
            return `[TOOL ERROR] DeepSeek-16B run ${completed.run.html_url} finished but produced an empty response.`
          }
          return formatDeepSeekResultText(resumeInvocationId, owner, repo, ref, 'Resumed after app background', completed.run.html_url, completed.result)
        }
        if (!task) throw new Error('DeepSeek task is required.')
        // GitHub workflow_dispatch inputs have size limits (~64KB total).
        // Base64 image data (data:image/...) blows past this with a 422.
        // Strip it before dispatch — the DeepSeek workflow can't process images.
        const IMAGE_DATA_PATTERN = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g
        const stripImages = (text: string) => text.replace(IMAGE_DATA_PATTERN, '[image omitted: not supported via DeepSeek workflow dispatch]')
        task = stripImages(task)
        context = stripImages(context)
        // Public visitor (no token in this browser, relay configured for this build): the owner's relay runs
        // the chat model; the owner's token, tools and NEXUS are never involved.
        if (!token && ctx.publicRelayUrl) {
          const answer = await runPublicReasoning(task, { context, relayUrl: ctx.publicRelayUrl, signal: ctx.signal })
          if (isEmptyDeepSeekResponse(answer.result)) return `[TOOL ERROR] The public model run ${answer.invocationId} produced an empty response.`
          return formatDeepSeekResultText(answer.invocationId, owner, repo, 'main', `Stages: dispatch=public-relay; result-retrieval=relay-artifact; checkpoint=${answer.model || 'unknown'}`, '(public relay run)', answer.result)
        }
        if (!token) throw new Error('No GitHub token configured.')
        // Defense-in-depth: drop context that shares no significant words with the task.
        // Stale context (e.g. 18h-old SHA Q&A) confuses DeepSeek into answering the wrong question.
        if (context && task) {
          const taskWords = new Set(task.toLowerCase().split(/\W+/).filter(w => w.length > 4))
          const contextWords = new Set(context.toLowerCase().split(/\W+/).filter(w => w.length > 4))
          const overlap = [...taskWords].filter(w => contextWords.has(w)).length
          if (overlap === 0) {
            console.warn('[deepseek_reason] Dropping stale context with zero keyword overlap to task')
            context = ''
          }
        }
        if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.startsWith('/') || ref.includes('..')) {
          throw new Error('Invalid workflow ref.')
        }
        const invocationId = `deepseek-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const dispatchedAt = Date.now()
        const headers = {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        }
        const dispatchRequest = {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ref,
            inputs: {
              task,
              context,
              nexus_learning: nexusLearn ? 'true' : 'false',
              invocation_id: invocationId,
              // 'site' (one HTML page) / 'code' (one edited source file): long-output profiles of deepseek-16b.yml.
              ...(input.profile === 'site' || input.profile === 'code' ? { profile: input.profile } : {}),
            },
          }),
        } as const
        let dispatch: Response
        try {
          dispatch = await toolFetch({ ...ctx, timeoutMs: DEEPSEEK_GITHUB_READ_TIMEOUT_MS }, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/deepseek-16b.yml/dispatches`, dispatchRequest)
        } catch (dispatchError) {
          throw new Error(describeGithubTransportFailure('deepseek-dispatch POST /actions/workflows/deepseek-16b.yml/dispatches', dispatchError))
        }
        if (!dispatch.ok) {
          // Reuse the proven dispatch classifier so a 401/403/404 reads the same
          // way here as it does in shell_exec, then keep GitHub's own message.
          const detail = await dispatch.text().catch(() => '')
          const explanation = describeGithubDispatchFailure(dispatch.status, dispatch.statusText)
          throw new Error(`deepseek-dispatch POST /actions/workflows/deepseek-16b.yml/dispatches: ${explanation}${detail ? ` DeepSeek dispatch response: ${detail.slice(0, 300)}` : ''}`)
        }
        journalRecord(ctx.journal, { kind: 'workflow_dispatch', workflow: 'deepseek-16b.yml', needle: invocationId, since: dispatchedAt, label: 'deepseek_reason' })
        try { ctx.onDeepSeekDispatch?.(invocationId, dispatchedAt) } catch { /* persistence is best-effort */ }
        const completed = await waitForDeepSeekResult(ctx, owner, repo, invocationId, dispatchedAt)
        if (isEmptyDeepSeekResponse(completed.result)) {
          return `[TOOL ERROR] DeepSeek-16B run ${completed.run.html_url} finished but produced an empty response, so there is no answer to show. Nothing was recorded for learning. Try again or rephrase.`
        }
        let learningStatus = 'not requested'
        if (nexusLearn) {
          // Learning persistence is independent of reasoning success. Its status
          // is reported in the Stages line (surfaced in the reasoning trace),
          // never appended to the user-visible answer.
          try {
            await appendDeepSeekLearning(
              task,
            completed.result,
              invocationId,
              context,
            )
            learningStatus = 'unapproved candidate recorded'
          } catch {
            learningStatus = 'failed'
          }
        }
        const checkpoint = completed.model || 'checkpoint metadata unavailable'
        const role = completed.role ? ` (${completed.role})` : ''
        const stages = `Stages: dispatch=accepted; run-discovery=correlated; run-poll=completed-successfully; result-retrieval=${completed.source}; result-extraction=complete; checkpoint=${checkpoint}${role}; learning-persistence=${learningStatus}.`
        return formatDeepSeekResultText(invocationId, owner, repo, ref, stages, completed.run.html_url, completed.result)
      }

      // ── Self-sculpt: branch + pull request proposal ──────────────────────────
      case 'sculpt_self': {
        const filePath = typeof input.file_path === 'string' ? input.file_path.trim() : ''
        const content = typeof input.content === 'string' ? input.content : ''
        const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
        let branch = typeof input.branch === 'string' ? input.branch.trim() : ''
        if (!filePath || !reason) throw new Error('file_path, content and reason are required.')
        if (!branch) branch = `sculpt/${filePath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change'}-${Date.now().toString(36)}`
        if (content.length > 60_000) throw new Error('Self-sculpt content exceeds the 60KB workflow-input limit.')
        const protectedPath = filePath === 'package.json' || filePath === 'package-lock.json' || filePath === 'src/lib/guardianGate.ts' || filePath === 'src/lib/forgeTools.ts' || filePath === '.github/workflows' || filePath.startsWith('.github/workflows/')
        if (!/^[A-Za-z0-9._/-]+$/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('.') || filePath.includes('..') || filePath === 'foundation/codex' || filePath.startsWith('foundation/codex/') || protectedPath) {
          throw new Error('Self-sculpt path is unsafe or Guardian-protected.')
        }
        if (!/^sculpt\/[a-z0-9][a-z0-9._/-]{0,60}$/.test(branch) || branch.endsWith('/') || branch.includes('..')) {
          throw new Error('Self-sculpt branch is unsafe or protected.')
        }
        if (!token) throw new Error('No GitHub token configured.')
        const invocationId = `sculpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        // Only a branch that does not exist yet may be deleted by rollback.
        let sculptBranchExisted = true
        try {
          const refRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers })
          sculptBranchExisted = refRes.status !== 404
        } catch { /* unknown: treat as existing, so rollback will not delete it */ }
        const sculptSince = Date.now()
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/self-sculpt.yml/dispatches`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref: 'main', inputs: { file_path: filePath, content, reason, branch } }),
        })
        if (!res.ok) throw new Error(`Self-sculpt dispatch failed: ${res.status}`)
        journalRecord(ctx.journal, { kind: 'workflow_dispatch', workflow: 'self-sculpt.yml', needle: branch, since: sculptSince, label: `sculpt_self ${branch}` })
        if (!sculptBranchExisted) journalRecord(ctx.journal, { kind: 'branch_created', branch, label: `sculpt_self ${branch}` })
        if (input.wait === false) return `✓ Self-sculpt ${invocationId} DISPATCHED, NOT VERIFIED for ${filePath}; look for the run "Self Sculpt ${branch}".`
        return await reportProposalRun(githubRequest, { owner, repo, token, workflow: 'self-sculpt.yml', needle: branch, since: sculptSince, branch, label: `Self-sculpt of ${filePath}`, signal: ctx.signal })
      }

      // ── Shell patch: guarded shell-repair workflow (branch + pull request proposal) ──
      case 'shell_patch': {
        const patch = typeof input.patch === 'string' ? input.patch : ''
        const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
        // The branch is generated here. Letting the model name it invites branch squatting and
        // reuse of a branch an earlier run created, which rollback must never delete.
        if (input.repair_branch !== undefined || input.branch !== undefined || input.invocation_id !== undefined) {
          throw new Error('shell_patch names its own branch and invocation id; supply only patch and reason.')
        }
        if (!patch.trim() || !reason) throw new Error('patch and reason are required.')
        // GitHub caps workflow_dispatch input payloads near 65,535 characters.
        if (patch.length > SHELL_PATCH_MAX_CHARS) throw new Error(`Patch exceeds the ${SHELL_PATCH_MAX_CHARS}-character workflow-input limit.`)
        // The workflow permits a tab but no other control character, so reject the rest before dispatch.
        const hasControlChar = Array.from(reason).some(ch => { const code = ch.charCodeAt(0); return (code < 32 && code !== 9) || code === 127 })
        if (reason.length > 240 || hasControlChar) throw new Error('reason must be one line of at most 240 characters.')
        if (!/^(?:diff --git |--- )/m.test(patch)) throw new Error('patch must be a unified diff (git apply format).')
        // The workflow refuses symlinks authoritatively; failing here saves a dispatch that cannot succeed.
        if (/^(?:new file mode|new mode|index [0-9a-f.]+) 120000\s*$/m.test(patch)) throw new Error('A patch may not create a symbolic link.')
        if (!token) throw new Error('No GitHub token configured.')
        const invocationId = `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const repairBranch = `forge/repair/${invocationId}`
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        // Only a branch that does not exist yet may be deleted by rollback.
        let repairBranchExisted = true
        try {
          const refRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${repairBranch}`, { headers })
          repairBranchExisted = refRes.status !== 404
        } catch { /* unknown: treat as existing, so rollback will not delete it */ }
        const repairSince = Date.now()
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/shell-repair.yml/dispatches`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref: 'main', inputs: { repair_branch: repairBranch, patch, reason, invocation_id: invocationId } }),
        })
        if (!res.ok) throw new Error(describeGithubDispatchFailure(res.status, res.statusText))
        // Run-name is "Shell repair <invocation id>", so the id finds exactly this run.
        journalRecord(ctx.journal, { kind: 'workflow_dispatch', workflow: 'shell-repair.yml', needle: invocationId, since: repairSince, label: `shell_patch ${repairBranch}` })
        if (!repairBranchExisted) journalRecord(ctx.journal, { kind: 'branch_created', branch: repairBranch, label: `shell_patch ${repairBranch}` })
        if (input.wait === false) return `✓ Shell-patch ${invocationId} DISPATCHED, NOT VERIFIED. Look for the run named "Shell repair ${invocationId}".`
        return await reportProposalRun(githubRequest, { owner, repo, token, workflow: 'shell-repair.yml', needle: invocationId, since: repairSince, branch: repairBranch, label: `Shell-patch ${invocationId}`, signal: ctx.signal })
      }

      // ── HTTP fetch ───────────────────────────────────────────────────────────
      case 'http_fetch': {
        const url    = input.url    as string
        const method = (input.method as string) || 'GET'
        const hdrs   = input.headers ? JSON.parse(input.headers as string) as Record<string, string> : {}
        const body   = input.body   as string | undefined
        const res = await toolFetch(ctx, url, { method, headers: hdrs, body })
        const text = await res.text()
        return `HTTP ${res.status} ${res.statusText}\n${text.slice(0, 4000)}${text.length > 4000 ? '\n[truncated]' : ''}`
      }

      // ── Memory ───────────────────────────────────────────────────────────────
      case 'memory_write': {
        const key = `fc_mem_${input.key as string}`
        safeSetItem(key, input.value as string)
        return `✓ Stored "${input.key}" in memory.`
      }
      case 'memory_read': {
        const key = `fc_mem_${input.key as string}`
        const val = safeGetItem(key)
        return val !== null ? val : `(no value stored for key "${input.key}")`
      }
      case 'memory_list': {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k?.startsWith('fc_mem_')) keys.push(k.replace('fc_mem_', ''))
        }
        return keys.length ? `Memory keys:\n${keys.map(k => `• ${k}`).join('\n')}` : '(no keys stored)'
      }

      // ── WhatsApp ─────────────────────────────────────────────────────────────
      case 'send_whatsapp': {
        const text = input.text as string
        const to   = (input.to as string) || ctx.waRecipient
        if (!ctx.waPhoneNumberId || !ctx.waAccessToken) throw new Error('WhatsApp not configured. Open the WhatsApp tab → SETUP.')
        if (!to) throw new Error('No recipient number. Provide "to" or configure a default in WhatsApp SETUP.')
        const res = await toolFetch(ctx, `https://graph.facebook.com/v19.0/${ctx.waPhoneNumberId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.waAccessToken}` },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(e.error?.message || `Meta ${res.status}`)
        }
        return `✓ WhatsApp message sent to ${to}: "${text}"`
      }

      // ── JavaScript runner ─────────────────────────────────────────────────────
      case 'run_js': {
        const code = input.code as string
        const fn = new Function(`"use strict"; ${code}`)
        const result: unknown = fn()
        const out = result instanceof Promise ? await result : result
        return String(out ?? '(no return value)')
      }

      // ── Web search ────────────────────────────────────────────────────────────
      case 'web_search': {
        const query = input.query as string
        const count = Math.min(parseInt(String(input.count || '5'), 10) || 5, 10)

        if (ctx.braveKey) {
          const res = await toolFetch(ctx,
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
            { headers: { Accept: 'application/json', 'X-Subscription-Token': ctx.braveKey } },
          )
          if (!res.ok) throw new Error(`Brave Search ${res.status}`)
          type BraveResult = { title: string; url: string; description: string }
          const data = await res.json() as { web?: { results: BraveResult[] } }
          const results = data.web?.results || []
          if (!results.length) return `No results for "${query}"`
          return `Brave Search — "${query}":\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join('\n\n')}`
        }

        // Real results without a key: the read-only ddg_search.yml workflow (see ddgWorkflowSearch.ts).
        // Failure is reported, then we fall back to Instant Answers rather than failing silently.
        let workflowNote = ''
        if (ctx.ghToken) {
          try {
            return await runDdgWorkflowSearch(query, count, {
              fetcher: (url, init) => toolFetch(ctx, url, init),
              owner: ctx.ghOwner, repo: ctx.ghRepo, token: ctx.ghToken, signal: ctx.signal,
            })
          } catch (error) {
            workflowNote = `[DuckDuckGo workflow search failed: ${error instanceof Error ? error.message : String(error)}. Falling back to Instant Answers, which are not full web search.]\n`
          }
        }

        // Fallback: DuckDuckGo Instant Answers (no key, CORS-enabled)
        const res = await toolFetch(ctx,
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        )
        if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
        type DDGResult = { AbstractText?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> }
        const data = await res.json() as DDGResult
        const parts: string[] = []
        if (data.AbstractText) parts.push(`Summary: ${data.AbstractText}`)
        const topics = (data.RelatedTopics || []).slice(0, count).filter(t => t.Text)
          .map(t => `• ${t.Text}${t.FirstURL ? `\n  ${t.FirstURL}` : ''}`)
        if (topics.length) parts.push(topics.join('\n'))
        return workflowNote + (parts.length
          ? `DuckDuckGo — "${query}":\n${parts.join('\n\n')}`
          : `No results for "${query}". Add a Brave Search API key in Settings for full web results.`)
      }

      // ── Gmail: read ───────────────────────────────────────────────────────────
      case 'gmail_read': {
        if (!ctx.googleToken) throw new Error('No Google OAuth token. Add it in Settings → Google OAuth Token.')
        const q = encodeURIComponent((input.query as string) || '')
        const max = Math.min(parseInt(String(input.max_results || '10'), 10) || 10, 20)
        const listRes = await toolFetch(ctx,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q ? `&q=${q}` : ''}`,
          { headers: { Authorization: `Bearer ${ctx.googleToken}` } },
        )
        if (!listRes.ok) throw new Error(`Gmail API ${listRes.status} — check your Google OAuth token`)
        type MsgRef = { id: string }
        const listData = await listRes.json() as { messages?: MsgRef[] }
        const msgs = listData.messages || []
        if (!msgs.length) return input.query ? `No emails matching "${input.query}"` : 'No emails found.'
        const details = await Promise.all(msgs.map(async m => {
          const dr = await toolFetch(ctx,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${ctx.googleToken!}` } },
          )
          if (!dr.ok) return null
          type Header = { name: string; value: string }
          type MsgDetail = { snippet: string; payload: { headers: Header[] } }
          const d = await dr.json() as MsgDetail
          const get = (n: string) => d.payload.headers.find(h => h.name === n)?.value ?? ''
          return `From: ${get('From')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}\n${d.snippet}`
        }))
        return details.filter(Boolean).map((d, i) => `--- Email ${i + 1} ---\n${d}`).join('\n\n')
      }

      // ── Gmail: send ────────────────────────────────────────────────────────────
      case 'gmail_send': {
        if (!ctx.googleToken) throw new Error('No Google OAuth token. Add it in Settings → Google OAuth Token.')
        const to      = input.to      as string
        const subject = input.subject as string
        const body    = input.body    as string
        const raw = `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        const res = await toolFetch(ctx, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.googleToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded }),
        })
        if (!res.ok) throw new Error(`Gmail send ${res.status} — check OAuth token scope (gmail.send required)`)
        return `✓ Email sent to ${to} — "${subject}"`
      }

      // ── Calendar: read ─────────────────────────────────────────────────────────
      case 'calendar_read': {
        if (!ctx.googleToken) throw new Error('No Google OAuth token. Add it in Settings → Google OAuth Token.')
        const daysAhead  = parseInt(String(input.days_ahead  || '7'),  10) || 7
        const maxResults = parseInt(String(input.max_results || '10'), 10) || 10
        const now    = new Date()
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
        const params = new URLSearchParams({
          timeMin: now.toISOString(), timeMax: future.toISOString(),
          maxResults: String(maxResults), orderBy: 'startTime', singleEvents: 'true',
        })
        const res = await toolFetch(ctx, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
          headers: { Authorization: `Bearer ${ctx.googleToken}` },
        })
        if (!res.ok) throw new Error(`Calendar API ${res.status} — check OAuth token scope (calendar.readonly required)`)
        type CalEvent = { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }
        const data = await res.json() as { items?: CalEvent[] }
        const items = data.items || []
        if (!items.length) return `No events in the next ${daysAhead} days.`
        return items.map((e, i) => {
          const start = e.start?.dateTime ?? e.start?.date ?? 'TBD'
          const end   = e.end?.dateTime   ?? e.end?.date   ?? ''
          const loc   = e.location ? `\n  📍 ${e.location}` : ''
          return `${i + 1}. ${e.summary ?? '(no title)'}\n  🕐 ${start}${end ? ` → ${end}` : ''}${loc}`
        }).join('\n\n')
      }

      // ── Calendar: create ────────────────────────────────────────────────────────
      case 'calendar_create': {
        if (!ctx.googleToken) throw new Error('No Google OAuth token. Add it in Settings → Google OAuth Token.')
        const summary     = input.summary     as string
        const start       = input.start       as string
        const end         = input.end         as string
        const description = input.description as string | undefined
        const location    = input.location    as string | undefined
        const event: Record<string, unknown> = { summary, start: { dateTime: start }, end: { dateTime: end } }
        if (description) event.description = description
        if (location)    event.location    = location
        const res = await toolFetch(ctx, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.googleToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        if (!res.ok) throw new Error(`Calendar create ${res.status} — check OAuth token scope (calendar required)`)
        type CreatedEvent = { htmlLink: string }
        const created = await res.json() as CreatedEvent
        return `✓ Event created: "${summary}" starting ${start}\n${created.htmlLink}`
      }

      // ── Shell execution via GitHub Actions ───────────────────────────────────
      case 'shell_exec': {
        const command    = normalizeKnownShellExecutable(typeof input.command === 'string' ? input.command : String(input.command || ''))
        const maxWait    = Math.min(parseInt(String(input.timeout_seconds || '600'), 10) || 600, 600)
        const shouldWait = (input.wait as boolean) !== false

        const sOwner = (input.owner as string) || ctx.ghOwner
        const sRepo  = (input.repo  as string) || ctx.ghRepo
        const sToken = ctx.ghToken
        const repositoryName = sRepo.split('/').filter(Boolean).at(-1) || sRepo
        const workingDir = normalizeShellWorkingDirectoryInput(input.working_directory || '.', repositoryName)
        if (!workingDir) {
          throw new Error('shell_exec working_directory must resolve inside the checked-out repository. Use "." for root or a repository-relative path; /workspace paths are normalized automatically.')
        }

        if (!sToken) throw new Error('No GitHub token configured. Add gh_token in memory or settings.')
        if (!command) throw new Error('shell_exec requires a command.')

        const sHeaders = {
          Authorization: `token ${sToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        }

        const randomSuffix = globalThis.crypto?.randomUUID?.().slice(0, 8)
          ?? Math.random().toString(36).slice(2, 10)

        const invocationId = `shell-${Date.now()}-${randomSuffix}`
        const workflowUrl = `https://api.github.com/repos/${sOwner}/${sRepo}/actions/workflows/shell-exec.yml`
        const dispatchStartedAt = Date.now()

        const dispatchRes = await toolFetch(ctx, `${workflowUrl}/dispatches`, {
          method: 'POST',
          headers: sHeaders,
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              command,
              working_directory: workingDir,
              invocation_id: invocationId,
            },
          }),
        })

        if (!dispatchRes.ok) {
          throw new Error(describeGithubDispatchFailure(dispatchRes.status, dispatchRes.statusText))
        }
        journalRecord(ctx.journal, { kind: 'workflow_dispatch', workflow: 'shell-exec.yml', needle: invocationId, since: dispatchStartedAt, label: 'shell_exec' })

        // What discovery saw, so a "not found" can say why instead of guessing. Names and IDs only;
        // nothing here is secret, and GitHub-supplied text is truncated before it is shown.
        const discovery = {
          polls: 0,
          lastError: '' as string,
          listed: -1,
          newest: '' as string,
          sameIdReason: '' as string,
        }
        const brief = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').slice(0, 80)

        const findCorrelatedRun = async (): Promise<ShellWorkflowRun | undefined> => {
          discovery.polls += 1
          const runsRes = await toolFetch(
            ctx,
            `${workflowUrl}/runs?event=workflow_dispatch&per_page=100`,
            // GitHub caches REST GET responses briefly. Polling the identical
            // URL without cache bypass can replay the pre-dispatch list until
            // discovery times out, even though the workflow has already run.
            { headers: sHeaders, cache: 'no-store' },
          )
          if (!runsRes.ok) throw new Error(`GitHub runs list ${runsRes.status}`)
          const runsData = await runsRes.json() as { workflow_runs?: ShellWorkflowRun[] }
          const runs = runsData.workflow_runs || []
          discovery.listed = runs.length
          const newest = runs[0]
          discovery.newest = newest
            ? `"${brief(newest.name || newest.display_title)}" created ${brief(newest.created_at)} (${brief(newest.event)}, ${brief(newest.head_branch)})`
            : 'none'
          const sameId = runs.find(run => `${run.name ?? ''} ${run.display_title ?? ''}`.includes(invocationId))
          discovery.sameIdReason = sameId ? (explainShellRunMismatch(sameId, invocationId, dispatchStartedAt) ?? '') : ''
          return runs.find(run => isCorrelatedShellRun(run, invocationId, dispatchStartedAt))
        }

        const findDeadline = Date.now() + SHELL_RUN_LIST_TIMEOUT_MS
        let run: ShellWorkflowRun | undefined

        const discoveryDelays = [100, 250, 500, 1000, 2000] as const
        let discoveryAttempt = 0

        while (!run && Date.now() < findDeadline) {
          if (ctx.signal?.aborted) return '[TOOL ERROR] Run aborted while locating shell execution.'
          try {
            run = await findCorrelatedRun()
          } catch (error) {
            // A single GitHub read timeout must not discard a successfully
            // dispatched workflow. Keep polling within the bounded window;
            // authentication and configuration failures still surface.
            const detail = error instanceof Error ? error.message : String(error)
            discovery.lastError = brief(detail)
            if (!/timed out|failed to fetch|network|GitHub runs list (?:429|500|502|503|504)/i.test(detail)) throw error
          }
          if (run) break

          const remainingMs = findDeadline - Date.now()
          if (remainingMs <= 0) break

          const delayMs = Math.min(
            discoveryDelays[Math.min(discoveryAttempt, discoveryDelays.length - 1)],
            remainingMs,
          )
          discoveryAttempt += 1
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
        }

        if (!run) {
          const sameIdLine = discovery.listed < 0
            ? 'no run list was ever read successfully'
            : discovery.sameIdReason
              ? `a run with this invocation ID was listed but rejected: ${discovery.sameIdReason}`
              : `no listed run carried this invocation ID (${discovery.listed} run(s) in the last list)`
          throw new Error(
            `Shell execution dispatched but correlated run "${invocationId}" was not found.\n`
            + `Discovery: ${discovery.polls} poll(s) over ${Math.round((Date.now() - dispatchStartedAt) / 1000)}s; `
            + `last swallowed error: ${discovery.lastError || 'none'}; ${sameIdLine}; newest listed run: ${discovery.newest || 'n/a'}.\n`
            + `Runs: https://github.com/${sOwner}/${sRepo}/actions/workflows/shell-exec.yml`,
          )
        }

        if (!shouldWait) {
          return `Shell execution dispatched. Run #${run.run_number} (id: ${run.id})\nInvocation: ${invocationId}\nURL: ${run.html_url}`
        }

        const statusDelays = [500, 1000, 2000, 3000, 5000] as const
        let statusAttempt = 0
        const startTime = Date.now()
        let lastStatus = run.status
        let finalRun = run

        while (Date.now() - startTime < maxWait * 1000) {
          if (ctx.signal?.aborted) return '[TOOL ERROR] Run aborted while waiting for shell execution.'
          const statusRes = await toolFetch(
            ctx,
            `https://api.github.com/repos/${sOwner}/${sRepo}/actions/runs/${run.id}`,
            { headers: sHeaders },
          )
          if (!statusRes.ok) throw new Error(`GitHub run status ${statusRes.status}`)
          const statusData = await statusRes.json() as ShellWorkflowRun
          finalRun = statusData
          lastStatus = statusData.status
          if (statusData.status === 'completed') break

          const elapsedMs = Date.now() - startTime
          const remainingMs = maxWait * 1000 - elapsedMs
          if (remainingMs <= 0) break

          const delayMs = Math.min(
            statusDelays[Math.min(statusAttempt, statusDelays.length - 1)],
            remainingMs,
          )
          statusAttempt += 1
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
        }

        if (finalRun.status !== 'completed') {
          return `[TOOL ERROR] Shell execution timed out waiting after ${maxWait}s, but the run may STILL BE RUNNING on GitHub. Do NOT retry the command (a retry would execute it a second time); open the URL to check. Run #${finalRun.run_number} (id: ${finalRun.id})\nInvocation: ${invocationId}\nLast status: ${lastStatus}\nConclusion: ${finalRun.conclusion ?? 'unknown'}\nURL: ${finalRun.html_url}`
        }

        type WorkflowJob = { id: number; name: string; conclusion: string | null }
        const logDeadline = Date.now() + SHELL_LOG_RETRIEVAL_TIMEOUT_MS
        let rawLogs: string | undefined
        let lastLogStatus = 'pending'
        while (!rawLogs && Date.now() < logDeadline) {
          if (ctx.signal?.aborted) return '[TOOL ERROR] Shell execution aborted while retrieving logs.'
          const jobsRes = await toolFetch(
            ctx,
            `https://api.github.com/repos/${sOwner}/${sRepo}/actions/runs/${finalRun.id}/jobs?per_page=20`,
            { headers: sHeaders },
          )
          if (!jobsRes.ok) {
            lastLogStatus = `jobs ${jobsRes.status}`
          } else {
            const jobsData = await jobsRes.json() as { jobs?: WorkflowJob[] }
            const job = (jobsData.jobs || []).find(j => j.name === 'execute') || jobsData.jobs?.[0]
            if (job) {
              const logsRes = await toolFetch(
                ctx,
                `https://api.github.com/repos/${sOwner}/${sRepo}/actions/jobs/${job.id}/logs`,
                { headers: sHeaders },
              )
              if (logsRes.ok) rawLogs = await logsRes.text()
              else lastLogStatus = `logs ${logsRes.status}`
            } else {
              lastLogStatus = 'job not yet available'
            }
          }
          if (!rawLogs) {
            const remainingMs = logDeadline - Date.now()
            if (remainingMs <= 0) break
            await new Promise<void>(resolve => setTimeout(resolve, Math.min(SHELL_LOG_POLL_INTERVAL_MS, remainingMs)))
          }
        }
        if (!rawLogs) {
          return `[TOOL ERROR] Shell execution completed but logs remained unavailable after ${SHELL_LOG_RETRIEVAL_TIMEOUT_MS / 1000}s.\nRun #${finalRun.run_number} (id: ${finalRun.id})\nInvocation: ${invocationId}\nStatus: ${finalRun.status}\nConclusion: ${finalRun.conclusion ?? 'unknown'}\nLast log state: ${lastLogStatus}`
        }
        const { commandOutput, exitCode } = parseShellExecutionLog(rawLogs, finalRun.conclusion)

        const exercise = getShellExercise(input.exercise_id as string | undefined || '')
        if (exercise) {
          const dispatchTimestamp = new Date(dispatchStartedAt).toISOString()
          const completionTimestamp = new Date().toISOString()
          const rawExperience = await createShellRawExperience({
            exerciseId: exercise.exerciseId,
            competencyLevel: exercise.level,
            objective: exercise.objective,
            difficulty: exercise.difficulty,
            repository: `${sOwner}/${sRepo}`,
            requestedRef: 'main',
            workingDirectory: workingDir,
            command,
            safety: exercise.safety,
            mutation: exercise.mutation,
            invocationId,
            runId: String(finalRun.id),
            runNumber: finalRun.run_number,
            branch: finalRun.head_branch,
            workflowStatus: finalRun.status,
            workflowConclusion: finalRun.conclusion,
            exitCode,
            actualResult: commandOutput,
            expectedResult: exercise.expectedResult,
            runtime: 'github-actions',
            dispatchTimestamp,
            completionTimestamp,
            sourceWorkflow: 'shell-exec.yml',
            ...(finalRun.head_sha ? { sourceCommit: finalRun.head_sha } : {}),
            provenance: {
              repository: `${sOwner}/${sRepo}`,
              requestedRef: 'main',
              workingDirectory: workingDir,
              sourceWorkflow: 'shell-exec.yml',
              ...(finalRun.head_sha ? { sourceCommit: finalRun.head_sha } : {}),
              runtime: 'github-actions',
              dispatchTimestamp,
              completionTimestamp,
            },
            verified: true,
          })
          // The candidate remains unapproved; persistence cannot change the
          // already verified Shell result or its error classification.
          try { await corpusRepository.appendShellExperience(shellExperienceAsCorpusInput(rawExperience)) } catch { /* optional evidence persistence */ }
        }

        if (exitCode !== 0 || finalRun.conclusion !== 'success') {
          return [
            `[TOOL ERROR] Shell execution failed.`,
            `Run #${finalRun.run_number} (id: ${finalRun.id})`,
            `Invocation: ${invocationId}`,
            `Command: ${command}`,
            `Exit code: ${exitCode}`,
            `Conclusion: ${finalRun.conclusion ?? 'unknown'}`,
            '',
            commandOutput || '(no command output captured)',
          ].join('\n')
        }

        return [
          `Shell execution complete.`,
          `Run #${finalRun.run_number} (id: ${finalRun.id})`,
          `Invocation: ${invocationId}`,
          `Command: ${command}`,
          `Exit code: ${exitCode}`,
          '',
          commandOutput || '(command produced no output)',
        ].join('\n')
      }

      // ── Spawn sub-agent ────────────────────────────────────────────────────────
      
      case 'generate_image':
      case 'generateimage': { // Compatibility alias; canonical schema name remains generate_image.
        const prompt = typeof input.prompt === 'string' ? cleanImagePrompt(input.prompt) : ''
        const style = typeof input.style === 'string' && input.style.trim() ? input.style.trim() : 'realistic'
        const width = input.width === undefined ? 512 : Number(input.width)
        const height = input.height === undefined ? 512 : Number(input.height)
        if (!prompt || prompt.length > 4000) throw new Error('Image prompt must contain 1-4000 characters.')
        if (style.length > 100) throw new Error('Image style must be at most 100 characters.')
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || width > 1024 || height < 256 || height > 1024 || width % 8 !== 0 || height % 8 !== 0) {
          throw new Error('Image width and height must be integers from 256 to 1024 and divisible by 8.')
        }
        const model = input.model === undefined || input.model === '' ? 'sd15' : String(input.model)
        if (!(IMAGE_MODELS as readonly string[]).includes(model)) throw new Error(`Unknown image model '${model}'. Allowed: ${IMAGE_MODELS.join(', ')}.`)
        if (model !== 'sd15' && (width > 512 || height > 512)) throw new Error(`Image model '${model}' is only verified up to 512x512.`)
        if (!token) throw new Error('No GitHub token configured.')

        // The owner's own taste (nexusTaste.ts, learned from his reactions) steers the prompt; empty until it has enough to say.
        const tastePrompt = tasteForImagePrompt()
        const improved = suggestImprovedPrompt(tastePrompt ? `${prompt}, ${tastePrompt}` : prompt, style)
        const invocationId = `sd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const dispatchStartedAt = Date.now()

        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate-image.yml/dispatches`, {
          method: 'POST',
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ref: 'main',
            inputs: { prompt: improved.prompt, style, width: String(width), height: String(height), model, invocation_id: invocationId },
          }),
        })

        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`Image workflow dispatch failed: ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
        }

        const run = await waitForImageRun(ctx, owner, repo, invocationId, dispatchStartedAt)
        const image = await downloadImagePng(ctx, owner, repo, run.id, invocationId)
        registerGeneratedImage(invocationId, image.dataUrl)

        await appendImageGenerationLearning({ prompt: improved.prompt, style, width, height, invocationId })

        return [
          `✓ Image generated (${image.width}x${image.height}, ${Math.round(image.bytes / 1024)} KB) via run #${run.run_number}.`,
          `Invocation: ${invocationId}`,
          `Enhanced prompt: "${improved.prompt}"`,
          `Run: ${run.html_url}`,
        ].join('\n')
      }

      case 'analyze_image': {
        if (!token) throw new Error('No GitHub token configured. analyze_image runs as a GitHub Actions job and needs gh_token with Contents and Actions: write.')
        // Used to return "Dispatched" and never the answer, and could not take an uploaded picture at all.
        const requested = String(input.image_url || '').trim()
        const image = requested && requested !== ATTACHED_IMAGE ? requested : currentAttachedImage()
        if (!image) throw new Error('No picture is attached to this message, and no https image URL was given.')
        // The workflow lives in ForgeClaw's own repository regardless of any owner/repo in the call.
        const result = await runImageAnalysis(githubRequest, { owner: ctx.ghOwner, repo: ctx.ghRepo, token, prompt: String(input.prompt || ''), image, signal: ctx.signal })
        return formatImageAnalysis(result)
      }


      case 'weather_forecast': {
        // Free, keyless, browser-allowed: works for the owner and for free-mode visitors alike.
        const day = input.day === undefined || input.day === null || input.day === '' ? null : Number(input.day)
        return await weatherForecast({ place: String(input.place || ''), day: Number.isFinite(day as number) ? day : null, signal: ctx.signal })
      }

      case 'review_code': {
        if (!token) throw new Error('No GitHub token configured. review_code runs as a GitHub Actions job and needs gh_token with Actions: write.')
        // Used to return "dispatched" and never the review. The workflow lives in ForgeClaw's own repository.
        const result = await runCodeReview(githubRequest, { owner: ctx.ghOwner, repo: ctx.ghRepo, token, code: String(input.code || ''), language: input.language as string | undefined, signal: ctx.signal })
        return formatCodeReview(result)
      }

case 'spawn_agent': {
        if (!ctx.spawnAgent) throw new Error('Sub-agent support not initialized.')
        const systemPrompt = input.system_prompt as string
        const task         = input.task          as string
        const toolsStr     = input.tools         as string | undefined
        const tools        = toolsStr ? toolsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined
        return await ctx.spawnAgent(systemPrompt, task, tools)
      }

      // ── Coding agent: live repository state (HEAD, branch, metadata) ───────────
      case 'github_repo_state': {
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const metaRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}`, { headers })
        if (!metaRes.ok) throw new Error(`GitHub repo ${metaRes.status} — check owner/repo and token scope`)
        const meta = await metaRes.json() as { default_branch: string; html_url: string; private: boolean; pushed_at: string }
        // Always use the repo's default branch unless explicitly overridden with a valid branch
        const requestedBranch = (input.branch as string)?.trim()
        const branch = (!requestedBranch || requestedBranch === 'master') ? meta.default_branch : requestedBranch
        const commitRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, { headers })
        if (!commitRes.ok) throw new Error(`GitHub commit ${commitRes.status} — branch "${branch}" may not exist`)
        const commit = await commitRes.json() as {
          sha: string
          html_url: string
          commit: { message: string; author: { name?: string; date?: string } }
        }
        let sample = ''
        const samplePath = (input.sample_path as string) || 'package.json'
        try {
          const fileRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/contents/${samplePath}?ref=${encodeURIComponent(branch)}`, { headers })
          if (fileRes.ok) {
            const file = await fileRes.json() as { content?: string }
            if (file.content) sample = atob(file.content.replace(/\n/g, '')).slice(0, 1200)
          }
        } catch { /* sample is informational only */ }

        const state = loadState()
        saveState({
          owner,
          repo,
          branch,
          headSha: commit.sha,
          headShaShort: commit.sha.slice(0, 7),
          activity: appendActivity(state, 'github_repo_state', `${owner}/${repo}@${branch} HEAD ${commit.sha.slice(0, 7)}`),
        })

        return [
          `repo: ${owner}/${repo}${meta.private ? ' (private)' : ''}`,
          `url: ${meta.html_url}`,
          `defaultBranch: ${meta.default_branch}`,
          `inspectedBranch: ${branch}`,
          `HEAD: ${commit.sha}`,
          `HEAD short: ${commit.sha.slice(0, 7)}`,
          `HEAD commit: ${commit.commit.message.split('\n')[0]}`,
          `HEAD author: ${commit.commit.author?.name ?? 'unknown'} @ ${commit.commit.author?.date ?? 'unknown'}`,
          `lastPush: ${meta.pushed_at}`,
          `sample (${samplePath}):`,
          sample ? `\`\`\`\n${sample}\n\`\`\`` : '(sample unavailable)',
        ].join('\n')
      }

      // ── Coding agent: prove a pushed commit exists on GitHub ──────────────────
      case 'github_verify_commit': {
        const sha = String(input.sha || '').trim()
        if (!sha) throw new Error('sha is required')
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`, { headers })
        if (!res.ok) {
          return `✗ VERIFICATION FAILED — commit ${sha} not found in ${owner}/${repo} (GitHub ${res.status}).`
        }
        const commit = await res.json() as {
          sha: string
          html_url: string
          commit: { message: string; author: { name?: string; date?: string } }
          files?: Array<{ filename: string; status: string; additions: number; deletions: number }>
        }
        const files = commit.files ?? []
        const fileLines = files.length
          ? files.map(f => `  ${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')
          : '  (no file list returned)'
        // Branch containment is a separate API call; report it explicitly rather than assuming.
        let onBranch = 'not checked'
        const branch = input.branch as string | undefined
        if (branch) {
          const brRes = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { headers })
          onBranch = brRes.ok
            ? `branch "${branch}" resolves`
            : `branch "${branch}" NOT FOUND`
        }
        const state = loadState()
        saveState({
          verificationResults: [
            ...state.verificationResults,
            `verified commit ${sha.slice(0, 7)} on ${owner}/${repo} — ${files.length} file(s) changed`,
          ],
          activity: appendActivity(state, 'github_verify_commit', `${sha.slice(0, 7)} verified (${files.length} files)`),
        })
        return [
          `✓ VERIFIED — commit exists in ${owner}/${repo}`,
          `sha: ${commit.sha}`,
          `subject: ${commit.commit.message.split('\n')[0]}`,
          `author: ${commit.commit.author.name ?? 'unknown'} @ ${commit.commit.author.date ?? 'unknown'}`,
          `url: ${commit.html_url}`,
          `branchCheck: ${onBranch}`,
          `files changed (${files.length}):`,
          fileLines,
        ].join('\n')
      }

      // ── Coding agent: persist task state so the task resumes after reload ─────
      case 'coding_task_update': {
        const parseList = (value: unknown): string[] | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          if (Array.isArray(value)) return value.map(String)
          try {
            const parsed = JSON.parse(String(value))
            return Array.isArray(parsed) ? parsed.map(String) : [String(value)]
          } catch {
            return [String(value)]
          }
        }
        const previous = loadState()
        const status = (input.status as CodingAgentState['taskStatus']) || previous.taskStatus
        const completed = parseList(input.completed_steps)
        const pending = parseList(input.pending_steps)
        const modified = parseList(input.files_modified)
        const verification = input.verification_result as string | undefined
        const error = input.error as string | undefined
        const blocker = input.blocker as string | undefined

        const next = saveState({
          task: (input.task as string | undefined) ?? previous.task,
          taskInstructions: (input.instructions as string | undefined) ?? previous.taskInstructions,
          taskStatus: status,
          owner: (input.owner as string | undefined) ?? previous.owner,
          repo: (input.repo as string | undefined) ?? previous.repo,
          branch: (input.branch as string | undefined) ?? previous.branch,
          headSha: (input.head_sha as string | undefined) ?? previous.headSha,
          headShaShort: input.head_sha ? String(input.head_sha).slice(0, 7) : previous.headShaShort,
          completedSteps: completed ?? previous.completedSteps,
          pendingSteps: pending ?? previous.pendingSteps,
          filesModified: modified ?? previous.filesModified,
          continuationNotes: (input.continuation as string | undefined) ?? previous.continuationNotes,
          verificationResults: verification ? [...previous.verificationResults, verification] : previous.verificationResults,
          errors: error ? [...previous.errors, error] : previous.errors,
          blockers: blocker ? [...previous.blockers, blocker] : previous.blockers,
          activity: appendActivity(previous, 'coding_task_update', `${status}${blocker ? ` — blocker: ${blocker}` : ''}`),
        })
        return `✓ Coding agent state persisted — status: ${next.taskStatus}, repo: ${next.owner}/${next.repo}@${next.branch}, HEAD: ${next.headShaShort || '(unknown)'}, updated: ${next.updatedAt}`
      }

      // ── Deep research ────────────────────────────────────────────────────────
      case 'deep_research': {
        // Public visitor: the owner's relay runs the same research workflow; no token in this browser.
        if (!token && ctx.publicRelayUrl) {
          const { report, runUrl } = await runPublicResearch(String(input.question || ''), { relayUrl: ctx.publicRelayUrl, signal: ctx.signal })
          return formatResearchResult(report, runUrl)
        }
        if (!token) throw new Error('No GitHub token configured. deep_research runs as a GitHub Actions job and needs gh_token with Actions: write.')
        // The workflow lives in ForgeClaw's own repository regardless of any owner/repo in the call.
        const { report, runUrl } = await runDeepResearch(githubRequest, {
          owner: ctx.ghOwner, repo: ctx.ghRepo, token,
          question: String(input.question || ''), queries: normalizeQueries(input.queries),
          maxSources: Number(input.max_sources) || undefined, signal: ctx.signal,
        })
        return formatResearchResult(report, runUrl)
      }

      // ── Site deployment ──────────────────────────────────────────────────────
      case 'github_create_repo': {
        const created = await createRepo(githubRequest, { token, name: String(input.name || ''), description: input.description as string | undefined, private: input.private === true })
        return `✓ Created repository ${created.owner}/${created.repo} (default branch ${created.defaultBranch})\n  url: ${created.url}\n  next: github_publish_site with owner "${created.owner}" and repo "${created.repo}"`
      }

      case 'github_publish_site': {
        const requestedMessage = String(input.message || '').trim() || 'Publish site'
        const state = loadState()
        // Same attribution contract as github_write_file: the commit names the acting agent and task.
        const message = buildAttributedCommitMessage({
          actor: ctx.actor,
          agentId: FORGECLAW_AGENT_ID,
          agentLabel: FORGECLAW_AGENT_LABEL,
          what: requestedMessage,
          why: requestedMessage,
          task: state.task,
          verification: state.verificationResults[state.verificationResults.length - 1],
          branch: (input.branch as string | undefined) || 'gh-pages',
        })
        const result = await publishSite(githubRequest, { owner, repo, token, files: parsePublishFiles(input.files), message, branch: input.branch as string | undefined, enablePages: input.enable_pages !== false })
        if (result.beforeSha) {
          journalRecord(ctx.journal, { kind: 'branch_advanced', branch: result.branch, beforeSha: result.beforeSha, afterSha: result.commitSha, label: `github_publish_site ${owner}/${repo}` })
        } else {
          journalRecord(ctx.journal, { kind: 'branch_created', branch: result.branch, label: `github_publish_site ${owner}/${repo}` })
        }
        const pagesLine = result.pages === 'not-requested'
          ? 'Pages not changed (source branch); next: github_build_site with this branch as source_branch'
          : result.pages === 'enabled'
          ? `Pages enabled for ${result.branch}; the first build takes about 1 minute`
          : result.pages === 'already-serving'
            ? `Pages already serves ${result.branch}; a new build starts automatically`
            : `NOT LIVE: Pages serves ${result.pagesSource || 'another source'}, not ${result.branch}. The site was not repointed; change the Pages source in repository settings or publish to that branch.`
        return `✓ Published ${result.files.length} file(s) to ${owner}/${repo}@${result.branch} in one commit\n  commit: ${result.commitSha}\n  ${pagesLine}\n  site: ${result.pagesUrl}\n  verify: github_pages_status for ${owner}/${repo} until status is built for commit ${result.commitSha.slice(0, 7)}`
      }

      case 'github_pages_status': {
        const waitMs = Math.min(Math.max(Number(input.wait_seconds) || 0, 0) * 1000, PAGES_WAIT_MAX_MS)
        const status = await waitForPagesBuild(githubRequest, owner, repo, token, { commit: (input.commit as string | undefined)?.trim() || undefined, timeoutMs: waitMs, signal: ctx.signal })
        const pending = waitMs > 0 && !status.final ? `\n  still ${status.status} after ${Math.round(status.waitedMs / 1000)}s; call again to keep waiting` : ''
        return `Pages ${owner}/${repo}: ${status.status}${status.commit ? ` (commit ${status.commit.slice(0, 7)})` : ''}${status.error ? `\n  error: ${status.error}` : ''}\n  site: ${status.url || '(no Pages site)'}${status.updatedAt ? `\n  updated: ${status.updatedAt}` : ''}${pending}`
      }

      case 'github_build_site': {
        const built = await buildAndPublishSite(githubRequest, {
          workflowOwner: ctx.ghOwner, workflowRepo: ctx.ghRepo, owner, repo, token,
          sourceBranch: input.source_branch as string | undefined,
          buildCommand: input.build_command as string | undefined,
          outputDir: input.output_dir as string | undefined,
          publishBranch: input.publish_branch as string | undefined,
          signal: ctx.signal,
        })
        const p = built.publish
        journalRecord(ctx.journal, p.beforeSha
          ? { kind: 'branch_advanced', branch: p.branch, beforeSha: p.beforeSha, afterSha: p.commitSha, label: `github_build_site ${owner}/${repo}` }
          : { kind: 'branch_created', branch: p.branch, label: `github_build_site ${owner}/${repo}` })
        return `✓ Built ${owner}/${repo} in run #${built.run.run_number} and published ${built.files} file(s) to ${p.branch} in one commit\n  build: ${built.run.html_url}\n  commit: ${p.commitSha}\n  site: ${p.pagesUrl} (Pages ${p.pages})\n  verify: github_pages_status with commit ${p.commitSha.slice(0, 7)} and wait_seconds 180`
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return `[TOOL ERROR] ${err instanceof Error ? err.message : String(err)}`
  }
}
