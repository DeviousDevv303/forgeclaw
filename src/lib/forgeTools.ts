// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ForgeClaw Tool Suite ─────────────────────────────────────────────────────
// Gives ForgeMind hands. Each tool maps to a real browser-executable action.
// Tool calling works with all four providers (Anthropic, DeepSeek, Mistral, Groq).

import { safeGetItem, safeSetItem } from './storage'

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
  waPhoneNumberId?: string
  waAccessToken?: string
  waRecipient?: string
  braveKey?: string
  googleToken?: string
  spawnAgent?: (systemPrompt: string, task: string, tools?: string[]) => Promise<string>
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
]

// ─── Context loader ────────────────────────────────────────────────────────────

export function loadToolContext(): ToolContext {
  let wa: Record<string, string> = {}
  try { wa = JSON.parse(safeGetItem('wa_credentials') || '{}') } catch { /* ignore */ }
  return {
    ghToken:         safeGetItem('gh_token') || '',
    ghOwner:         safeGetItem('fc_gh_owner') || 'DeviousDevv303',
    ghRepo:          safeGetItem('fc_gh_repo')  || 'forgeclaw',
    waPhoneNumberId: wa.phoneNumberId,
    waAccessToken:   wa.accessToken,
    waRecipient:     wa.recipientNumber,
    braveKey:        safeGetItem('fc_brave_key')     || undefined,
    googleToken:     safeGetItem('fc_google_token')  || undefined,
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const { name, input } = call
  const owner = (input.owner as string) || ctx.ghOwner
  const repo  = (input.repo  as string) || ctx.ghRepo
  const token = ctx.ghToken

  try {
    switch (name) {

      // ── GitHub: read file ────────────────────────────────────────────────────
      case 'github_read_file': {
        const path = input.path as string
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
        if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`)
        const data = await res.json() as { content?: string; encoding?: string; size?: number }
        if (!data.content) throw new Error('No content returned (may be a directory)')
        const decoded = atob(data.content.replace(/\n/g, ''))
        return `File: ${path} (${data.size} bytes)\n\`\`\`\n${decoded.slice(0, 8000)}${decoded.length > 8000 ? '\n[truncated]' : ''}\n\`\`\``
      }

      // ── GitHub: write file ───────────────────────────────────────────────────
      case 'github_write_file': {
        const path    = input.path    as string
        const content = input.content as string
        const message = input.message as string
        const branch  = input.branch  as string | undefined
        if (!token) throw new Error('No GitHub token configured. Add gh_token in memory or settings.')

        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        // Get existing SHA (required by GitHub API to update an existing file)
        const existingUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`
        let sha: string | undefined
        const existing = await fetch(existingUrl, { headers }).then(r => r.json()).catch(() => null) as { sha?: string } | null
        if (existing?.sha) sha = existing.sha

        const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))) }
        if (sha) body.sha = sha
        if (branch) body.branch = branch
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string }
          throw new Error(err.message || `GitHub ${res.status}`)
        }
        const branchLabel = branch ? ` on branch ${branch}` : ''
        return `✓ ${sha ? 'Updated' : 'Created'} ${path} in ${owner}/${repo}${branchLabel} — "${message}"`
      }

      // ── GitHub: get run status ───────────────────────────────────────────────
      case 'github_get_run_status': {
        const runId = input.run_id as string
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, { headers })
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
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers })
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
        const path = (input.path as string) || ''
        const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
        if (token) headers.Authorization = `token ${token}`
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
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
        const res = await fetch(`https://api.github.com/search/code?q=${q}&per_page=10`, { headers })
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
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, { method: 'POST', headers, body: JSON.stringify({ title, body }) })
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
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref }) })
        if (!res.ok) throw new Error(`GitHub ${res.status}`)
        return `✓ Triggered ${workflow} on ${ref} in ${owner}/${repo}`
      }

      // ── HTTP fetch ───────────────────────────────────────────────────────────
      case 'http_fetch': {
        const url    = input.url    as string
        const method = (input.method as string) || 'GET'
        const hdrs   = input.headers ? JSON.parse(input.headers as string) as Record<string, string> : {}
        const body   = input.body   as string | undefined
        const res = await fetch(url, { method, headers: hdrs, body })
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
        const res = await fetch(`https://graph.facebook.com/v19.0/${ctx.waPhoneNumberId}/messages`, {
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
          const res = await fetch(
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
        const res = await fetch(
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
        const listRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q ? `&q=${q}` : ''}`,
          { headers: { Authorization: `Bearer ${ctx.googleToken}` } },
        )
        if (!listRes.ok) throw new Error(`Gmail API ${listRes.status} — check your Google OAuth token`)
        type MsgRef = { id: string }
        const listData = await listRes.json() as { messages?: MsgRef[] }
        const msgs = listData.messages || []
        if (!msgs.length) return input.query ? `No emails matching "${input.query}"` : 'No emails found.'
        const details = await Promise.all(msgs.map(async m => {
          const dr = await fetch(
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
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
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
        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.googleToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        if (!res.ok) throw new Error(`Calendar create ${res.status} — check OAuth token scope (calendar required)`)
        type CreatedEvent = { htmlLink: string }
        const created = await res.json() as CreatedEvent
        return `✓ Event created: "${summary}" starting ${start}\n${created.htmlLink}`
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

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return `[TOOL ERROR] ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── Format tool definitions for each provider ────────────────────────────────

export function toAnthropicTools(tools: ToolDef[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

export function toOpenAITools(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
