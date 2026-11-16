// Turns a raw model completion in the Nexus grammar into the act the harness scores. This is Gate B's reading of a desk row:
// a valid funds_propose call is "propose", a direct answer is "pass", and a propose attempt whose call does not parse or
// does not carry a well-formed ticker and stake is "corrupt" (the tool-frame digit defect is scored, never forgiven).
import type { Act } from './harness'

const CALL = /<\|call\|>([\s\S]*?)<\|\/call\|>/
export const TICKER_RE = /^[A-Z0-9]+(?:-[A-Z0-9.]+)+$/

export interface DeskRead { act: Act; reason: string; args?: Record<string, unknown>; /** set on a valid propose */ side?: 'yes' | 'no' }

export function readDeskOutput(output: string, proposeTool = 'funds_propose'): DeskRead {
  const route = /^\s*<\|route:(tool|direct|defer)\|>/.exec(output)?.[1]
  const m = CALL.exec(output)
  if (!m) {
    if (/<\|call\|>/.test(output)) return { act: 'corrupt', reason: 'call opened and never closed' }
    return route === 'tool' ? { act: 'corrupt', reason: 'tool route with no call' } : { act: 'pass', reason: route ? `route ${route}, no call` : 'no route token, no call' }
  }
  let call: unknown
  try { call = JSON.parse(m[1]) } catch { return { act: 'corrupt', reason: 'call is not valid JSON' } }
  const c = call as { name?: unknown; arguments?: unknown }
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.arguments || typeof c.arguments !== 'object') return { act: 'corrupt', reason: 'call lacks name or arguments' }
  if (c.name !== proposeTool) return { act: 'pass', reason: `called ${c.name}, not ${proposeTool}` }
  const args = c.arguments as Record<string, unknown>
  const ticker = args.market ?? args.ticker
  if (typeof ticker !== 'string' || !TICKER_RE.test(ticker)) return { act: 'corrupt', reason: 'ticker missing or malformed', args }
  for (const k of ['price', 'probability', 'max_stake'] as const) {
    if (k in args && !(typeof args[k] === 'number' && Number.isFinite(args[k] as number) && (args[k] as number) >= 0)) return { act: 'corrupt', reason: `${k} is not a finite non-negative number`, args }
  }
  const side = typeof args.side === 'string' ? args.side.toLowerCase() : ''
  if (side !== 'yes' && side !== 'no') return { act: 'corrupt', reason: 'side missing or not yes/no', args }
  return { act: 'propose', reason: 'valid propose call', args, side }
}

/** Corruption a parse cannot see: the proposed ticker is well-formed but is not the ticker the prompt named. */
export function tickerMatchesPrompt(read: DeskRead, prompt: string): boolean {
  const t = read.args && (read.args.market ?? read.args.ticker)
  return typeof t === 'string' && prompt.includes(t)
}

/** The reading the harness uses: a propose whose ticker is not the one the prompt named is corrupt, not a propose. */
export function readDeskRow(prompt: string, output: string, proposeTool = 'funds_propose'): DeskRead {
  const r = readDeskOutput(output, proposeTool)
  return r.act === 'propose' && !tickerMatchesPrompt(r, prompt) ? { ...r, act: 'corrupt', reason: 'proposed ticker is not in the prompt' } : r
}
