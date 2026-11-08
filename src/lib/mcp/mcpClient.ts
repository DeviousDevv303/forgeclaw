// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// MCP client: Streamable HTTP transport (JSON-RPC 2.0 over POST; replies as application/json or text/event-stream).
// Owner order 2026-11-08 (MCP client build): external MCP servers register their tools into the SAME
// executeTool() path every ForgeClaw tool uses. This file only speaks the protocol: it holds no authority, decides no
// gate and never runs a tool by itself. Dispatch and Guardian co-sign stay in forgeTools.ts / guardianGate.ts.
//
// Scope, stated plainly: the app runs in a browser, so only HTTP transports exist here (no stdio servers), and a
// server must allow the app's origin (CORS). Credentials are sent as a bearer header and never echoed: every error
// message that leaves this module is passed through redact() with the server's token.

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const MCP_DEFAULT_TIMEOUT_MS = 30_000

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface McpServerConfig {
  /** Short, stable id; becomes part of every tool name (mcp__<id>__<tool>). */
  id: string
  label?: string
  /** The server's Streamable HTTP endpoint. https only (http allowed for localhost). */
  url: string
  /** Optional bearer token. Stored like the app's other keys; never printed. */
  token?: string
  enabled?: boolean
}

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] }
  annotations?: McpToolAnnotations
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType?: string }
  | { type: 'audio'; data: string; mimeType?: string }
  | { type: 'resource'; resource: { uri?: string; text?: string; mimeType?: string } }
  | { type: 'resource_link'; uri: string; name?: string }
  | { type: string; [k: string]: unknown }

export interface McpCallResult {
  content?: McpContent[]
  structuredContent?: unknown
  isError?: boolean
}

export type McpErrorKind = 'transport' | 'http' | 'protocol' | 'rpc' | 'timeout' | 'aborted' | 'config'

export class McpError extends Error {
  readonly kind: McpErrorKind
  readonly status?: number
  constructor(message: string, kind: McpErrorKind, status?: number) {
    super(message)
    this.name = 'McpError'
    this.kind = kind
    this.status = status
  }
}

/** Remove a secret from any text that may leave this module (servers can echo headers in error bodies). */
export function redact(text: string, secret?: string): string {
  if (!secret || secret.length < 4) return text
  return text.split(secret).join('[redacted]')
}

/** Validate a server config; returns a reason when it must not be used. */
export function invalidServerReason(cfg: McpServerConfig): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(cfg.id)) return 'id must be 1-24 chars of a-z, 0-9, _ or -, starting with a letter or digit'
  let u: URL
  try { u = new URL(cfg.url) } catch { return 'url is not a valid URL' }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return 'url must be https (http only for localhost)'
  if (u.username || u.password) return 'credentials in the url are not allowed; use the token field'
  return null
}

/** Parse an SSE body into the JSON-RPC messages carried by its data lines. */
export function parseSseMessages(body: string): unknown[] {
  const out: unknown[] = []
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
    if (!data) continue
    try { out.push(JSON.parse(data)) } catch { /* a non-JSON event (comment/keepalive) is skipped */ }
  }
  return out
}

interface RpcResponse { jsonrpc?: string; id?: number | string; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }

export interface McpClientOptions {
  fetch?: FetchLike
  timeoutMs?: number
  clientVersion?: string
}

/** One connection to one MCP server. Lazily initializes; re-initializes once when the server forgets the session. */
export class McpClient {
  private sessionId: string | null = null
  private protocolVersion: string = MCP_PROTOCOL_VERSION
  private initialized = false
  private nextId = 1
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  readonly config: McpServerConfig
  private readonly opts: McpClientOptions

  constructor(config: McpServerConfig, opts: McpClientOptions = {}) {
    this.config = config
    this.opts = opts
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = opts.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS
    const bad = invalidServerReason(config)
    if (bad) throw new McpError(`MCP server "${config.id}": ${bad}`, 'config')
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (this.config.token) h.Authorization = `Bearer ${this.config.token}`
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId
    if (this.initialized) h['MCP-Protocol-Version'] = this.protocolVersion
    return h
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    if (signal?.aborted) throw new McpError('aborted before the request', 'aborted')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await this.fetchImpl(this.config.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: controller.signal })
    } catch (e) {
      if (timedOut) throw new McpError(`no answer within ${this.timeoutMs} ms`, 'timeout')
      if (signal?.aborted) throw new McpError('aborted', 'aborted')
      throw new McpError(redact(`request failed: ${e instanceof Error ? e.message : String(e)}`, this.config.token), 'transport')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Send one request and return its result; JSON or SSE replies. */
  private async rpc(method: string, params: unknown, signal?: AbortSignal, allowReinit = true): Promise<unknown> {
    if (!this.initialized && method !== 'initialize') await this.initialize(signal)
    const id = this.nextId++
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, signal)
    if (res.status === 404 && this.sessionId && allowReinit && method !== 'initialize') {
      // The server dropped the session: initialize again once, then retry this request once.
      this.sessionId = null; this.initialized = false
      await this.initialize(signal)
      return this.rpc(method, params, signal, false)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new McpError(redact(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, this.config.token), 'http', res.status)
    }
    const sid = res.headers.get('Mcp-Session-Id')
    if (sid) this.sessionId = sid
    const type = res.headers.get('Content-Type') ?? ''
    const raw = await res.text()
    let messages: unknown[]
    if (type.includes('text/event-stream')) messages = parseSseMessages(raw)
    else {
      try { messages = [JSON.parse(raw)] } catch { throw new McpError(`${method}: the reply is not JSON`, 'protocol') }
      if (Array.isArray(messages[0])) messages = messages[0] as unknown[]
    }
    const reply = messages.find(m => (m as RpcResponse)?.id === id) as RpcResponse | undefined
    if (!reply) throw new McpError(`${method}: no reply with id ${id} in the server's answer`, 'protocol')
    if (reply.error) throw new McpError(redact(`${method}: ${reply.error.message ?? 'error'} (code ${reply.error.code ?? '?'})`, this.config.token), 'rpc')
    return reply.result
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const result = await this.rpc('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'forgeclaw', version: this.opts.clientVersion ?? '1' },
    }, signal) as { protocolVersion?: string } | undefined
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion
    this.initialized = true
    // Notification: no id, no reply expected (servers answer 202). A failure here is not fatal to the session.
    try { await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal) } catch { /* best effort */ }
  }

  /** Every tool the server offers (follows nextCursor pages, capped). */
  async listTools(signal?: AbortSignal, maxPages = 20): Promise<McpTool[]> {
    const tools: McpTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < maxPages; page++) {
      const r = await this.rpc('tools/list', cursor ? { cursor } : {}, signal) as { tools?: McpTool[]; nextCursor?: string } | undefined
      for (const t of r?.tools ?? []) if (t && typeof t.name === 'string') tools.push(t)
      if (!r?.nextCursor) break
      cursor = r.nextCursor
    }
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const r = await this.rpc('tools/call', { name, arguments: args }, signal) as McpCallResult | undefined
    return r ?? {}
  }
}
