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
}

export interface ToolContext {
  ghToken: string
  ghOwner: string
  ghRepo: string
  waPhoneNumberId?: string
  waAccessToken?: string
  waRecipient?: string
  braveKey?: string
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
    description: 'Create or update a file in a GitHub repository with a commit message.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Full file content to write' },
        message: { type: 'string', description: 'Commit message' },
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
    braveKey:        safeGetItem('fc_brave_key') || undefined,
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
        if (!token) throw new Error('No GitHub token configured. Add gh_token in memory or settings.')

        // Get existing SHA if file exists
        const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }
        let sha: string | undefined
        const existing = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers }).then(r => r.json()).catch(() => null) as { sha?: string } | null
        if (existing?.sha) sha = existing.sha

        const body: Record<string, unknown> = { message, content: btoa(unescape(encodeURIComponent(content))) }
        if (sha) body.sha = sha
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string }
          throw new Error(err.message || `GitHub ${res.status}`)
        }
        return `✓ ${sha ? 'Updated' : 'Created'} ${path} in ${owner}/${repo} with message: "${message}"`
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
