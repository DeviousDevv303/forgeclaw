// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// The fight-card research template, and the gate that holds a proposal to it.
//
// Owner directive 2026-10-23/24: a wager on a fight is the end of a research chain, not an opinion — the rematch
// sequence, the book line, the stats and facts, a sentiment scan (Reddit and the like), a fusion of those weighted
// the way the owner ruled (market and facts and statistics first, the crowd last and capped), one proposal with its
// edge and its falsifier. The model writes that chain into funds_propose's existing `rationale` text (no schema
// change); proposePosition runs checkFightRationale on it, so a fight proposal without the chain is refused by the
// ledger, not by a prompt. The check cannot judge whether the research is TRUE, only that every step was written down,
// that numbers are present and consistent (the stated range holds the proposal's probability, the stated net edge
// clears the bar and cannot exceed the gross edge), and that the sentiment weight stays inside what the crowd has
// earned. Absence of data is allowed only when named: "unavailable — <reason>", never a silent omission.
//
// The crowd's lean ("crowd lean: 62%": its chance that the proposed side wins) is also kept, as a SentimentSnapshot on the
// position, so that when the fight settles the ledger can score the crowd against the result (fundsLedger.ts crowdRecord).
//
// Pure: no network, no storage; the clock is a parameter.

/** Kalshi series whose markets are fights (verified against the public series list 2026-10-24). */
export const FIGHT_SERIES_PREFIXES = ['KXUFCFIGHT', 'KXMMAFIGHT', 'KXMMAEXFIGHT'] as const

/** A fight proposal's rationale is kept whole up to this length (other proposals keep 2,000). */
export const FIGHT_RATIONALE_MAX_CHARS = 4000

/**
 * The most a crowd (Reddit, forums, social posts, pick'em polls) may weigh in the fusion, as a percent, and only once its
 * record on comparable past fights is measured and good enough. The owner's cap: 10% "until ledger data earns more".
 */
export const FUNDS_SENTIMENT_MAX_WEIGHT_PCT = 10
/** Starting bars for the crowd to count at all. Not measured: re-estimate from the owner's settled record. */
export const FUNDS_CROWD_MIN_COMPARABLE_FIGHTS = 10
export const FUNDS_CROWD_MIN_HIT_RATE_PCT = 55

/** At most this many scanned links are kept on a position's sentiment snapshot. */
export const SENTIMENT_MAX_LINKS = 5

/**
 * What the SENTIMENT SCAN and FUSION said, kept on the position so the crowd can be scored when the fight settles.
 * `lean` is the crowd's chance (0-1) that the PROPOSED side wins, as the model read it from the threads; null when
 * the scan was unavailable. The ledger records the claim and scores it; it cannot check the scan was honest.
 */
export interface SentimentSnapshot {
  lean: number | null
  /** The weight (percent) the fusion gave the crowd. */
  weightPct: number
  /** Up to SENTIMENT_MAX_LINKS links to what was scanned. */
  links: string[]
  /** Why there was no scan, when lean is null. */
  reason?: string
  recordedAt: number
}

export type FightSectionKey = 'rematch' | 'book' | 'stats' | 'sentiment' | 'fusion' | 'edge' | 'falsifier'

export interface FightSection { key: FightSectionKey; label: string; pattern: RegExp; hint: string }

const heading = (label: string) =>
  new RegExp(`^\\s*(?:[-*]\\s*|\\d+[.)]\\s*)?(?:\\*\\*|__)?\\s*${label}\\s*(?:\\*\\*|__)?\\s*[:—–-]\\s*(.*)$`, 'i')

/** The seven sections, in the order they are written. */
export const FIGHT_SECTIONS: readonly FightSection[] = [
  { key: 'rematch', label: 'REMATCH SEQUENCE', pattern: heading('REMATCH SEQUENCE'), hint: 'prior meetings: date, winner, method, round, what the crowd predicted then versus what happened; or "no prior meeting"' },
  { key: 'book', label: 'BOOK LINE', pattern: heading('BOOK LINE'), hint: 'sharp-book odds at 2+ books, the no-vig probability, and the Kalshi ask; or "unavailable — <reason>"' },
  { key: 'stats', label: 'STATS & FACTS', pattern: heading('STATS (?:&|AND) FACTS'), hint: 'statistics that adjust the baseline, and hard facts (weigh-ins, injuries, camp, changes) each with a source; or "unavailable — <reason>"' },
  { key: 'sentiment', label: 'SENTIMENT SCAN', pattern: heading('SENTIMENT SCAN'), hint: 'the threads/forums scanned (with links); "crowd lean: <n>%" = the crowd\'s chance that YOUR side wins; and its record: "N of M comparable fights called correctly"; or "unavailable — <reason>"' },
  { key: 'fusion', label: 'FUSION', pattern: heading('FUSION'), hint: 'range: <low>-<high> (must contain your probability); how each tier moved it; sentiment weight: <n>%' },
  { key: 'edge', label: 'EDGE', pattern: heading('EDGE'), hint: 'net edge: <n>¢ per contract after the fee and the spread' },
  { key: 'falsifier', label: 'FALSIFIER', pattern: heading('FALSIFIER'), hint: 'the result or news that would prove this wrong' },
]

/** True for a Kalshi fight-card market ticker; the venue must be Kalshi. */
export function isFightMarket(venue: string, market: string): boolean {
  if (!/kalshi/i.test(venue)) return false
  const ticker = market.trim().toUpperCase()
  return FIGHT_SERIES_PREFIXES.some(prefix => ticker === prefix || ticker.startsWith(`${prefix}-`))
}

/** The labeled sections of a rationale, by key (text after the label, including the following lines until the next label). */
export function parseFightRationale(rationale: string): Map<FightSectionKey, string> {
  const found = new Map<FightSectionKey, string[]>()
  let current: FightSectionKey | null = null
  for (const line of rationale.split(/\r?\n/)) {
    const hit = FIGHT_SECTIONS.map(section => ({ section, match: section.pattern.exec(line) })).find(x => x.match)
    if (hit) {
      current = hit.section.key
      if (!found.has(current)) found.set(current, [])
      found.get(current)!.push(hit.match![1] ?? '')
    } else if (current) {
      found.get(current)!.push(line)
    }
  }
  return new Map([...found].map(([key, lines]) => [key, lines.join('\n').trim()]))
}

const UNAVAILABLE = /^unavailable\s*[:—–-]?\s*(.*)$/is
const unavailableReason = (text: string): string | null => {
  const m = UNAVAILABLE.exec(text.trim())
  return m ? m[1].trim() : null
}

const asProbability = (n: number) => (n > 1 ? n / 100 : n)

/** The crowd's stated chance (0-1) that the proposed side wins, from "crowd lean: 62%" in the scan; null when absent or out of range. */
export function crowdLeanFromScan(sentimentText: string | undefined): number | null {
  if (!sentimentText) return null
  const m = /crowd(?:'s|’s)?\s+lean\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(sentimentText)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null
}

const weightFromFusion = (fusion: string | undefined): number => {
  const m = fusion ? /sentiment weight\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(fusion) : null
  return m ? Number(m[1]) : 0
}

/**
 * The snapshot to keep on a fight position, read from its (already checked) rationale. Null only when the rationale has
 * no SENTIMENT SCAN at all, which the gate refuses first.
 */
export function extractSentimentSnapshot(rationale: string, nowMs: number): SentimentSnapshot | null {
  const sections = parseFightRationale(rationale)
  const scan = sections.get('sentiment')
  if (scan === undefined) return null
  const weightPct = weightFromFusion(sections.get('fusion'))
  const reason = unavailableReason(scan)
  if (reason !== null) return { lean: null, weightPct, links: [], reason: reason.slice(0, 300), recordedAt: nowMs }
  // A link ends before the punctuation that closes the sentence around it ("... /faceoff/." is the link without the dot).
  const links = [...new Set((scan.match(/https?:\/\/[^\s)>\]"']+/gi) ?? []).map(l => l.replace(/[.,;:!?]+$/, '')))].slice(0, SENTIMENT_MAX_LINKS).map(l => l.slice(0, 300))
  return { lean: crowdLeanFromScan(scan), weightPct, links, recordedAt: nowMs }
}

export interface FightCheckInput {
  rationale: string
  /** The proposal's own probability (0-1) and price (0-1). */
  probability: number
  price: number
}

export interface FightBars {
  /** Net edge (cents) a taker entry must clear, and the higher bar for a side priced at the extremes. */
  minNetEdgeCents: number
  minNetEdgeExtremeCents: number
  extremeLowCents: number
  extremeHighCents: number
}

export interface FightCheck { ok: boolean; problems: string[] }

/** The weight (percent) the crowd may carry, given what the SENTIMENT SCAN section says about its record. */
export function allowedSentimentWeightPct(sentimentText: string | undefined): number {
  if (!sentimentText || unavailableReason(sentimentText) !== null) return 0
  const record = /(\d+)\s*(?:of|\/)\s*(\d+)\b/i.exec(sentimentText)
  if (!record) return 0
  const hits = Number(record[1])
  const total = Number(record[2])
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total < FUNDS_CROWD_MIN_COMPARABLE_FIGHTS || hits > total) return 0
  return (hits / total) * 100 >= FUNDS_CROWD_MIN_HIT_RATE_PCT ? FUNDS_SENTIMENT_MAX_WEIGHT_PCT : 0
}

/** Hold a fight proposal's rationale to the template. Returns every problem found, not just the first. */
export function checkFightRationale(input: FightCheckInput, bars: FightBars): FightCheck {
  const problems: string[] = []
  const text = input.rationale.trim()
  if (text.length > FIGHT_RATIONALE_MAX_CHARS) {
    problems.push(`the rationale is ${text.length} characters; a fight rationale is kept whole only up to ${FIGHT_RATIONALE_MAX_CHARS}, so shorten it`)
  }
  const sections = parseFightRationale(text)

  for (const s of FIGHT_SECTIONS) {
    const body = sections.get(s.key)
    if (body === undefined) problems.push(`${s.label} is missing (write "${s.label}: ..." on its own line)`)
    else if (body.length < 12) problems.push(`${s.label} is empty or too short to be evidence (12+ characters)`)
  }

  for (const key of ['book', 'stats', 'sentiment'] as const) {
    const body = sections.get(key)
    const reason = body === undefined ? null : unavailableReason(body)
    if (reason !== null && reason.length < 10) {
      problems.push(`${FIGHT_SECTIONS.find(s => s.key === key)!.label} says unavailable without a reason; name the reason (10+ characters)`)
    }
  }

  const book = sections.get('book')
  const stats = sections.get('stats')
  const bookUnavailable = book !== undefined && unavailableReason(book) !== null
  const statsUnavailable = stats !== undefined && unavailableReason(stats) !== null
  if (bookUnavailable && statsUnavailable) {
    problems.push('BOOK LINE and STATS & FACTS are both unavailable; a wager needs at least one of them as real data')
  }
  if (book !== undefined && !bookUnavailable && book.length >= 12) {
    if (!/\d/.test(book)) problems.push('BOOK LINE has no numbers (odds or probabilities)')
    else if (!/no[\s-]?vig/i.test(book)) problems.push('BOOK LINE must give the no-vig probability (say "no-vig")')
  }

  const sentiment = sections.get('sentiment')
  if (sentiment !== undefined && unavailableReason(sentiment) === null && sentiment.length >= 12 && !/https?:\/\//i.test(sentiment)) {
    problems.push('SENTIMENT SCAN names no thread or forum link; link what you scanned, or write "unavailable — <reason>"')
  }
  if (sentiment !== undefined && unavailableReason(sentiment) === null && sentiment.length >= 12 && crowdLeanFromScan(sentiment) === null) {
    problems.push('SENTIMENT SCAN must state the crowd\'s lean for the side you propose ("crowd lean: 62%" = the crowd\'s chance that your side wins, 0-100); the ledger keeps it and scores the crowd against the result')
  }

  const fusion = sections.get('fusion')
  if (fusion !== undefined && fusion.length >= 12) {
    const range = /(\d+(?:\.\d+)?)\s*%?\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*%?/i.exec(fusion)
    if (!range) {
      problems.push('FUSION states no probability range (write "range: 52-58%")')
    } else {
      const lo = asProbability(Number(range[1]))
      const hi = asProbability(Number(range[2]))
      if (!(lo <= hi)) problems.push('FUSION range is backwards (low must not exceed high)')
      else if (input.probability < lo - 0.005 || input.probability > hi + 0.005) {
        problems.push(`the proposal's probability ${(input.probability * 100).toFixed(1)}% is outside the FUSION range ${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%`)
      }
    }
    const weight = /sentiment weight\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(fusion)
    if (!weight) {
      problems.push('FUSION must state the crowd\'s weight ("sentiment weight: 0%")')
    } else {
      const allowed = allowedSentimentWeightPct(sentiment)
      if (Number(weight[1]) > allowed + 1e-9) {
        problems.push(`sentiment weight ${weight[1]}% is more than the crowd has earned (${allowed}%): it needs a stated record of at least ${FUNDS_CROWD_MIN_COMPARABLE_FIGHTS} comparable fights called ${FUNDS_CROWD_MIN_HIT_RATE_PCT}%+ correctly ("N of M"), and is never more than ${FUNDS_SENTIMENT_MAX_WEIGHT_PCT}%`)
      }
    }
  }

  const edge = sections.get('edge')
  if (edge !== undefined && edge.length >= 12) {
    const net = /net(?:\s+edge)?\s*[:=]?\s*\+?(\d+(?:\.\d+)?)\s*(?:¢|c\b|cents?)/i.exec(edge)
    if (!net) {
      problems.push('EDGE states no net edge in cents (write "net edge: 7¢")')
    } else {
      const netCents = Number(net[1])
      const priceCents = input.price * 100
      const extreme = priceCents <= bars.extremeLowCents || priceCents >= bars.extremeHighCents
      const bar = extreme ? bars.minNetEdgeExtremeCents : bars.minNetEdgeCents
      const grossCents = (input.probability - input.price) * 100
      if (netCents < bar) problems.push(`net edge ${netCents}¢ is below the ${bar}¢ bar${extreme ? ' for a side priced at the extremes' : ' for a taker entry'}`)
      if (netCents > grossCents + 0.5) problems.push(`net edge ${netCents}¢ is more than the gross edge ${grossCents.toFixed(1)}¢ (probability minus price); a net edge cannot exceed it`)
    }
  }

  return { ok: problems.length === 0, problems }
}

/** The skeleton shown to the model: the exact headings, one hint each. */
export function fightTemplateSkeleton(): string {
  return FIGHT_SECTIONS.map(s => `${s.label}: <${s.hint}>`).join('\n')
}

/** The refusal text: what is wrong, then the template. */
export function fightRefusal(market: string, check: FightCheck): string {
  return `${market} is a fight-card market, so the rationale must follow the fight template, and the ledger checks it (not the model). ` +
    `Problems:\n${check.problems.map(p => `- ${p}`).join('\n')}\nWrite the rationale as these labeled lines:\n${fightTemplateSkeleton()}`
}
