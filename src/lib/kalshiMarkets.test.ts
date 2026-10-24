import { describe, expect, it } from 'vitest'
import {
  KALSHI_MAX_RESULTS, KALSHI_DISCLAIMER, KalshiError, buildMarketsUrl, fetchKalshiMarket, formatMarket, formatOrderbook, parseDollars, parseExchangeIndex, parseOrderbook, runKalshiMarkets, runKalshiOrderbook,
  selectMarkets, type KalshiMarket, KALSHI_429_RETRY_DELAYS_MS, KALSHI_PUBLIC_READ_INTERVAL_MS, resetKalshiReadSpacing,
} from './kalshiMarkets'
import { relayFallbackFetcher } from './kalshiTrade'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const mk = (over: Partial<KalshiMarket>): KalshiMarket => ({
  ticker: 'KX-A', title: 'Will A happen?', status: 'active', close_time: '2026-10-23T12:00:00Z',
  yes_bid_dollars: '0.9000', yes_ask_dollars: '0.9200', no_ask_dollars: '0.1100', last_price_dollars: '0.9100',
  volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00', ...over,
})
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

describe('formatMarket shard', () => {
  it('prints the exchange shard Kalshi reports, so an order can be matched to the shard that must hold the funds', () => {
    expect(formatMarket(mk({ exchange_index: 3 }), NOW)).toContain('status active; shard 3; closes')
    expect(formatMarket(mk({ exchange_index: 0 }), NOW)).toContain('shard 0;')
  })
  it('says n/a when the record omits or garbles it — never a guessed shard 0', () => {
    expect(formatMarket(mk({}), NOW)).toContain('shard n/a;')
    expect(formatMarket(mk({ exchange_index: -1 }), NOW)).toContain('shard n/a;')
    expect(formatMarket(mk({ exchange_index: '2' as unknown as number }), NOW)).toContain('shard n/a;')
  })
})

describe('parseDollars', () => {
  it('reads fixed-point dollar strings and rejects junk or out-of-range values', () => {
    expect(parseDollars('0.9500')).toBe(0.95)
    expect(parseDollars('')).toBe(0)
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('1.5')).toBeNull()
    expect(parseDollars(undefined)).toBeNull()
  })
})

describe('parseExchangeIndex', () => {
  it('reads the shard Kalshi reports and defaults everything else to shard 0', () => {
    expect(parseExchangeIndex(3)).toBe(3)
    expect(parseExchangeIndex('2')).toBe(2)
    expect(parseExchangeIndex(0)).toBe(0)
    expect(parseExchangeIndex(undefined)).toBe(0)
    expect(parseExchangeIndex(null)).toBe(0)
    expect(parseExchangeIndex(-1)).toBe(0)
    expect(parseExchangeIndex(2.5)).toBe(0)
    expect(parseExchangeIndex('x')).toBe(0)
  })
})

describe('fetchKalshiMarket', () => {
  it('carries the market record’s exchange_index through untouched', async () => {
    const market = await fetchKalshiMarket('KX-A', { fetcher: async () => json({ markets: [mk({ exchange_index: 3 })] }) })
    expect(market?.ticker).toBe('KX-A')
    expect(market?.exchange_index).toBe(3)
  })
})

describe('selectMarkets', () => {
  const markets = [
    mk({ ticker: 'KX-LOW', title: 'Low volume', volume_24h_fp: '5' }),
    mk({ ticker: 'KX-HIGH', title: 'Kashima wins Saturday', volume_24h_fp: '900' }),
    mk({ ticker: 'KX-FAR', title: 'Far away', close_time: '2027-01-01T00:00:00Z', volume_24h_fp: '50' }),
    mk({ ticker: 'KX-CHEAP', title: 'Cheap yes', yes_ask_dollars: '0.10', volume_24h_fp: '70' }),
  ]
  it('sorts by 24h volume', () => {
    expect(selectMarkets(markets, {}, NOW).map(m => m.ticker)).toEqual(['KX-HIGH', 'KX-CHEAP', 'KX-FAR', 'KX-LOW'])
  })
  it('requires every query word, case-insensitively', () => {
    expect(selectMarkets(markets, { query: 'kashima SATURDAY' }, NOW).map(m => m.ticker)).toEqual(['KX-HIGH'])
    expect(selectMarkets(markets, { query: 'kashima tuesday' }, NOW)).toEqual([])
  })
  it('filters by close window and minimum YES ask', () => {
    expect(selectMarkets(markets, { closes_within_hours: 48 }, NOW).map(m => m.ticker)).not.toContain('KX-FAR')
    expect(selectMarkets(markets, { min_yes_ask: 0.5 }, NOW).map(m => m.ticker)).not.toContain('KX-CHEAP')
  })
  it('drops entries without a ticker', () => {
    expect(selectMarkets([{} as KalshiMarket], {}, NOW)).toEqual([])
  })
})

describe('runKalshiMarkets', () => {
  it('formats prices, implied probability, volume and always carries the disclaimer', async () => {
    const out = await runKalshiMarkets({ query: 'a happen' }, { fetcher: async () => json({ markets: [mk({})] }), now: () => NOW })
    expect(out).toContain('KX-A — Will A happen?')
    expect(out).toContain('bid $0.90 / ask $0.92 (implied 92%)')
    expect(out).toContain('spread $0.02')
    expect(out).toContain('24h 100')
    expect(out).toContain('24h from now')
    expect(out).toContain('untrusted third-party data')
    expect(out).toContain(KALSHI_DISCLAIMER)
  })
  it('follows the cursor up to the page cap and scans every page', async () => {
    const urls: string[] = []
    const fetcher = async (url: string) => {
      urls.push(url)
      return json({ markets: [mk({ ticker: `KX-${urls.length}` })], cursor: 'next' })
    }
    const out = await runKalshiMarkets({}, { fetcher, now: () => NOW })
    expect(urls).toHaveLength(3)
    expect(urls[1]).toContain('cursor=next')
    expect(out).toContain('3 scanned')
  })
  it('looks up one ticker on a single page, regardless of status', async () => {
    const urls: string[] = []
    await runKalshiMarkets({ ticker: 'KX-A' }, { fetcher: async url => { urls.push(url); return json({ markets: [mk({})], cursor: 'x' }) }, now: () => NOW })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('tickers=KX-A')
    expect(urls[0]).not.toContain('status=open')
  })
  it('says nothing matched instead of inventing a market', async () => {
    const out = await runKalshiMarkets({ query: 'zzz' }, { fetcher: async () => json({ markets: [mk({})] }), now: () => NOW })
    expect(out).toContain('No open Kalshi markets matched (1 scanned)')
    expect(out).not.toContain('KX-A —')
  })
  it('turns a blocked or offline fetch into a named error, never an empty list', async () => {
    await expect(runKalshiMarkets({}, { fetcher: async () => { throw new TypeError('Failed to fetch') } })).rejects.toThrow(/could not be reached.*CORS/)
  })
  it('reports HTTP errors and malformed bodies', async () => {
    await expect(runKalshiMarkets({}, { fetcher: async () => json({}, 403) })).rejects.toThrow('HTTP 403')
    await expect(runKalshiMarkets({}, { fetcher: async () => json({ nope: 1 }) })).rejects.toThrow('no "markets" array')
  })
  it('rethrows aborts untouched', async () => {
    const abort = new DOMException('stop', 'AbortError')
    await expect(runKalshiMarkets({}, { fetcher: async () => { throw abort } })).rejects.toBe(abort)
  })
  it('with no relay configured, an unreachable Kalshi names the owner fix, never a bare fetch error', async () => {
    const failure = await runKalshiMarkets({}, { fetcher: async () => { throw new TypeError('Failed to fetch') } }).catch(e => e)
    expect(failure).toBeInstanceOf(KalshiError)
    expect(failure.message).toMatch(/could not be reached/)
    expect(failure.message).toMatch(/no Kalshi relay is configured/)
    expect(failure.message).toMatch(/relay\/README\.md/)
    expect(failure.message).toMatch(/Settings → Kalshi trading → Kalshi relay URL/)
    expect(failure.message).toMatch(/not an empty market list/)
    expect(failure.transportFailure).toBe(true)
    expect(failure.relayMissing).toBe(true)
  })
  it('with a relay configured, an unreachable Kalshi says the relay was tried too', async () => {
    const failure = await runKalshiMarkets({}, {
      fetcher: async () => { throw new TypeError('Failed to fetch') },
      relayUrl: 'https://relay.example',
    }).catch(e => e)
    expect(failure).toBeInstanceOf(KalshiError)
    expect(failure.message).toMatch(/configured relay \(https:\/\/relay\.example\) did not answer either/)
    expect(failure.transportFailure).toBe(true)
    expect(failure.relayMissing).toBe(false)
  })
  it('falls back to the relay on a transport failure and renders the markets', async () => {
    const base = async (): Promise<Response> => { throw new TypeError('Failed to fetch') }
    // The real relay answers with the {status, body} envelope; emulate its wire shape.
    const wireRelay = async (url: string, init?: RequestInit): Promise<Response> => {
      expect(url).toBe('https://relay.example/v1/kalshi')
      expect(JSON.parse(String(init?.body)).url).toContain('/trade-api/v2/markets')
      return new Response(JSON.stringify({ status: 200, body: JSON.stringify({ markets: [mk({})] }) }), { status: 200 })
    }
    const fetcher = relayFallbackFetcher(base, 'https://relay.example', wireRelay)
    const out = await runKalshiMarkets({ query: 'a happen' }, { fetcher, relayUrl: 'https://relay.example', now: () => NOW })
    expect(out).toContain('KX-A — Will A happen?')
    expect(out).toContain('implied 92%')
  })
})

describe('buildMarketsUrl', () => {
  it('scopes to open markets and passes event/series filters', () => {
    const url = buildMarketsUrl({ event_ticker: 'EV', series_ticker: 'SR' })
    expect(url).toContain('status=open')
    expect(url).toContain('event_ticker=EV')
    expect(url).toContain('series_ticker=SR')
  })
})

describe('orderbook', () => {
  const data = { orderbook_fp: { yes_dollars: [['0.8800', '10.00'], ['0.9000', '250.00']], no_dollars: [['0.0900', '40.00'], ['bad', '1']] } }
  it('sorts bids best-first and drops malformed rows', () => {
    const book = parseOrderbook(data)!
    expect(book.yes[0]).toEqual([0.9, 250])
    expect(book.no).toEqual([[0.09, 40]])
  })
  it('formats depth and explains that the book holds bids only', async () => {
    expect(formatOrderbook('KX-A', parseOrderbook(data)!)).toContain('YES bids (best first): $0.90 x250, $0.88 x10; total 260 contracts')
    const out = await runKalshiOrderbook('KX-A', { fetcher: async () => json(data) })
    expect(out).toContain('bids only')
  })
  it('rejects tickers that could alter the URL, and responses without a book', async () => {
    await expect(runKalshiOrderbook('../x?y=1', { fetcher: async () => json(data) })).rejects.toThrow('Invalid Kalshi ticker')
    await expect(runKalshiOrderbook('KX-A', { fetcher: async () => json({}) })).rejects.toThrow('orderbook_fp')
  })
})

// 2026-10-23: three kalshi_markets series lookups in one answer (KXHIGHNY, KXHIGHMIA, KXHIGHLAX) all came back
// HTTP 429. Public reads are spaced and a 429 is retried with backoff before it becomes an error.
describe('rate limits on public market reads', () => {
  const limited = (headers: Record<string, string> = {}) => ({ ok: false, status: 429, headers: new Headers(headers), json: async () => ({}) }) as unknown as Response
  const fakeTime = () => {
    let t = 1_000_000
    const waits: number[] = []
    return { waits, clock: () => t, delay: async (ms: number) => { waits.push(ms); t += ms } }
  }

  it('a 429 is retried after a spaced wait and the markets render', async () => {
    resetKalshiReadSpacing()
    const time = fakeTime()
    const replies = [limited(), json({ markets: [mk({})] })]
    const out = await runKalshiMarkets({ ticker: 'KX-A' }, { fetcher: async () => replies.shift()!, now: () => NOW, ...time })
    expect(out).toContain('KX-A — Will A happen?')
    expect(time.waits).toEqual([KALSHI_429_RETRY_DELAYS_MS[0]])
  })

  it('still limited after every retry: an error that says so, never an empty list', async () => {
    resetKalshiReadSpacing()
    const time = fakeTime()
    let calls = 0
    const err = await runKalshiMarkets({ series_ticker: 'KXHIGHNY' }, { fetcher: async () => { calls++; return limited() }, now: () => NOW, ...time }).catch(e => e)
    expect(err).toBeInstanceOf(KalshiError)
    expect(err.message).toMatch(/rate-limited this read: HTTP 429 on \/markets after 2 spaced retries · Retry-After: none · not an empty market list\./)
    expect(err.message).toContain('Do not repeat this call in this run')
    expect(err.message).toContain('kalshi_owner_prices')
    expect(calls).toBe(1 + KALSHI_429_RETRY_DELAYS_MS.length)
    expect(time.waits).toEqual([...KALSHI_429_RETRY_DELAYS_MS])
  })

  it('honours Retry-After, capped at 5 s', async () => {
    resetKalshiReadSpacing()
    const time = fakeTime()
    const replies = [limited({ 'Retry-After': '2' }), limited({ 'Retry-After': '60' }), json({ markets: [mk({})] })]
    await runKalshiMarkets({ ticker: 'KX-A' }, { fetcher: async () => replies.shift()!, now: () => NOW, ...time })
    expect(time.waits).toEqual([2000, 5000])
  })

  it('back-to-back reads are spaced, across separate calls', async () => {
    resetKalshiReadSpacing()
    const time = fakeTime()
    const deps = { fetcher: async () => json({ markets: [mk({})] }), now: () => NOW, ...time }
    for (const series of ['KXHIGHNY', 'KXHIGHMIA', 'KXHIGHLAX']) await runKalshiMarkets({ series_ticker: series }, deps)
    expect(time.waits).toEqual([KALSHI_PUBLIC_READ_INTERVAL_MS, KALSHI_PUBLIC_READ_INTERVAL_MS])
  })

  it('an abort during the wait stops the read', async () => {
    resetKalshiReadSpacing()
    const controller = new AbortController()
    const replies = [limited()]
    const pending = runKalshiMarkets({ ticker: 'KX-A' }, { fetcher: async () => replies.shift() ?? json({ markets: [] }), now: () => NOW, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// Stage 2 (2026-10-23): listings prefer the server-side snapshot the loop commits to the
// kalshi-snapshot-data branch, so the browser stops spending its per-IP Kalshi quota on
// reads a server can make once. Every miss — stale, malformed, out of scope — must fall
// back to the live read with its behavior unchanged.
describe('server snapshot preference (Stage 2)', () => {
  const snapMarketDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ticker: 'KX-A', event_ticker: 'KX-EV', series_ticker: 'KX-S', title: 'Will A happen?', yes_sub_title: 'A',
    yes_bid: 0.9, yes_ask: 0.92, no_bid: 0.08, no_ask: 0.11, last_price: 0.91,
    volume: 5000, open_interest: 2500, status: 'active', close_time: '2026-10-23T12:00:00Z', ...over,
  })
  const snapDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    fetched_at: new Date(NOW - 5 * 60_000).toISOString(), source: 'kalshi-public-api', http_status: 200,
    error: null, markets: [snapMarketDoc()], ...over,
  })
  const sourceOf = (raw: unknown) => ({ load: async () => raw })
  const liveDeps = () => {
    let calls = 0
    return { calls: () => calls, fetcher: async () => { calls++; return json({ markets: [mk({})] }) } }
  }

  it('a fresh snapshot covering the query answers without a live read, labelled as a snapshot', async () => {
    const live = liveDeps()
    const out = await runKalshiMarkets({ series_ticker: 'KX-S' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(snapDoc()) })
    expect(live.calls()).toBe(0)
    expect(out).toContain('SNAPSHOT — prices from the server-side snapshot')
    expect(out).toContain('not a live read')
    expect(out).toContain('KX-A — Will A happen?')
    expect(out).toContain('bid $0.90 / ask $0.92 (implied 92%)')
  })

  it('a stale snapshot changes nothing: the live read runs and its output carries no snapshot header', async () => {
    const live = liveDeps()
    const stale = snapDoc({ fetched_at: new Date(NOW - 16 * 60_000).toISOString() })
    const out = await runKalshiMarkets({ series_ticker: 'KX-S' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(stale) })
    expect(live.calls()).toBe(1)
    expect(out).not.toContain('SNAPSHOT —')
    expect(out).toContain('KX-A — Will A happen?')
  })

  it('a per-call age limit can still admit that snapshot — the threshold is the caller’s, not a law', async () => {
    const live = liveDeps()
    const twentyMin = snapDoc({ fetched_at: new Date(NOW - 20 * 60_000).toISOString() })
    const out = await runKalshiMarkets({ series_ticker: 'KX-S' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(twentyMin), maxServerSnapshotAgeMs: 30 * 60_000 })
    expect(live.calls()).toBe(0)
    expect(out).toContain('SNAPSHOT —')
  })

  it('a malformed snapshot document falls back to the live read', async () => {
    const live = liveDeps()
    const drifted = snapDoc({ markets: [snapMarketDoc({ yes_ask: '0.92' })] })
    const out = await runKalshiMarkets({ series_ticker: 'KX-S' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(drifted) })
    expect(live.calls()).toBe(1)
    expect(out).not.toContain('SNAPSHOT —')
  })

  it('a snapshot that does not cover the queried series falls back to the live read', async () => {
    const live = liveDeps()
    const out = await runKalshiMarkets({ series_ticker: 'KX-OTHER' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(snapDoc()) })
    expect(live.calls()).toBe(1)
    expect(out).not.toContain('SNAPSHOT —')
  })

  it('when the snapshot covers the scope but the caller’s filters match nothing it holds, the live read decides — a partial snapshot never reports an empty listing', async () => {
    const live = liveDeps()
    const out = await runKalshiMarkets({ series_ticker: 'KX-S', query: 'zzz' }, { ...live, now: () => NOW, serverSnapshot: sourceOf(snapDoc()) })
    expect(live.calls()).toBe(1)
    expect(out).not.toContain('SNAPSHOT —')
  })

  it('an unscoped listing never consults the snapshot at all', async () => {
    const live = liveDeps()
    let loads = 0
    const source = { load: async () => { loads++; return snapDoc() } }
    await runKalshiMarkets({ query: 'a happen' }, { ...live, now: () => NOW, serverSnapshot: source })
    expect(loads).toBe(0)
    expect(live.calls()).toBe(1)
  })

  it('serverSnapshot: null disables the preference; the live read runs exactly as before', async () => {
    const live = liveDeps()
    const out = await runKalshiMarkets({ series_ticker: 'KX-S' }, { ...live, now: () => NOW, serverSnapshot: null })
    expect(live.calls()).toBe(1)
    expect(out).not.toContain('SNAPSHOT —')
  })
})

// 2026-10-24: a UFC card is 14 fights x 2 markets = 28 (series KXUFCFIGHT, one request, no paging). With the old cap of 15 the
// card needed several calls, and the repeats were what rate-limited the 2026-10-23 research run.
describe('a whole fight card in one read', () => {
  it('shows all 28 markets of a 14-fight card when the model asks for the cap, in one HTTP request', async () => {
    const fights = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']
    const markets = fights.flatMap((f, i) => [`${f}1`, `${f}2`].map(side => mk({
      ticker: `KXUFCFIGHT-26OCT24${f}-${side}`, event_ticker: `KXUFCFIGHT-26OCT24${f}`, title: `Fighter ${side} wins`,
      close_time: '2026-10-26T16:00:00Z', volume_24h_fp: String(1000 - i), exchange_index: 0,
    })))
    let requests = 0
    const out = await runKalshiMarkets({ series_ticker: 'KXUFCFIGHT', limit: KALSHI_MAX_RESULTS }, { fetcher: async () => { requests++; return json({ markets }) }, now: () => NOW })
    expect(requests).toBe(1)
    expect(KALSHI_MAX_RESULTS).toBeGreaterThanOrEqual(28)
    expect(out).toContain('(28 of 28 matched')
    expect((out.match(/^KXUFCFIGHT-/gm) ?? []).length).toBe(28)
  })

  it('a time-window filter hides the card, because the markets close days after the fight (why the playbook forbids it)', async () => {
    const m = mk({ ticker: 'KXUFCFIGHT-26OCT24A-A1', event_ticker: 'KXUFCFIGHT-26OCT24A', close_time: '2026-10-26T16:00:00Z' })
    const out = await runKalshiMarkets({ series_ticker: 'KXUFCFIGHT', closes_within_hours: 12 }, { fetcher: async () => json({ markets: [m] }), now: () => Date.parse('2026-10-24T01:00:00Z') })
    expect(out).toMatch(/^No open Kalshi markets matched/)
  })
})
