// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw Tool Suite ─────────────────────────────────────────────────────
// Gives ForgeMind hands. Each tool maps to a real browser-executable action.
// Tool calling is routed through the active provider adapter.

import { safeGetItem, safeSetItem } from './storage'
import { resolveGithubToken } from './githubAuth'
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
import { requiresCoSign } from './guardianGate'
import { isCorrelatedShellRun, parseShellExecutionLog, type ShellWorkflowRun } from './shellCorrelation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolParam {
  type: string
  description: string
  enum?: string[]
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
  sessionId?: string
  waPhoneNumberId?: string
  waAccessToken?: string
  waRecipient?: string
  braveKey?: string
  googleToken?: string
  agentId?: string
  runId?: string
  signal?: AbortSignal
  tier1Active?: boolean
  requestGuardianApproval?: (call: ToolCall) => Promise<boolean>
  spawnAgent?: (systemPrompt: string, task: string, tools?: string[]) => Promise<string>
}

function normalizeRepositoryPath(path: string): string {
  return path.replace(/^\/+/, '')
}

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
    description: 'Search the web for current information. Uses Brave Search if an API key is configured, otherwise DuckDuckGo instant answers.',
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
        working_directory: { type: 'string', description: 'Working directory relative to repo root. Default: repository root.' },
        timeout_seconds: { type: 'number', description: 'Maximum seconds to wait for completion. Default: 180. Max: 600.' },
        wait: { type: 'boolean', description: 'If true (default), polls until completion or timeout. If false, dispatches and returns immediately with run ID.' },
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

  // ── Coding agent: repository state, verification, persistence ───────────────
  {
    name: 'github_repo_state',
    description: 'Read the live repository state: metadata, default branch, current HEAD commit, and a file sample. Use this to identify the current HEAD before making changes.',
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
    waPhoneNumberId: wa.phoneNumberId,
    waAccessToken:   wa.accessToken,
    waRecipient:     wa.recipientNumber,
    braveKey:        safeGetItem('fc_brave_key')     || undefined,
    googleToken:     safeGetItem('fc_google_token')  || undefined,
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────

async function toolFetch(ctx: ToolContext, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (ctx.signal?.aborted) throw new DOMException('Run aborted', 'AbortError')
  return fetch(input, { ...init, signal: ctx.signal ?? init.signal })
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const { name, input } = call
  if (ctx.signal?.aborted) return '[TOOL ERROR] Run aborted before tool execution.'
  if (requiresCoSign(call, Boolean(ctx.tier1Active))) {
    if (!ctx.requestGuardianApproval) {
      return `[GUARDIAN BLOCK] ${name} requires Guardian co-sign approval, but no project-owned approval handler is attached.`
    }
    const approved = await ctx.requestGuardianApproval(call)
    if (!approved || ctx.signal?.aborted) return `[GUARDIAN REJECTED] ${name} was not executed.`
  }
  const loadState = () => loadPersistedCodingAgentState(ctx.agentId)
  const saveState = (partial: Partial<CodingAgentState>) =>
    ctx.signal?.aborted ? loadState() : savePersistedCodingAgentState(partial, ctx.agentId)
  const owner = (input.owner as string) || ctx.ghOwner
  const repo  = (input.repo  as string) || ctx.ghRepo
  const token = ctx.ghToken

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

        const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))) }
        if (sha) body.sha = sha
        if (branch) body.branch = branch
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string }
          throw new Error(err.message || `GitHub ${res.status}`)
        }
        const written = await res.json() as { commit?: { sha?: string; html_url?: string }; content?: { sha?: string } }
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
        return `✓ ${sha ? 'Updated' : 'Created'} ${path} in ${owner}/${repo}${branchLabel}\n  commit: ${commitSha || '(sha unavailable)'}\n  url: ${written.commit?.html_url || `https://github.com/${owner}/${repo}/commits`}\n  attributed: ${message.split('\n')[0]}\n  message: "${requestedMessage}"`
      }

      // ── GitHub: get run status ───────────────────────────────────────────────
      case 'github_get_run_status': {
        const runId = input.run_id as string
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, { headers })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
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
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
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
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const q = encodeURIComponent(`${query} repo:${owner}/${repo}`)
        const res = await toolFetch(ctx, `https://api.github.com/search/code?q=${q}&per_page=10`, { headers })
        if (!res.ok) throw new Error(`GitHub search ${res.status}`)
        const data = await res.json() as { total_count: number; items: Array<{ path: string; html_url: string }> }
        const hits = data.items.map(i => `• ${i.path}`).join('\n')
        return `Found ${data.total_count} matches for "${query}":\n${hits || '(none)'}`
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
        const res = await toolFetch(ctx, `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref }) })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
        return `✓ Triggered ${workflow} on ${ref} in ${owner}/${repo}`
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
        return parts.length
          ? `DuckDuckGo — "${query}":\n${parts.join('\n\n')}`
          : `No results for "${query}". Add a Brave Search API key in Settings for full web results.`
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
        const command    = input.command as string
        const workingDir = (input.working_directory as string) || '.'
        const maxWait    = Math.min(parseInt(String(input.timeout_seconds || '180'), 10) || 180, 600)
        const shouldWait = (input.wait as boolean) !== false

        const sOwner = (input.owner as string) || ctx.ghOwner
        const sRepo  = (input.repo  as string) || ctx.ghRepo
        const sToken = ctx.ghToken

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
          throw new Error(`GitHub dispatch ${dispatchRes.status}: ${dispatchRes.statusText}`)
        }

        const findCorrelatedRun = async (): Promise<ShellWorkflowRun | undefined> => {
          const runsRes = await toolFetch(
            ctx,
            `${workflowUrl}/runs?event=workflow_dispatch&per_page=20`,
            { headers: sHeaders },
          )
          if (!runsRes.ok) throw new Error(`GitHub runs list ${runsRes.status}`)
          const runsData = await runsRes.json() as { workflow_runs?: ShellWorkflowRun[] }
          const runs = runsData.workflow_runs || []
          return runs.find(run => isCorrelatedShellRun(run, invocationId, dispatchStartedAt))
        }

        const findDeadline = Date.now() + Math.min(maxWait * 1000, 30000)
        let run: ShellWorkflowRun | undefined

        while (!run && Date.now() < findDeadline) {
          if (ctx.signal?.aborted) return '[TOOL ERROR] Run aborted while locating shell execution.'
          run = await findCorrelatedRun()
          if (run) break
          await new Promise<void>((resolve) => setTimeout(resolve, 2000))
        }

        if (!run) {
          throw new Error(`Shell execution dispatched but correlated run "${invocationId}" was not found.`)
        }

        if (!shouldWait) {
          return `Shell execution dispatched. Run #${run.run_number} (id: ${run.id})\nInvocation: ${invocationId}\nURL: ${run.html_url}`
        }

        const pollInterval = 5000
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
          await new Promise<void>((resolve) => setTimeout(resolve, pollInterval))
        }

        if (finalRun.status !== 'completed') {
          return `Shell execution timed out after ${maxWait}s. Run #${finalRun.run_number}\nInvocation: ${invocationId}\nLast status: ${lastStatus}\nURL: ${finalRun.html_url}`
        }

        const jobsRes = await toolFetch(
          ctx,
          `https://api.github.com/repos/${sOwner}/${sRepo}/actions/runs/${finalRun.id}/jobs?per_page=20`,
          { headers: sHeaders },
        )
        if (!jobsRes.ok) throw new Error(`GitHub jobs list ${jobsRes.status}`)

        type WorkflowJob = { id: number; name: string; conclusion: string | null }
        const jobsData = await jobsRes.json() as { jobs?: WorkflowJob[] }
        const job = (jobsData.jobs || []).find(j => j.name === 'execute') || jobsData.jobs?.[0]

        if (!job) {
          return `[TOOL ERROR] Shell execution completed but the execute job was not found.\nRun #${finalRun.run_number}\nConclusion: ${finalRun.conclusion ?? 'unknown'}`
        }

        const logsRes = await toolFetch(
          ctx,
          `https://api.github.com/repos/${sOwner}/${sRepo}/actions/jobs/${job.id}/logs`,
          { headers: sHeaders },
        )
        const rawLogs = logsRes.ok ? await logsRes.text() : ''

        const { commandOutput, exitCode } = parseShellExecutionLog(rawLogs, finalRun.conclusion)

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
        const branch = ((input.branch as string) || meta.default_branch).trim()
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

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return `[TOOL ERROR] ${err instanceof Error ? err.message : String(err)}`
  }
}
