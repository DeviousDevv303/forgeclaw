import { describe, expect, it } from 'vitest'
import {
  FIGHT_RATIONALE_MAX_CHARS, FIGHT_SECTIONS, FUNDS_SENTIMENT_MAX_WEIGHT_PCT, SENTIMENT_MAX_LINKS, allowedSentimentWeightPct, checkFightRationale,
  crowdLeanFromScan, extractSentimentSnapshot, fightRefusal, fightTemplateSkeleton, isFightMarket, parseFightRationale,
} from './fightResearch'

const BARS = { minNetEdgeCents: 5, minNetEdgeExtremeCents: 10, extremeLowCents: 15, extremeHighCents: 85 }
const THREAD = 'https://www.reddit.com/r/MMA/comments/1xdgbl2/petr_yan_vs_merab_dvalishvili_faceoff/'

/** A complete, well-formed rationale: Yan side at 0.55 with a 0.62 estimate (gross 7¢, net 6¢). */
const GOOD = [
  'REMATCH SEQUENCE: Merab won decisively in 2023; Yan took the belt back in Dec 2025 (UFC 323). This is the rubber match.',
  'BOOK LINE: DraftKings Yan -150 and BetMGM -148, no-vig 58.1% for Yan; Kalshi YES ask 55c.',
  'STATS & FACTS: Yan 4-fight streak; both made weight at the official weigh-ins (source: ufc.com results page).',
  `SENTIMENT SCAN: r/MMA threads ${THREAD}. The crowd leans Merab: crowd lean: 44%. Record on comparable fights: 6 of 12 called correctly.`,
  'FUSION: range: 58-65%; the book line and facts carry it, statistics adjust it; sentiment weight: 0%.',
  'EDGE: net edge: 6¢ per contract after the 2¢ fee and the 1¢ spread.',
  'FALSIFIER: a late injury report for Yan, or the line moving to Merab -120 before the walkout.',
].join('\n')

const check = (over: Partial<{ rationale: string; probability: number; price: number }> = {}) =>
  checkFightRationale({ rationale: GOOD, probability: 0.62, price: 0.55, ...over }, BARS)

describe('isFightMarket', () => {
  it('only Kalshi fight-series tickers', () => {
    expect(isFightMarket('kalshi', 'KXUFCFIGHT-26OCT24YANDVA-YAN')).toBe(true)
    expect(isFightMarket('Kalshi', 'kxmmafight-26oct24abc-abc')).toBe(true)
    expect(isFightMarket('kalshi', 'KXMMAEXFIGHT-26OCT24X-Y')).toBe(true)
    expect(isFightMarket('kalshi', 'KXHIGHNY-26OCT24-B70')).toBe(false)
    expect(isFightMarket('kalshi', 'KXUFCFIGHTOCCUR-26OCT24X')).toBe(false)
    expect(isFightMarket('draftkings', 'KXUFCFIGHT-26OCT24YANDVA-YAN')).toBe(false)
  })
})

describe('the template', () => {
  it('a complete rationale passes', () => {
    expect(check()).toEqual({ ok: true, problems: [] })
  })

  it('parses labeled sections, with list markers, bold, numbering and AND for &', () => {
    const parsed = parseFightRationale('1. **REMATCH SEQUENCE** — first meeting here, no prior bout\n- BOOK LINE: x\n  continued line\n__STATS AND FACTS__: facts')
    expect(parsed.get('rematch')).toBe('first meeting here, no prior bout')
    expect(parsed.get('book')).toBe('x\n  continued line'.trim())
    expect(parsed.get('stats')).toBe('facts')
  })

  it('every one of the seven sections is required, and named in the problem', () => {
    for (const section of FIGHT_SECTIONS) {
      const without = GOOD.split('\n').filter(line => !section.pattern.test(line)).join('\n')
      const result = check({ rationale: without })
      expect(result.ok, section.label).toBe(false)
      expect(result.problems.join('\n'), section.label).toContain(`${section.label} is missing`)
    }
  })

  it('a section with no real content is refused', () => {
    const result = check({ rationale: GOOD.replace(/FALSIFIER:.*/, 'FALSIFIER: tbd') })
    expect(result.problems).toContain('FALSIFIER is empty or too short to be evidence (12+ characters)')
  })

  it('"unavailable" is allowed only with a named reason, never silently', () => {
    const named = GOOD.replace(/SENTIMENT SCAN:.*/, 'SENTIMENT SCAN: unavailable — Reddit blocked the fetch (HTTP 403)')
    expect(check({ rationale: named }).ok).toBe(true)
    const bare = GOOD.replace(/SENTIMENT SCAN:.*/, 'SENTIMENT SCAN: unavailable now')
    expect(check({ rationale: bare }).problems.join('\n')).toContain('SENTIMENT SCAN says unavailable without a reason')
  })

  it('BOOK LINE and STATS & FACTS cannot both be unavailable', () => {
    const both = GOOD
      .replace(/BOOK LINE:.*/, 'BOOK LINE: unavailable — books not reachable tonight')
      .replace(/STATS & FACTS:.*/, 'STATS & FACTS: unavailable — nothing fetched this run')
    expect(check({ rationale: both }).problems).toContain('BOOK LINE and STATS & FACTS are both unavailable; a wager needs at least one of them as real data')
    const oneOnly = GOOD.replace(/BOOK LINE:.*/, 'BOOK LINE: unavailable — books not reachable tonight')
    expect(check({ rationale: oneOnly }).ok).toBe(true)
  })

  it('a book line needs numbers and the no-vig probability', () => {
    expect(check({ rationale: GOOD.replace(/BOOK LINE:.*/, 'BOOK LINE: the books like the champion, clearly') }).problems).toContain('BOOK LINE has no numbers (odds or probabilities)')
    expect(check({ rationale: GOOD.replace(/BOOK LINE:.*/, 'BOOK LINE: DraftKings Yan -150, Kalshi ask 55c') }).problems).toContain('BOOK LINE must give the no-vig probability (say "no-vig")')
  })

  it('a sentiment scan must link what it scanned', () => {
    const noLink = GOOD.replace(THREAD, 'a thread')
    expect(check({ rationale: noLink }).problems.join('\n')).toContain('SENTIMENT SCAN names no thread or forum link')
  })

  it('too-long rationales are refused rather than silently cut (the falsifier is last)', () => {
    const result = check({ rationale: `${GOOD}\n${'x'.repeat(FIGHT_RATIONALE_MAX_CHARS)}` })
    expect(result.problems.join('\n')).toMatch(/is kept whole only up to 4000/)
  })
})

describe('the fusion is held to the proposal and to what the crowd has earned', () => {
  it('the proposal probability must sit inside the stated range', () => {
    expect(check({ probability: 0.7 }).problems.join('\n')).toMatch(/probability 70\.0% is outside the FUSION range 58\.0-65\.0%/)
    expect(check({ probability: 0.62 }).ok).toBe(true)
    expect(check({ rationale: GOOD.replace('range: 58-65%', 'range: 0.58 to 0.65') }).ok).toBe(true)
    expect(check({ rationale: GOOD.replace('range: 58-65%', 'range: 65-58%') }).problems).toContain('FUSION range is backwards (low must not exceed high)')
    expect(check({ rationale: GOOD.replace('range: 58-65%; ', '') }).problems).toContain('FUSION states no probability range (write "range: 52-58%")')
  })

  it('the crowd weighs 0% unless its measured record clears the bars', () => {
    const withWeight = (n: number, record: string) => GOOD
      .replace('sentiment weight: 0%', `sentiment weight: ${n}%`)
      .replace('6 of 12 called correctly', record)
    // 6 of 12 = 50%: below 55%
    expect(check({ rationale: withWeight(5, '6 of 12 called correctly') }).problems.join('\n')).toMatch(/sentiment weight 5% is more than the crowd has earned \(0%\)/)
    // 8 of 12 = 67%, 12 fights: earned, capped at the owner's 10%
    expect(check({ rationale: withWeight(10, '8 of 12 called correctly') }).ok).toBe(true)
    expect(check({ rationale: withWeight(11, '8 of 12 called correctly') }).problems.join('\n')).toMatch(/more than the crowd has earned \(10%\)/)
    // 9 of 9 is a perfect record but too few comparable fights
    expect(check({ rationale: withWeight(5, '9 of 9 called correctly') }).problems.join('\n')).toMatch(/earned \(0%\)/)
    // no record stated at all
    expect(check({ rationale: withWeight(5, 'a general lean') }).problems.join('\n')).toMatch(/earned \(0%\)/)
    expect(check({ rationale: GOOD.replace('; sentiment weight: 0%', '') }).problems).toContain('FUSION must state the crowd\'s weight ("sentiment weight: 0%")')
  })

  it('allowedSentimentWeightPct is zero when unavailable, impossible or unmeasured, and the owner\'s cap when earned', () => {
    expect(allowedSentimentWeightPct(undefined)).toBe(0)
    expect(allowedSentimentWeightPct('unavailable — blocked')).toBe(0)
    expect(allowedSentimentWeightPct('13 of 12 called correctly')).toBe(0)
    expect(allowedSentimentWeightPct('7 of 12 called correctly')).toBe(FUNDS_SENTIMENT_MAX_WEIGHT_PCT)
    expect(FUNDS_SENTIMENT_MAX_WEIGHT_PCT).toBe(10)
  })
})

describe('the stated edge is held to the bar and to arithmetic', () => {
  it('below the taker bar is refused; above the gross edge is refused', () => {
    expect(check({ rationale: GOOD.replace('net edge: 6¢', 'net edge: 3¢') }).problems.join('\n')).toMatch(/net edge 3¢ is below the 5¢ bar for a taker entry/)
    expect(check({ rationale: GOOD.replace('net edge: 6¢', 'net edge: 9¢') }).problems.join('\n')).toMatch(/net edge 9¢ is more than the gross edge 7\.0¢/)
    expect(check({ rationale: GOOD.replace('EDGE: net edge: 6¢ per contract', 'EDGE: a good edge per contract') }).problems).toContain('EDGE states no net edge in cents (write "net edge: 7¢")')
  })

  it('a side priced at the extremes needs the higher bar', () => {
    const cheap = check({ price: 0.1, probability: 0.18, rationale: GOOD.replace('range: 58-65%', 'range: 15-20%').replace('net edge: 6¢', 'net edge: 7¢') })
    expect(cheap.problems.join('\n')).toMatch(/net edge 7¢ is below the 10¢ bar for a side priced at the extremes/)
  })
})

describe('the refusal teaches the template', () => {
  it('lists every problem and the seven headings, so one rewrite can fix it', () => {
    const result = check({ rationale: 'a hunch about this fight and nothing more to say' })
    const text = fightRefusal('KXUFCFIGHT-26OCT24YANDVA-YAN', result)
    expect(result.problems.length).toBeGreaterThanOrEqual(7)
    for (const section of FIGHT_SECTIONS) expect(text).toContain(`${section.label}: <`)
    expect(fightTemplateSkeleton().split('\n')).toHaveLength(7)
    expect(text).toContain('the ledger checks it (not the model)')
  })
})

// Owner directive 2026-10-24 (B): the crowd's lean is kept on the position and scored against the result at settle time.
describe('the crowd\'s lean (item B)', () => {
  it('reads "crowd lean: N%" as the crowd\'s chance (0-1) that the proposed side wins', () => {
    expect(crowdLeanFromScan('threads... crowd lean: 62%. record 6 of 12')).toBe(0.62)
    expect(crowdLeanFromScan("The crowd's lean 41.5 % for Yan")).toBe(0.415)
    expect(crowdLeanFromScan('CROWD LEAN = 0%')).toBe(0)
    expect(crowdLeanFromScan('crowd lean: 100%')).toBe(1)
  })

  it('rejects what is not a stated percentage: no percent sign, out of range, only words, or nothing', () => {
    for (const text of ['crowd lean: 0.62', 'crowd lean: 120%', 'the crowd leans Merab', 'lean 62%', '', undefined]) {
      expect(crowdLeanFromScan(text), String(text)).toBeNull()
    }
  })

  it('a scan with links but no stated lean is refused, naming what to write', () => {
    const noLean = GOOD.replace(/SENTIMENT SCAN:.*/, `SENTIMENT SCAN: r/MMA threads ${THREAD}. The crowd leans Merab. Record on comparable fights: 6 of 12 called correctly.`)
    const result = check({ rationale: noLean })
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('SENTIMENT SCAN must state the crowd\'s lean for the side you propose ("crowd lean: 62%"')
    expect(check({ rationale: GOOD.replace('crowd lean: 44%', 'crowd lean: 144%') }).ok).toBe(false)
  })

  it('an unavailable scan needs no lean (there was nothing to lean)', () => {
    const unavailable = GOOD.replace(/SENTIMENT SCAN:.*/, 'SENTIMENT SCAN: unavailable — Reddit blocked the fetch (HTTP 403)')
    expect(check({ rationale: unavailable })).toEqual({ ok: true, problems: [] })
  })

  it('the template shown to the model asks for it', () => {
    expect(fightTemplateSkeleton()).toContain('"crowd lean: <n>%" = the crowd\'s chance that YOUR side wins')
  })

  it('the snapshot keeps the lean, the fusion weight and the links, stamped with the clock it is given', () => {
    const snap = extractSentimentSnapshot(GOOD, 1234)
    expect(snap).toEqual({ lean: 0.44, weightPct: 0, links: [THREAD], recordedAt: 1234 })
  })

  it('reads the weight the fusion actually states', () => {
    const weighted = GOOD.replace('sentiment weight: 0%', 'sentiment weight: 8%')
    expect(extractSentimentSnapshot(weighted, 1)!.weightPct).toBe(8)
  })

  it('an unavailable scan is kept as no lean, with its reason and no links', () => {
    const unavailable = GOOD.replace(/SENTIMENT SCAN:.*/, 'SENTIMENT SCAN: unavailable — Reddit blocked the fetch (HTTP 403)')
    expect(extractSentimentSnapshot(unavailable, 1)).toEqual({ lean: null, weightPct: 0, links: [], reason: 'Reddit blocked the fetch (HTTP 403)', recordedAt: 1 })
  })

  it('keeps each distinct link once and no more than the cap', () => {
    const many = Array.from({ length: SENTIMENT_MAX_LINKS + 3 }, (_, i) => `https://www.reddit.com/r/MMA/comments/t${i}/x/`)
    const scan = `SENTIMENT SCAN: ${many.join(' ')} ${many[0]} crowd lean: 50%. 6 of 12 called correctly.`
    const snap = extractSentimentSnapshot(GOOD.replace(/SENTIMENT SCAN:.*/, scan), 1)!
    expect(snap.links).toEqual(many.slice(0, SENTIMENT_MAX_LINKS))
  })

  it('a rationale with no scan has no snapshot', () => {
    expect(extractSentimentSnapshot('just an opinion about the fight, no template at all', 1)).toBeNull()
  })
})
