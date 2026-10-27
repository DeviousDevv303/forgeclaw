// NEXUS Intelligence: the route -> tool call -> evidence grammar (spec/grammar.md is the prose contract).
// Pure functions, no imports from src/. Everything here is PROPOSED design; nothing is wired into the app.

export const ROUTES = ['direct', 'tool', 'defer'] as const
export type Route = typeof ROUTES[number]

/** attempted/completed/verified/blocked/failed mirror LearningOutcome; partial and not_verified are new tokens. */
export const EVIDENCE = ['attempted', 'completed', 'verified', 'blocked', 'failed', 'partial', 'not_verified'] as const
export type Evidence = typeof EVIDENCE[number]

export const RESULT_STATUS = ['ok', 'error'] as const
export type ResultStatus = typeof RESULT_STATUS[number]

/** Every special token, in a fixed order: this list is what the tokenizer registers as atomic (step 2). */
export const SPECIAL_TOKENS: readonly string[] = [
  ...ROUTES.map(r => `<|route:${r}|>`),
  '<|call|>', '<|/call|>',
  ...RESULT_STATUS.map(s => `<|result:${s}|>`), '<|/result|>',
  ...EVIDENCE.map(e => `<|ev:${e}|>`),
  '<|answer|>', '<|/answer|>',
  '<|end|>',
]

/** Anything shaped like a special token. Free text may not contain one, whether or not it is registered. */
const TOKEN_SHAPE = /<\|\/?[a-z_]+(?::[a-z_]+)?\|>/g
export function containsSpecialToken(text: string): boolean { return new RegExp(TOKEN_SHAPE.source).test(text) }

export interface ToolParamSchema { type: string; description?: string; enum?: string[]; items?: Record<string, unknown> }
export interface ToolSchema {
  name: string
  description?: string
  parameters: { type: 'object'; properties: Record<string, ToolParamSchema>; required: string[] }
}
export interface ToolCallAction { name: string; arguments: Record<string, unknown> }
export interface Step { call: ToolCallAction; result: { status: ResultStatus; text: string } }
export interface Transcript { route: Route; steps: Step[]; evidence: Evidence; answer: string }

export class GrammarError extends Error {}

// ─── JSON Schema (consumed by llama.cpp --json-schema / WebLLM response_format; runtime support is UNVERIFIED) ──────────
function paramSchema(p: ToolParamSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: p.type }
  if (p.enum) out.enum = p.enum
  if (p.items) out.items = p.items
  return out
}

export function buildToolCallSchema(tools: ToolSchema[]): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'NEXUS tool call',
    oneOf: tools.map(t => ({
      type: 'object',
      properties: {
        name: { const: t.name },
        arguments: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(t.parameters.properties).map(([k, v]) => [k, paramSchema(v)])),
          required: t.parameters.required,
          additionalProperties: false,
        },
      },
      required: ['name', 'arguments'],
      additionalProperties: false,
    })),
  }
}

// ─── Argument validation: a SUBSET validator (type, enum, required, additionalProperties, array items) ─────────────────
function valueMatches(value: unknown, schema: Record<string, unknown>, path: string, errors: string[]): void {
  const type = schema.type
  const bad = (what: string): void => { errors.push(`${path}: ${what}`) }
  switch (type) {
    case 'string': if (typeof value !== 'string') return bad('expected string'); break
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) return bad('expected finite number'); break
    case 'integer': if (!Number.isInteger(value)) return bad('expected integer'); break
    case 'boolean': if (typeof value !== 'boolean') return bad('expected boolean'); break
    case 'array': {
      if (!Array.isArray(value)) return bad('expected array')
      const items = schema.items as Record<string, unknown> | undefined
      if (items) value.forEach((v, i) => valueMatches(v, items, `${path}[${i}]`, errors))
      break
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return bad('expected object')
      const props = schema.properties as Record<string, Record<string, unknown>> | undefined
      const obj = value as Record<string, unknown>
      for (const req of (schema.required as string[] | undefined) ?? []) if (!(req in obj)) errors.push(`${path}.${req}: required`)
      if (props) for (const [k, v] of Object.entries(obj)) {
        if (!(k in props)) errors.push(`${path}.${k}: not in schema`)
        else valueMatches(v, props[k], `${path}.${k}`, errors)
      }
      break
    }
    default: return bad(`unsupported schema type ${JSON.stringify(type)}`)
  }
  const en = schema.enum as unknown[] | undefined
  if (en && !en.includes(value)) bad(`not one of ${JSON.stringify(en)}`)
}

export function validateCall(call: ToolCallAction, tools: ToolSchema[]): string[] {
  const tool = tools.find(t => t.name === call.name)
  if (!tool) return [`unknown tool ${JSON.stringify(call.name)}`]
  const errors: string[] = []
  valueMatches(call.arguments, { type: 'object', properties: tool.parameters.properties, required: tool.parameters.required }, `${call.name}.arguments`, errors)
  return errors
}

// ─── Encoding ───────────────────────────────────────────────────────────────────────────────────────────────────────
function assertText(text: string, where: string): void {
  if (containsSpecialToken(text)) throw new GrammarError(`${where} contains a special-token-shaped string`)
}

/** Canonical call JSON: name first, then arguments in schema property order (unknown keys last), compact. */
export function encodeCall(call: ToolCallAction, tools: ToolSchema[]): string {
  const tool = tools.find(t => t.name === call.name)
  const order = tool ? Object.keys(tool.parameters.properties) : []
  const keys = [...order.filter(k => k in call.arguments), ...Object.keys(call.arguments).filter(k => !order.includes(k))]
  const args = '{' + keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(call.arguments[k])}`).join(',') + '}'
  const json = `{"name":${JSON.stringify(call.name)},"arguments":${args}}`
  assertText(json, 'call')
  return json
}

export function encodeTranscript(t: Transcript, tools: ToolSchema[]): string {
  const out: string[] = [`<|route:${t.route}|>`]
  for (const s of t.steps) {
    assertText(s.result.text, 'result')
    out.push(`<|call|>${encodeCall(s.call, tools)}<|/call|>`, `<|result:${s.result.status}|>${s.result.text}<|/result|>`)
  }
  assertText(t.answer, 'answer')
  out.push(`<|ev:${t.evidence}|><|answer|>${t.answer}<|/answer|><|end|>`)
  return out.join('')
}

// ─── Parsing (strict: the canonical form only) ──────────────────────────────────────────────────────────────────────
export function parseTranscript(s: string): Transcript {
  const parts = s.split(/(<\|\/?[a-z_]+(?::[a-z_]+)?\|>)/).filter(p => p !== '')
  let i = 0
  const peek = () => parts[i]
  const take = (what: string): string => { const p = parts[i++]; if (p === undefined) throw new GrammarError(`unexpected end, wanted ${what}`); return p }
  const expectToken = (tok: string) => { const p = take(tok); if (p !== tok) throw new GrammarError(`expected ${tok}, got ${JSON.stringify(p.slice(0, 40))}`) }
  const isToken = (p: string) => /^<\|\/?[a-z_]+(?::[a-z_]+)?\|>$/.test(p)
  // Free text sits between tokens. A token-shaped substring was split off by the tokenizer above, so it can only
  // show up as structure, where the next expectToken rejects it.
  const text = (): string => (peek() === undefined || isToken(peek()) ? '' : parts[i++])

  const routeTok = take('route')
  const route = ROUTES.find(r => routeTok === `<|route:${r}|>`)
  if (!route) throw new GrammarError(`bad route token ${JSON.stringify(routeTok.slice(0, 40))}`)
  const steps: Step[] = []
  while (peek() === '<|call|>') {
    i++
    const raw = text()
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new GrammarError('call is not valid JSON') }
    const o = parsed as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).join() !== 'name,arguments' || typeof o.name !== 'string'
      || !o.arguments || typeof o.arguments !== 'object' || Array.isArray(o.arguments)) throw new GrammarError('call must be exactly {"name":string,"arguments":object}')
    expectToken('<|/call|>')
    const resTok = take('result')
    const status = RESULT_STATUS.find(st => resTok === `<|result:${st}|>`)
    if (!status) throw new GrammarError(`expected a result token after a call, got ${JSON.stringify(resTok.slice(0, 40))}`)
    const resText = text()
    expectToken('<|/result|>')
    steps.push({ call: { name: o.name, arguments: o.arguments as Record<string, unknown> }, result: { status, text: resText } })
  }
  const evTok = take('evidence')
  const evidence = EVIDENCE.find(e => evTok === `<|ev:${e}|>`)
  if (!evidence) throw new GrammarError(`bad evidence token ${JSON.stringify(evTok.slice(0, 40))}`)
  expectToken('<|answer|>')
  const answer = text()
  expectToken('<|/answer|>')
  expectToken('<|end|>')
  if (i !== parts.length) throw new GrammarError('trailing content after <|end|>')
  return { route, steps, evidence, answer }
}

// ─── Semantic rules (post-hoc; constrained decoding cannot enforce these) ───────────────────────────────────────────
/** Mirrors answerOutcome() in src/lib/nexusConvergence.ts: a model's own output is never evidence. */
export function validateTranscript(t: Transcript, tools: ToolSchema[], notEvidenceTools: ReadonlySet<string>): string[] {
  const errors: string[] = []
  t.steps.forEach((s, i) => validateCall(s.call, tools).forEach(e => errors.push(`step ${i}: ${e}`)))
  if (t.route === 'tool' && t.steps.length === 0) errors.push('route:tool needs at least one call')
  if (t.route !== 'tool' && t.steps.length > 0) errors.push(`route:${t.route} may not call tools`)
  const okEvidence = t.steps.some(s => s.result.status === 'ok' && !notEvidenceTools.has(s.call.name))
  const anyOk = t.steps.some(s => s.result.status === 'ok')
  const anyError = t.steps.some(s => s.result.status === 'error')
  const need = (cond: boolean, msg: string) => { if (!cond) errors.push(msg) }
  // A route with no calls (direct, defer) can therefore only claim not_verified, or blocked when deferring: every other
  // status below needs a call or a result.
  switch (t.evidence) {
    case 'verified': need(okEvidence, 'verified needs a successful result from an evidence tool (not deepseek_reason, memory_*, etc.)'); break
    case 'completed': need(anyOk, 'completed needs at least one successful result'); break
    case 'failed': need(anyError, 'failed needs at least one error result'); break
    case 'partial': need(anyOk && anyError, 'partial needs both a successful and a failed result'); break
    case 'attempted': need(t.steps.length > 0, 'attempted needs at least one call'); break
    case 'blocked': need(t.route === 'defer' || anyError, 'blocked needs route:defer or an error result'); break
    case 'not_verified': break
  }
  return errors
}
