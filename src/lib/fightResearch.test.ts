import { describe, expect, it } from 'vitest'
import {
  FIGHTER_STATE_MAX_WEIGHT_PCT, FIGHT_RATIONALE_MAX_CHARS, FIGHT_SECTIONS, FUNDS_SENTIMENT_MAX_WEIGHT_PCT, SENTIMENT_MAX_LINKS, allowedSentimentWeightPct, checkFightRationale,
  crowdLeanFromScan, extractSentimentSnapshot, fightRefusal, fightTemplateSkeleton, isFightMarket, parseFightRationale, swarmSimFromFusion,
} from './fightResearch'

const BARS = { minNetEdgeCents: 5, minNetEdgeExtremeCents: 10, extremeLowCents: 15, extremeHighCents: 85 }
const THREAD = 'https://www.reddit.com/r/MMA/comments/1xdgbl2/petr_yan_vs_merab_dvalishvili_faceoff/'

/** A complete, well-formed rationale: Yan side at 0.55 with a 0.62 estimate (gross 7¢, net 6¢). */
const GOOD = [
  'REMATCH SEQUENCE: Merab won decisively in 2023; Yan took the belt back in Dec 2025 (UFC 323). This is the rubber match.',
  'BOOK LINE: DraftKings Yan -150 and BetMGM -148, no-vig 58.1% for Yan; Kalshi YES ask 55c.',
  'STATS & FACTS: Yan 4-fight streak; both made weight at the official weigh-ins (source: ufc.com results page).',
  'MATCHUP NEUTRALIZATION: primary path: Merab wins by wrestling pace and top control, Yan by standing Muay Thai; neutralization: demonstrated — Yan defended the takedowns for five rounds in the second fight after losing the first to the wrestling; the fight that remains: a standing fight, which favors Yan.',
  `SENTIMENT SCAN: r/MMA threads ${THREAD}. The crowd leans Merab: crowd lean: 44%. Record on comparable fights: 6 of 12 called correctly.`,
  'FIGHTER STATE: unavailable — no own-account post was indexed for either fighter in the last 60 days.',
  'FUSION: range: 58-65%; the book line and facts carry it, statistics adjust it; sentiment weight: 0%; fighter-state weight: 0%.',
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

  it('every one of the nine sections is required, and named in the problem', () => {
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

  it('the matchup section must run the neutralization steps, not just be present', () => {
    const noPaths = GOOD.replace(/MATCHUP NEUTRALIZATION:.*/, 'MATCHUP NEUTRALIZATION: neutralization: demonstrated — Yan defended the takedowns in fight two; the fight that remains: a standing fight, which favors Yan.')
    expect(check({ rationale: noPaths }).problems).toContain('MATCHUP NEUTRALIZATION must name each fighter\'s primary path to victory ("primary path: ...")')
    const noVerdict = GOOD.replace(/MATCHUP NEUTRALIZATION:.*/, 'MATCHUP NEUTRALIZATION: primary path: Merab by wrestling pace, Yan by standing Muay Thai; the fight that remains: a standing fight, which favors Yan.')
    expect(check({ rationale: noVerdict }).problems).toContain('MATCHUP NEUTRALIZATION must give its verdict ("neutralization: demonstrated" or "neutralization: not demonstrated") with the evidence for it')
    const noRemains = GOOD.replace(/MATCHUP NEUTRALIZATION:.*/, 'MATCHUP NEUTRALIZATION: primary path: Merab by wrestling pace, Yan by standing Muay Thai; neutralization: demonstrated — Yan defended the takedowns in fight two.')
    expect(check({ rationale: noRemains }).problems).toContain('MATCHUP NEUTRALIZATION must reassess the matchup left over if the key strength is taken away ("the fight that remains: ...")')
  })

  it('"not demonstrated" is a valid neutralization verdict, and "unavailable" does not excuse the section', () => {
    const notShown = GOOD.replace('neutralization: demonstrated', 'neutralization: not demonstrated')
    expect(check({ rationale: notShown }).ok).toBe(true)
    const dodged = GOOD.replace(/MATCHUP NEUTRALIZATION:.*/, 'MATCHUP NEUTRALIZATION: unavailable — no prior meeting to judge from')
    expect(check({ rationale: dodged }).ok).toBe(false)
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
    expect(result.problems.join('\n')).toContain(`is kept whole only up to ${FIGHT_RATIONALE_MAX_CHARS}`)
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
  it('lists every problem and the nine headings, so one rewrite can fix it', () => {
    const result = check({ rationale: 'a hunch about this fight and nothing more to say' })
    const text = fightRefusal('KXUFCFIGHT-26OCT24YANDVA-YAN', result)
    expect(result.problems.length).toBeGreaterThanOrEqual(9)
    for (const section of FIGHT_SECTIONS) expect(text).toContain(`${section.label}: <`)
    expect(fightTemplateSkeleton().split('\n')).toHaveLength(9)
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

const YAN_POST = 'https://www.instagram.com/p/DeKZJkACIyx/'
const READ_STATE = `FIGHTER STATE: Yan's own Instagram post of Oct 6 ${YAN_POST} ("That's the job, it has to be done") is routine camp content; Merab's X post of Oct 16 https://x.com/MerabDvalishvil/status/2108000000000000000 ("Ready to go") is the same. Neither shows anything beyond training mode.`
const withState = (state: string, weight: string) =>
  GOOD.replace(/FIGHTER STATE:.*/, state).replace('fighter-state weight: 0%', `fighter-state weight: ${weight}`)

describe('FIGHTER STATE: the fighters\' own posts, at a small fixed weight (owner ruling 2026-10-24)', () => {
  it('is a required section, in the template, after the crowd and before the fusion', () => {
    const keys = FIGHT_SECTIONS.map(s => s.key)
    expect(keys.indexOf('state')).toBe(keys.indexOf('sentiment') + 1)
    expect(keys.indexOf('state')).toBeLessThan(keys.indexOf('fusion'))
    const missing = check({ rationale: GOOD.replace(/FIGHTER STATE:.*\n/, '') })
    expect(missing.problems).toContain('FIGHTER STATE is missing (write "FIGHTER STATE: ..." on its own line)')
  })

  it('a linked read passes at a weight up to the cap', () => {
    expect(check({ rationale: withState(READ_STATE, '0%') }).ok).toBe(true)
    expect(check({ rationale: withState(READ_STATE, `${FIGHTER_STATE_MAX_WEIGHT_PCT}%`) }).ok).toBe(true)
  })

  it('refuses a weight above the cap', () => {
    const result = check({ rationale: withState(READ_STATE, `${FIGHTER_STATE_MAX_WEIGHT_PCT + 1}%`) })
    expect(result.problems.join('\n')).toContain(`above the ${FIGHTER_STATE_MAX_WEIGHT_PCT}% cap`)
  })

  it('refuses any weight when nothing was read (unavailable) or no post is linked', () => {
    const unavailable = 'FIGHTER STATE: unavailable — no own-account post was indexed for either fighter in the last 60 days.'
    expect(check({ rationale: withState(unavailable, '0%') }).ok).toBe(true)
    expect(check({ rationale: withState(unavailable, '2%') }).problems.join('\n')).toContain('with nothing read the weight is 0%')
    const unlinked = 'FIGHTER STATE: both fighters sound calm and confident in their recent posts and interviews.'
    const result = check({ rationale: withState(unlinked, '2%') })
    expect(result.problems.join('\n')).toContain('FIGHTER STATE names no post link')
    expect(result.problems.join('\n')).toContain('with nothing read the weight is 0%')
  })

  it('unavailable needs a named reason, like the other evidence sections', () => {
    const result = check({ rationale: withState('FIGHTER STATE: unavailable now', '0%') })
    expect(result.problems.join('\n')).toContain('FIGHTER STATE says unavailable without a reason')
  })

  it('the weight must be stated, and is separate from the crowd\'s weight', () => {
    const noStatement = GOOD.replace('; fighter-state weight: 0%', '')
    expect(check({ rationale: noStatement }).problems.join('\n')).toContain('FUSION must state the fighter-state weight')
    // The crowd's own cap and rule are untouched by it: a crowd weight above what it earned is still refused.
    const crowd = GOOD.replace('sentiment weight: 0%', 'sentiment weight: 10%')
    expect(check({ rationale: crowd }).problems.join('\n')).toContain('more than the crowd has earned')
  })
})

describe('the optional swarm sim line in FUSION (MiroFish lane)', () => {
  const withSim = (line: string) => GOOD.replace('fighter-state weight: 0%.', `fighter-state weight: 0%. ${line}`)
  const checkSim = (rationale: string, expectedSimWeightPct?: number) =>
    checkFightRationale({ rationale, probability: 0.62, price: 0.55, expectedSimWeightPct }, BARS)

  it('a rationale without the line is complete — its absence never fails', () => {
    expect(checkSim(GOOD).ok).toBe(true)
    expect(checkSim(GOOD, 0).ok).toBe(true)
  })

  it('a well-formed line at the earned weight passes, and parses back', () => {
    const rationale = withSim('swarm sim: 62% YES (weight 0%, run sim-20261024-yan)')
    expect(checkSim(rationale, 0)).toEqual({ ok: true, problems: [] })
    const fusion = parseFightRationale(rationale).get('fusion')!
    expect(swarmSimFromFusion(fusion)).toEqual({ medianPct: 62, side: 'YES', weightPct: 0, runId: 'sim-20261024-yan' })
  })

  it('a weight-0 line validates: the run is recorded for calibration even when it moves nothing', () => {
    expect(checkSim(withSim('swarm sim: 44% NO (weight 0%, run sim-20261024-merab)'), 0).ok).toBe(true)
  })

  it('a stated weight that is not the lane\'s earned weight is refused', () => {
    const result = checkSim(withSim('swarm sim: 62% YES (weight 10%, run sim-20261024-yan)'), 0)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('swarm sim weight 10% is not the sim lane\'s earned weight (0%)')
    const earned = checkSim(withSim('swarm sim: 62% YES (weight 10%, run sim-20261024-yan)'), 10)
    expect(earned.ok).toBe(true)
  })

  it('a malformed swarm sim line fails the check — present means held to the format', () => {
    const prose = checkSim(withSim('swarm sim: the swarm liked Yan here (weight 0%)'), 0)
    expect(prose.ok).toBe(false)
    expect(prose.problems.join('\n')).toContain('swarm sim line is malformed')
    const impossible = checkSim(withSim('swarm sim: 140% YES (weight 0%, run sim-x)'), 0)
    expect(impossible.ok).toBe(false)
    expect(impossible.problems.join('\n')).toContain('swarm sim line is malformed')
  })

  it('with no earned weight passed in, only the format is held (the checker stays pure)', () => {
    expect(checkSim(withSim('swarm sim: 62% YES (weight 10%, run sim-20261024-yan)')).ok).toBe(true)
  })
})
