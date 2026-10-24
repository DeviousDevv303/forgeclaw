// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── ESPN fight stats: strikes landed, accuracy, takedowns per completed fight ───────────────
// Owner request 2026-10-24: read ESPN's Fightcenter numbers (significant strikes, total strikes, accuracy,
// takedowns, control) for completed fights, so STATS & FACTS (fightResearch.ts) cites measured fight data
// instead of a recalled impression. ESPN's public JSON allows browser requests (Access-Control-Allow-Origin: *,
// verified 2026-10-24) and needs no key:
//   scoreboard  → the current event, plus the season calendar (every event's label and id)
//   fightcenter → every fight of one event, with each fighter's stats inline (one call per card)
// A fight still in progress carries partial numbers; it is shown only when asked for and is labelled LIVE, never
// as a result. A fight not yet started has no stats and is left out.

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard'
const FIGHTCENTER_URL = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/fightcenter'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** "landed of attempted"; attempted is null when ESPN gives only a count. */
export interface Tally { landed: number; attempted: number | null }

export interface FighterStats {
  name: string
  /** null while the fight has no winner (in progress, draw, no contest). */
  winner: boolean | null
  record: string | null
  knockdowns: number | null
  sigStrikes: Tally | null
  totalStrikes: Tally | null
  head: Tally | null
  body: Tally | null
  leg: Tally | null
  takedowns: Tally | null
  controlSeconds: number | null
  submissions: number | null
}

export type FightState = 'pre' | 'in' | 'post'

export interface FightStats {
  id: string
  segment: string
  note: string
  state: FightState
  /** "Decision - Unanimous", "KO/TKO", ...; null until ESPN posts it. */
  result: string | null
  round: number | null
  clock: string | null
  judgesScores: string | null
  fighters: FighterStats[]
}

export interface EventFightStats { eventId: string; eventName: string; date: string; fights: FightStats[] }

export interface CalendarEvent { id: string; label: string; startDate: string }

/** "131/363" → {131, 363}; a bare number → {n, null}. */
function tally(stat: { value?: unknown; displayValue?: unknown } | undefined): Tally | null {
  if (!stat) return null
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(stat.displayValue ?? ''))
  if (m) return { landed: Number(m[1]), attempted: Number(m[2]) }
  const n = Number(stat.value)
  return Number.isFinite(n) ? { landed: n, attempted: null } : null
}

function count(stat: { value?: unknown } | undefined): number | null {
  const n = Number(stat?.value)
  return stat && Number.isFinite(n) ? n : null
}

/** Landed as a percent of attempted, or null when there is nothing to divide by. */
export function accuracyPct(t: Tally | null): number | null {
  return t && t.attempted ? (t.landed / t.attempted) * 100 : null
}

// ESPN's JSON is untyped at the edge; read it defensively and skip what is malformed rather than throw.
/* eslint-disable @typescript-eslint/no-explicit-any */
function fighter(c: any, state: FightState): FighterStats {
  const stats: any[] = Array.isArray(c?.stats) ? c.stats : []
  const by = (name: string) => stats.find(s => s?.name === name)
  return {
    name: String(c?.athlete?.displayName ?? c?.athlete?.fullName ?? 'unknown'),
    winner: state === 'post' && typeof c?.winner === 'boolean' ? c.winner : null,
    record: typeof c?.displayRecord === 'string' ? c.displayRecord : null,
    knockdowns: count(by('knockDowns')),
    sigStrikes: tally(by('sigStrikes')),
    totalStrikes: tally(by('totalStrikes')),
    head: tally(by('headStrikes')),
    body: tally(by('bodyStrikes')),
    leg: tally(by('legStrikes')),
    takedowns: tally(by('takedowns')),
    controlSeconds: count(by('timeInControl')),
    submissions: count(by('submissions')),
  }
}

/** Every fight of a Fightcenter response, in card order (main card first). */
export function parseFightcenter(json: any): EventFightStats {
  const fights: FightStats[] = []
  const cards = json?.cards && typeof json.cards === 'object' ? json.cards : {}
  for (const card of Object.values<any>(cards)) {
    for (const c of Array.isArray(card?.competitions) ? card.competitions : []) {
      const rawState = c?.status?.type?.state
      const state: FightState = rawState === 'in' || rawState === 'post' ? rawState : 'pre'
      const round = Number(c?.status?.period)
      fights.push({
        id: String(c?.id ?? ''),
        segment: String(c?.cardSegment?.description ?? card?.displayName ?? ''),
        note: String(c?.note ?? c?.type?.text ?? ''),
        state,
        result: c?.status?.result?.displayName ? String(c.status.result.displayName) : null,
        round: Number.isFinite(round) && round > 0 ? round : null,
        clock: c?.status?.displayClock ? String(c.status.displayClock) : null,
        judgesScores: c?.judgesScores ? String(c.judgesScores) : null,
        fighters: (Array.isArray(c?.competitors) ? c.competitors : []).map((x: any) => fighter(x, state)),
      })
    }
  }
  return {
    eventId: String(json?.event?.id ?? ''),
    eventName: String(json?.event?.name ?? ''),
    date: String(json?.event?.date ?? ''),
    fights,
  }
}

/** The season calendar from a scoreboard response: label and event id of every event. */
export function parseCalendar(scoreboard: any): CalendarEvent[] {
  const calendar: any[] = scoreboard?.leagues?.[0]?.calendar ?? []
  return calendar.flatMap(entry => {
    const id = /\/events\/(\d+)/.exec(String(entry?.event?.$ref ?? ''))?.[1]
    return id ? [{ id, label: String(entry?.label ?? ''), startDate: String(entry?.startDate ?? '') }] : []
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean)

/**
 * The calendar events whose label holds every word of the query ("ufc 333", "yan dvalishvili"), latest first.
 * Only events that have started are returned unless includeFuture is set: a future card has no fight stats.
 */
export function matchEvents(calendar: CalendarEvent[], query: string, nowMs: number, includeFuture = false): CalendarEvent[] {
  const want = words(query)
  return calendar
    .filter(e => want.every(w => words(e.label).includes(w)))
    .filter(e => includeFuture || !(Date.parse(e.startDate) > nowMs))
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))
}

/** Fights in which some fighter's name holds every word of the query. */
export function fightsWithFighter(fights: FightStats[], query: string): FightStats[] {
  const want = words(query)
  return fights.filter(f => f.fighters.some(x => want.every(w => words(x.name).some(n => n.startsWith(w)))))
}

const fmtTally = (t: Tally | null) => {
  if (!t) return 'n/a'
  const pct = accuracyPct(t)
  return t.attempted === null ? String(t.landed) : `${t.landed}/${t.attempted}${pct === null ? '' : ` (${pct.toFixed(0)}%)`}`
}
const fmtControl = (s: number | null) => (s === null ? 'n/a' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

function formatFight(f: FightStats): string {
  const head = f.state === 'in'
    ? `LIVE (partial, not a result) — round ${f.round ?? '?'}, ${f.clock ?? '?'} on the clock`
    : `${f.result ?? 'result not posted'}${f.round ? `, R${f.round} ${f.clock ?? ''}`.trimEnd() : ''}${f.judgesScores ? `, judges ${f.judgesScores}` : ''}`
  const lines = [`${f.fighters.map(x => x.name).join(' vs ')} — ${f.note || f.segment}: ${head}`]
  for (const x of f.fighters) {
    const tag = x.winner === true ? ' (W)' : x.winner === false ? ' (L)' : ''
    lines.push(`  ${x.name}${tag}: sig strikes ${fmtTally(x.sigStrikes)}, total ${fmtTally(x.totalStrikes)}, ` +
      `head ${fmtTally(x.head)} / body ${fmtTally(x.body)} / leg ${fmtTally(x.leg)}, KD ${x.knockdowns ?? 'n/a'}, ` +
      `TD ${fmtTally(x.takedowns)}, control ${fmtControl(x.controlSeconds)}, sub attempts ${x.submissions ?? 'n/a'}`)
  }
  return lines.join('\n')
}

/** The text the model reads. States which fights were left out and why, never a silent omission. */
export function formatEventFightStats(ev: EventFightStats, fights: FightStats[], skipped: { pre: number; live: number }): string {
  const url = `https://www.espn.com/mma/fightcenter/_/id/${ev.eventId}/league/ufc`
  const out = [`${ev.eventName} (${ev.date.slice(0, 10)}) — ESPN Fightcenter stats. Source: ${url}`]
  if (fights.length) out.push(...fights.map(formatFight))
  else out.push('No fight on this card has stats yet.')
  const notes: string[] = []
  if (skipped.live) notes.push(`${skipped.live} fight(s) in progress left out (pass include_live to see partial numbers)`)
  if (skipped.pre) notes.push(`${skipped.pre} fight(s) not started yet, so no stats`)
  if (notes.length) out.push(`Not shown: ${notes.join('; ')}.`)
  out.push('Accuracy = landed ÷ attempted for that fight only. One fight is one sample; it is not a career rate.')
  return out.join('\n')
}

async function getJson(url: string, doFetch: Fetch, signal?: AbortSignal): Promise<unknown> {
  const res = await doFetch(url, { signal })
  if (!res.ok) throw new Error(`ESPN fight stats unavailable: ${url.split('?')[0]} returned ${res.status}`)
  return res.json()
}

export interface FightStatsInput {
  /** An ESPN event id (from a Fightcenter URL: .../fightcenter/_/id/<id>/...). */
  eventId?: string
  /** Words from the event's name, e.g. "UFC 333" or "Volkanovski Evloev". Without eventId or event: the current event. */
  event?: string
  /** Only fights with this fighter. */
  fighter?: string
  /** Also show fights in progress (partial numbers, labelled LIVE). */
  includeLive?: boolean
  doFetch?: Fetch
  signal?: AbortSignal
  nowMs?: number
}

export async function espnFightStats(input: FightStatsInput): Promise<string> {
  const doFetch = input.doFetch ?? fetch
  let eventId = input.eventId?.trim().match(/\d+/)?.[0]
  if (!eventId) {
    const scoreboard = await getJson(SCOREBOARD_URL, doFetch, input.signal) as { events?: { id?: string }[] }
    const query = input.event?.trim()
    if (query) {
      const hits = matchEvents(parseCalendar(scoreboard), query, input.nowMs ?? Date.now())
      if (!hits.length) throw new Error(`No started UFC event this season matches "${query}" on ESPN's calendar. Pass event_id from the Fightcenter URL for older events.`)
      eventId = hits[0].id
    } else {
      eventId = scoreboard?.events?.[0]?.id ? String(scoreboard.events[0].id) : undefined
      if (!eventId) throw new Error('ESPN lists no current UFC event. Name one ("UFC 333") or pass event_id.')
    }
  }

  const ev = parseFightcenter(await getJson(`${FIGHTCENTER_URL}/${eventId}`, doFetch, input.signal))
  let pool = ev.fights
  if (input.fighter?.trim()) {
    pool = fightsWithFighter(pool, input.fighter)
    if (!pool.length) throw new Error(`No fight on ${ev.eventName || `event ${eventId}`} has a fighter matching "${input.fighter.trim()}".`)
  }
  const shown = pool.filter(f => f.state === 'post' || (input.includeLive && f.state === 'in'))
  const skipped = {
    pre: pool.filter(f => f.state === 'pre').length,
    live: input.includeLive ? 0 : pool.filter(f => f.state === 'in').length,
  }
  return formatEventFightStats(ev, shown, skipped)
}
