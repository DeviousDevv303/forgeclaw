// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Owner-supplied Kalshi prices: the third leg of graceful degradation, after the live read
 * and the last-good snapshot. When ForgeClaw cannot read Kalshi, the owner can type the prices
 * they see, and research continues on them.
 *
 * Authorized 2026-10-23 by Cristian Nunez, with three conditions:
 *   1. manual price input only — this formats prices, it never proposes, approves or places;
 *   2. every price is labelled as the owner's, never presented as read from Kalshi;
 *   3. no evidence weight in NEXUS — the tool is in NOT_EVIDENCE_TOOLS (nexusConvergence.ts),
 *      so an answer backed only by these prices records as "completed", never "verified",
 *      and cannot converge into First Principles knowledge.
 *
 * Owner prices are safe to research on because a real order never uses them: approval re-reads
 * the live price and refuses to place past the owner's tolerance (kalshiExecution.ts).
 */

export const OWNER_PRICES_MAX_ENTRIES = 30

export interface OwnerPrice {
  ticker: string
  side: 'yes' | 'no'
  /** Dollars per $1 contract, strictly between 0 and 1. */
  price: number
}

export interface OwnerPricesParse {
  prices: OwnerPrice[]
  /** Entries that could not be read, verbatim, so the owner can see exactly what was rejected. */
  rejected: string[]
}

const TICKER = /^[A-Za-z0-9_.-]{1,80}$/

/**
 * "0.42", "$0.42", "42c", "42¢" -> 0.42. A bare whole number from 1 to 99 is read as cents
 * ("42" -> 0.42), since no Kalshi contract costs $1 or more. Anything else -> null.
 */
export function parseOwnerPrice(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  const cents = s.match(/^(\d{1,2}(?:\.\d+)?)\s*(?:c|¢|cents?)$/)
  if (cents) return inRange(Number(cents[1]) / 100)
  const dollars = s.match(/^\$?(0?\.\d+|\d+(?:\.\d+)?)$/)
  if (!dollars) return null
  const n = Number(dollars[1])
  if (!Number.isFinite(n)) return null
  if (n >= 1 && n <= 99 && Number.isInteger(n) && !s.startsWith('$')) return inRange(n / 100)
  return inRange(n)
}

function inRange(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n < 1 ? Math.round(n * 10_000) / 10_000 : null
}

/**
 * One entry per line, comma or semicolon: "<ticker> [yes|no] <price>" or "<ticker>=<price>".
 * The side defaults to YES, which is how Kalshi lists a market's price.
 */
export function parseOwnerPrices(input: unknown): OwnerPricesParse {
  const text = Array.isArray(input) ? input.map(String).join('\n') : typeof input === 'string' ? input : ''
  const entries = text.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean)
  const prices: OwnerPrice[] = []
  const rejected: string[] = []
  for (const entry of entries.slice(0, OWNER_PRICES_MAX_ENTRIES)) {
    const parts = entry.replace('=', ' ').split(/\s+/).filter(Boolean)
    const ticker = parts[0] ?? ''
    const side = parts.length === 3 ? parts[1].toLowerCase() : 'yes'
    const price = parseOwnerPrice(parts[parts.length - 1] ?? '')
    if (parts.length < 2 || parts.length > 3 || !TICKER.test(ticker) || (side !== 'yes' && side !== 'no') || price === null) {
      rejected.push(entry)
      continue
    }
    prices.push({ ticker: ticker.toUpperCase(), side, price })
  }
  for (const entry of entries.slice(OWNER_PRICES_MAX_ENTRIES)) rejected.push(entry)
  return { prices, rejected }
}

export const OWNER_PRICES_HEADER =
  'OWNER-SUPPLIED PRICES — typed by the owner, not read from Kalshi. ForgeClaw has not verified them.'

export const OWNER_PRICES_FOOTER =
  'Say these are the owner\'s prices whenever they inform an answer, and never describe them as market data. '
  + 'A YES price of $0.42 implies ~42%, not a guarantee. A real order never uses these numbers: approval re-reads the live price and refuses to place past the owner\'s tolerance.'

export function formatOwnerPrices(parsed: OwnerPricesParse, note?: string): string {
  if (!parsed.prices.length) {
    return `No owner prices could be read${parsed.rejected.length ? ` (rejected: ${parsed.rejected.map(r => JSON.stringify(r)).join(', ')})` : ''}. `
      + 'Write one per line as "<ticker> [yes|no] <price>", e.g. "KXHIGHNY-25OCT24-T65 yes 42c" or "KXHIGHNY-25OCT24-T65=0.42".'
  }
  const lines = parsed.prices.map(p => `- ${p.ticker} ${p.side.toUpperCase()} $${p.price.toFixed(2)} (implied ${Math.round(p.price * 100)}%; owner's number)`)
  const rejected = parsed.rejected.length ? `\n\nNot read (fix and resend): ${parsed.rejected.map(r => JSON.stringify(r)).join(', ')}` : ''
  const noteLine = note && note.trim() ? `\nOwner's note: ${note.trim().slice(0, 300)}` : ''
  return `${OWNER_PRICES_HEADER}${noteLine}\n\n${lines.join('\n')}${rejected}\n\n${OWNER_PRICES_FOOTER}`
}
