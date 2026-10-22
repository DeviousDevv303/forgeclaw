import { describe, expect, it } from 'vitest'
import {
  KALSHI_DISCLAIMER, buildMarketsUrl, formatOrderbook, parseDollars, parseOrderbook, runKalshiMarkets, runKalshiOrderbook,
  selectMarkets, type KalshiMarket,
} from './kalshiMarkets'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const mk = (over: Partial<KalshiMarket>): KalshiMarket => ({
  ticker: 'KX-A', title: 'Will A happen?', status: 'active', close_time: '2026-10-23T12:00:00Z',
  yes_bid_dollars: '0.9000', yes_ask_dollars: '0.9200', no_ask_dollars: '0.1100', last_price_dollars: '0.9100',
  volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00', ...over,
})
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

describe('parseDollars', () => {
  it('reads fixed-point dollar strings and rejects junk or out-of-range values', () => {
    expect(parseDollars('0.9500')).toBe(0.95)
    expect(parseDollars('')).toBe(0)
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('1.5')).toBeNull()
    expect(parseDollars(undefined)).toBeNull()
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
