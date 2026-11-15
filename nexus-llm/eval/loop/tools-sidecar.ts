// The offline tool side of the closed loop (loop.py; CLI in sidecar-cli.ts). One JSON request per stdin line: {"session": "...", "name": "...", "arguments": {...}};
// one JSON reply per stdout line: {"status": "ok"|"error", "text": "..."}. Trading tools run the app's OWN ledger, market and owner-price
// code against an in-memory ledger per session (funded $500, cap $1,000). It is PROPOSE-ONLY by construction: nothing here imports the
// execution layer (kalshiExecution / kalshiTrade), so no order can be sent. generate_image validates the arguments exactly as the app's
// executor does and records the dispatch it WOULD make (to --dispatch-log) instead of dispatching. Anything else is refused.
import { appendFileSync } from 'node:fs'
import { applyFundsCommand, emptyFunds, formatFundsStatus, formatProposal, FundsError, proposePosition, type FundsState } from '../../../src/lib/fundsLedger'
import { formatMarkets, selectMarkets, type KalshiMarket, type KalshiQuery } from '../../../src/lib/kalshiMarkets'
import { formatOwnerPrices, parseOwnerPrices } from '../../../src/lib/kalshiOwnerPrices'

const NOW = Date.parse('2026-10-27T12:00:00Z')
let dispatchLog: string | undefined
export const setDispatchLog = (f: string | undefined) => { dispatchLog = f }
const IMAGE_MODELS = ['sd15', 'sdxl-turbo', 'sd-turbo']
export const MARKETS: KalshiMarket[] = [
  { ticker: 'KXHIGHNY-26OCT28-T65', event_ticker: 'KXHIGHNY-26OCT28', title: 'Will the high temp in NYC be above 65F on Oct 28, 2026?', status: 'active', close_time: '2026-10-29T04:59:00Z', yes_bid_dollars: '0.4000', yes_ask_dollars: '0.4200', no_ask_dollars: '0.6000', last_price_dollars: '0.4100', volume_fp: '12000', volume_24h_fp: '3400', open_interest_fp: '5100', exchange_index: 0 },
  { ticker: 'KXFEDCUT-26DEC', event_ticker: 'KXFEDCUT-26DEC', title: 'Will the Fed cut rates at the December 2026 meeting?', status: 'active', close_time: '2026-12-10T19:00:00Z', yes_bid_dollars: '0.2900', yes_ask_dollars: '0.3100', no_ask_dollars: '0.7100', last_price_dollars: '0.3000', volume_fp: '88000', volume_24h_fp: '9100', open_interest_fp: '40000', exchange_index: 0 },
  { ticker: 'KXBTC-26OCT31-B100K', event_ticker: 'KXBTC-26OCT31', title: 'Will bitcoin be above $100,000 on Oct 31, 2026?', status: 'active', close_time: '2026-10-31T21:00:00Z', yes_bid_dollars: '0.5500', yes_ask_dollars: '0.5700', no_ask_dollars: '0.4500', last_price_dollars: '0.5600', volume_fp: '150000', volume_24h_fp: '22000', open_interest_fp: '70000', exchange_index: 0 },
]
const ledgers = new Map<string, FundsState>()
const ledger = (s: string) => ledgers.get(s) ?? (() => { const st = applyFundsCommand(applyFundsCommand(emptyFunds(), { kind: 'limits', changes: { capAmount: 1000 } }, NOW).state, { kind: 'deposit', amount: 500 }, NOW).state; ledgers.set(s, st); return st })()
const ok = (text: string) => ({ status: 'ok', text })
const err = (m: string) => ({ status: 'error', text: `[TOOL ERROR] ${m}` })
// Eval seeding (image grammar v2): the seed a copy-faithfulness dispatch carries when the writer
// did not supply one — a stable FNV-1a hash of the session/item id, so the same item reproduces
// the same target image on every run and score deltas attribute to the writer, not the sampler.
export function seedForItem(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function run(session: string, name: string, a: Record<string, unknown>): { status: string; text: string } {
  switch (name) {
    case 'funds_status': return ok(formatFundsStatus(ledger(session), NOW))
    case 'funds_propose': {
      const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
      try {
        const r = proposePosition(ledger(session), { mode: a.mode === 'paper' ? 'paper' : 'real', venue: String(a.venue ?? ''), market: String(a.market ?? ''), side: String(a.side ?? '').toLowerCase() as 'yes' | 'no',
          price: num(a.price), probability: num(a.probability), rationale: String(a.rationale ?? ''), sources: Array.isArray(a.sources) ? a.sources.map(String) : [] }, NOW)
        ledgers.set(session, r.state)
        return ok(formatProposal(r.position, r.sizing))
      } catch (e) { if (e instanceof FundsError) return err(`Not proposed: ${e.message}`); throw e }
    }
    case 'funds_settle': return ok('No placed Kalshi positions to settle.')
    case 'kalshi_markets': {
      const q: KalshiQuery = { ...(typeof a.query === 'string' ? { query: a.query } : {}), ...(typeof a.ticker === 'string' ? { ticker: a.ticker } : {}), ...(typeof a.limit === 'number' ? { limit: a.limit } : {}) }
      const sel = q.ticker ? MARKETS.filter(m => m.ticker === q.ticker) : selectMarkets(MARKETS, q, NOW)
      return ok(formatMarkets(sel, q, NOW, MARKETS.length))
    }
    case 'kalshi_owner_prices': return ok(formatOwnerPrices(parseOwnerPrices(a.prices), typeof a.note === 'string' ? a.note : undefined))
    case 'generate_image': {
      // the same checks as the executor in forgeTools.ts (case 'generate_image'), before its dispatch
      const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''
      const style = typeof a.style === 'string' && a.style.trim() ? a.style.trim() : 'realistic'
      const width = a.width === undefined ? 512 : Number(a.width), height = a.height === undefined ? 512 : Number(a.height)
      const model = a.model === undefined || a.model === '' ? 'sd15' : String(a.model)
      if (!prompt || prompt.length > 4000) return err('Image prompt must contain 1-4000 characters.')
      if (style.length > 100) return err('Image style must be at most 100 characters.')
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || width > 1024 || height < 256 || height > 1024 || width % 8 !== 0 || height % 8 !== 0) return err('Image width and height must be integers from 256 to 1024 and divisible by 8.')
      if (!IMAGE_MODELS.includes(model)) return err(`Unknown image model '${model}'. Allowed: ${IMAGE_MODELS.join(', ')}.`)
      if (model !== 'sd15' && (width > 512 || height > 512)) return err(`Image model '${model}' is only verified up to 512x512.`)
      // Image grammar v2 fields: expressible in the call, validated here, recorded on the dispatch.
      // The workflow does not honor them yet — that is the quality-backend step, not this one.
      const negativePrompt = typeof a.negative_prompt === 'string' ? a.negative_prompt.trim() : ''
      if (negativePrompt.length > 1000) return err('Image negative prompt must be at most 1000 characters.')
      const guidance = a.guidance === undefined ? undefined : Number(a.guidance)
      if (guidance !== undefined && (!Number.isFinite(guidance) || guidance < 0 || guidance > 30)) return err('Image guidance must be a number from 0 to 30.')
      const steps = a.steps === undefined ? undefined : Number(a.steps)
      if (steps !== undefined && (!Number.isInteger(steps) || steps < 1 || steps > 150)) return err('Image steps must be an integer from 1 to 150.')
      let seed: number
      if (a.seed === undefined) seed = seedForItem(session)
      else {
        seed = Number(a.seed)
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) return err('Image seed must be an integer from 0 to 4294967295.')
      }
      const inputs = { prompt, style, width: String(width), height: String(height), model, seed: String(seed),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        ...(guidance !== undefined ? { guidance: String(guidance) } : {}),
        ...(steps !== undefined ? { steps: String(steps) } : {}) }
      if (dispatchLog) appendFileSync(dispatchLog, JSON.stringify({ session, inputs }) + '\n')
      return ok(`image ready (offline harness: the dispatch was recorded, not sent: ${JSON.stringify(inputs)})`)
    }
    default: return err(`${name} is not available in the offline loop harness.`)
  }
}
