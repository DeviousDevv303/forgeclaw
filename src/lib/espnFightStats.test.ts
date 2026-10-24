import { describe, expect, it } from 'vitest'
import { accuracyPct, espnFightStats, fightsWithFighter, matchEvents, parseCalendar, parseFightcenter } from './espnFightStats'

// Trimmed from ESPN's real UFC 333 responses (2026-10-24): the field names and the "landed/attempted" displayValue
// strings are as ESPN sends them. The live and not-started fights are invented to cover those states.
const stat = (name: string, value: number, displayValue: string) => ({ name, value, displayValue })
const competitor = (name: string, winner: boolean, record: string, s: [number, string, string, string, string, string, number, string]) => ({
  athlete: { displayName: name }, winner, displayRecord: record,
  stats: [
    stat('knockDowns', s[0], String(s[0])), stat('totalStrikes', 0, s[1]), stat('sigStrikes', 0, s[2]),
    stat('headStrikes', 0, s[3]), stat('bodyStrikes', 0, s[4]), stat('legStrikes', 0, s[5]),
    stat('timeInControl', s[6], ''), stat('takedowns', 0, s[7]), stat('submissions', 0, '0'),
  ],
})
const status = (state: string, period: number, clock: string, result?: string) => ({
  period, displayClock: clock, type: { state }, ...(result ? { result: { displayName: result } } : {}),
})

const FIGHTCENTER = {
  event: { id: '600061267', name: 'UFC 333: Volkanovski vs. Evloev', date: '2026-10-24T14:00:00.000+00:00' },
  cards: {
    main: { displayName: 'Main Card', competitions: [
      { id: '401911633', note: 'Bantamweight - Title Fight', cardSegment: { description: 'Main Card' },
        status: status('post', 5, '5:00', 'Decision - Unanimous'), judgesScores: '48-47 | 48-47 | 48-47',
        competitors: [
          competitor('Merab Dvalishvili', false, '21-6-0', [0, '159/396', '131/363', '100/298', '8/18', '23/47', 114, '5/58']),
          competitor('Petr Yan', true, '21-5-0', [0, '131/231', '128/228', '95/194', '18/19', '15/15', 23, '0/1']),
        ] },
      { id: '900000001', note: 'Lightweight', cardSegment: { description: 'Main Card' }, status: status('in', 2, '3:10'),
        competitors: [
          { athlete: { displayName: 'Live Fighter' }, winner: false, stats: [stat('sigStrikes', 12, '12/30')] },
          { athlete: { displayName: 'Other Fighter' }, winner: false, stats: [stat('sigStrikes', 9, '9/25')] },
        ] },
      { id: '900000002', note: 'Flyweight', cardSegment: { description: 'Main Card' }, status: status('pre', 0, '0:00'),
        competitors: [{ athlete: { displayName: 'Not Yet' }, stats: [] }, { athlete: { displayName: 'Started' }, stats: [] }] },
    ] },
  },
}

const SCOREBOARD = {
  leagues: [{ calendar: [
    { label: 'UFC 325: Volkanovski vs. Lopes 2', startDate: '2026-02-01T01:00Z', event: { $ref: 'http://sports.core.api.espn.pvt/v2/sports/mma/leagues/ufc/events/600057025?lang=en' } },
    { label: 'UFC 333: Volkanovski vs. Evloev', startDate: '2026-10-24T14:00Z', event: { $ref: 'http://sports.core.api.espn.pvt/v2/sports/mma/leagues/ufc/events/600061267?lang=en' } },
    { label: 'UFC 334: Future vs. Card', startDate: '2026-11-14T01:00Z', event: { $ref: 'http://sports.core.api.espn.pvt/v2/sports/mma/leagues/ufc/events/600061999?lang=en' } },
  ] }],
  events: [{ id: '600061267' }],
}

const NOW = Date.parse('2026-10-24T22:00:00Z')

function fakeFetch() {
  const urls: string[] = []
  const doFetch = async (url: string) => {
    urls.push(url)
    if (url.includes('/scoreboard')) return Response.json(SCOREBOARD)
    if (url.endsWith('/fightcenter/600061267')) return Response.json(FIGHTCENTER)
    return new Response('not found', { status: 404 })
  }
  return { doFetch, urls }
}

describe('espnFightStats', () => {
  it('parses each fighter\'s landed/attempted tallies from a Fightcenter card', () => {
    const ev = parseFightcenter(FIGHTCENTER)
    expect(ev.eventName).toBe('UFC 333: Volkanovski vs. Evloev')
    expect(ev.fights.map(f => f.state)).toEqual(['post', 'in', 'pre'])
    const [merab, yan] = ev.fights[0].fighters
    expect(yan).toMatchObject({ name: 'Petr Yan', winner: true, sigStrikes: { landed: 128, attempted: 228 }, takedowns: { landed: 0, attempted: 1 }, controlSeconds: 23 })
    expect(merab.sigStrikes).toEqual({ landed: 131, attempted: 363 })
    expect(accuracyPct(yan.sigStrikes)!.toFixed(1)).toBe('56.1')
    // No winner is reported for a fight still going, whatever the raw flag says.
    expect(ev.fights[1].fighters[0].winner).toBeNull()
  })

  it('tolerates malformed payloads instead of throwing', () => {
    expect(parseFightcenter(null).fights).toEqual([])
    expect(parseFightcenter({ cards: { main: { competitions: [{ competitors: [{}] }] } } }).fights[0].fighters[0].sigStrikes).toBeNull()
    expect(accuracyPct({ landed: 0, attempted: 0 })).toBeNull()
  })

  it('finds events by name on the season calendar, latest first, skipping cards that have not started', () => {
    const cal = parseCalendar(SCOREBOARD)
    expect(cal.map(e => e.id)).toEqual(['600057025', '600061267', '600061999'])
    expect(matchEvents(cal, 'volkanovski', NOW).map(e => e.id)).toEqual(['600061267', '600057025'])
    expect(matchEvents(cal, 'UFC 333', NOW).map(e => e.id)).toEqual(['600061267'])
    expect(matchEvents(cal, 'ufc 334', NOW)).toEqual([])
  })

  it('matches fighters by name prefix', () => {
    const fights = parseFightcenter(FIGHTCENTER).fights
    expect(fightsWithFighter(fights, 'yan').map(f => f.id)).toEqual(['401911633'])
    expect(fightsWithFighter(fights, 'petr yan').map(f => f.id)).toEqual(['401911633'])
    expect(fightsWithFighter(fights, 'ryan')).toEqual([])
  })

  it('shows completed fights with accuracy and names what it left out', async () => {
    const { doFetch, urls } = fakeFetch()
    const text = await espnFightStats({ event: 'UFC 333', doFetch, nowMs: NOW })
    expect(urls).toHaveLength(2)
    expect(text).toContain('Merab Dvalishvili vs Petr Yan — Bantamweight - Title Fight: Decision - Unanimous, R5 5:00, judges 48-47 | 48-47 | 48-47')
    expect(text).toContain('Petr Yan (W): sig strikes 128/228 (56%), total 131/231 (57%)')
    expect(text).toContain('TD 5/58 (9%), control 1:54')
    expect(text).not.toContain('Live Fighter')
    expect(text).toContain('1 fight(s) in progress left out')
    expect(text).toContain('1 fight(s) not started yet')
    expect(text).toContain('https://www.espn.com/mma/fightcenter/_/id/600061267/league/ufc')
  })

  it('labels a live fight as partial, never as a result', async () => {
    const { doFetch } = fakeFetch()
    const text = await espnFightStats({ eventId: '600061267', includeLive: true, doFetch })
    expect(text).toContain('Live Fighter vs Other Fighter — Lightweight: LIVE (partial, not a result) — round 2, 3:10 on the clock')
    expect(text).not.toContain('Live Fighter (W)')
    expect(text).not.toContain('Live Fighter (L)')
  })

  it('takes the event id from a pasted Fightcenter URL, and defaults to the current event', async () => {
    const a = fakeFetch()
    await espnFightStats({ eventId: 'https://www.espn.com/mma/fightcenter/_/id/600061267/league/ufc', doFetch: a.doFetch })
    expect(a.urls).toEqual(['https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/fightcenter/600061267'])
    const b = fakeFetch()
    await espnFightStats({ doFetch: b.doFetch })
    expect(b.urls[1]).toMatch(/fightcenter\/600061267$/)
  })

  it('says plainly when nothing matches or ESPN fails', async () => {
    const { doFetch } = fakeFetch()
    await expect(espnFightStats({ event: 'UFC 334', doFetch, nowMs: NOW })).rejects.toThrow(/No started UFC event/)
    await expect(espnFightStats({ eventId: '600061267', fighter: 'Jones', doFetch })).rejects.toThrow(/matching "Jones"/)
    await expect(espnFightStats({ eventId: '123', doFetch })).rejects.toThrow(/returned 404/)
  })
})
