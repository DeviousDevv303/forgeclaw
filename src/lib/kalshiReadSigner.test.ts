// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { generateKeyPairSync, verify as nodeVerify, webcrypto } from 'node:crypto'

// jsdom's WebCrypto has no Ed25519; Node's implements the algorithms the module targets in production.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getErrorLog, clearErrorLog } from './errorLog'
import { executeTool } from './forgeTools'
import {
  KALSHI_RELAY_URL_STORAGE, saveKalshiCredentials, saveKalshiEnv, type KalshiCredentials,
} from './kalshiAuth'
import { readKalshiBalanceBlock, type KalshiBalanceSnapshot, type KalshiBalanceSnapshotStore } from './kalshiBalanceDisplay'
import {
  KALSHI_429_RETRY_DELAYS_MS, KALSHI_SIGNED_READ_COOLDOWN_MS, describeSignedReadsPause, fetchKalshiMarket, lastKalshiReadInfo, resetKalshiReadSpacing, runKalshiMarkets, runKalshiOrderbook,
  type KalshiMarket,
} from './kalshiMarkets'
import { KalshiNetworkError, type KalshiBalance, type KalshiClient } from './kalshiTrade'
import { kalshiReadSigner } from './kalshiReadSigner'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const market: KalshiMarket = {
  ticker: 'KXUFCFIGHT-26OCT24A-A1', title: 'Will A win?', status: 'active', close_time: '2026-10-26T16:00:00Z',
  yes_bid_dollars: '0.5000', yes_ask_dollars: '0.5200', no_ask_dollars: '0.5100', last_price_dollars: '0.5100',
  volume_fp: '5000.00', volume_24h_fp: '100.00', open_interest_fp: '2500.00',
}
const reply = (status: number, body: unknown = { markets: [market] }) =>
  ({ ok: status < 400, status, headers: new Headers(), json: async () => body }) as unknown as Response

function fixture(env: 'prod' | 'demo' = 'prod'): { creds: KalshiCredentials; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    creds: { keyId: 'fixture-key-id', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), env },
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

/** Is `headers` a signature the public key verifies over timestamp + GET + the path (no query)? */
function verifiesOver(headers: Record<string, string>, path: string, publicPem: string): boolean {
  const signature = Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64')
  return nodeVerify(null, Buffer.from(`${headers['KALSHI-ACCESS-TIMESTAMP']}GET${path}`), publicPem, signature)
}

const fakeTime = () => {
  let t = 1_000_000
  const waits: number[] = []
  return { waits, advance: (ms: number) => { t += ms }, clock: () => t, delay: async (ms: number) => { waits.push(ms); t += ms } }
}

beforeEach(() => { localStorage.clear(); resetKalshiReadSpacing(); clearErrorLog() })
afterEach(() => { vi.unstubAllGlobals() })

describe('kalshiReadSigner — who gets a signed read', () => {
  it('a public visitor is never signed, even if this browser somehow holds a key', () => {
    expect(kalshiReadSigner(true, fixture().creds)).toBeUndefined()
  })

  it('no saved key pair: anonymous', () => {
    expect(kalshiReadSigner(false, null)).toBeUndefined()
  })

  it('a demo key is not used against the production API the reads go to', () => {
    expect(kalshiReadSigner(false, fixture('demo').creds)).toBeUndefined()
  })

  it('a production key signs GET over timestamp+GET+path, and the signature verifies against the public key', async () => {
    const { creds, publicPem } = fixture()
    const sign = kalshiReadSigner(false, creds)!
    const headers = await sign('/trade-api/v2/markets')
    expect(headers['KALSHI-ACCESS-KEY']).toBe('fixture-key-id')
    expect(verifiesOver(headers, '/trade-api/v2/markets', publicPem)).toBe(true)
    expect(verifiesOver(headers, '/trade-api/v2/portfolio/balance', publicPem)).toBe(false)
    expect(JSON.stringify(headers)).not.toContain('PRIVATE KEY')
  })

  it('reads the pair saved in Settings by default', () => {
    expect(kalshiReadSigner(false)).toBeUndefined()
    const { creds } = fixture()
    saveKalshiCredentials(creds.keyId, creds.privateKeyPem)
    saveKalshiEnv('prod')
    expect(kalshiReadSigner(false)).toBeDefined()
    expect(kalshiReadSigner(true)).toBeUndefined()
    saveKalshiEnv('demo')
    expect(kalshiReadSigner(false)).toBeUndefined()
  })
})

describe('signed market reads', () => {
  it('the request carries the owner’s signature over the path WITHOUT its query, and lastKalshiReadInfo says it was signed', async () => {
    const { creds, publicPem } = fixture()
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const out = await runKalshiMarkets({ series_ticker: 'KXUFCFIGHT', limit: 30 }, {
      fetcher: async (url, init) => { seen.push({ url, headers: init?.headers as Record<string, string> }); return reply(200) },
      sign: kalshiReadSigner(false, creds), now: () => NOW, snapshots: null,
    })
    expect(out).toContain('KXUFCFIGHT-26OCT24A-A1')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toContain('/markets?')
    expect(seen[0].url).toContain('series_ticker=KXUFCFIGHT')
    expect(seen[0].headers.Accept).toBe('application/json')
    expect(verifiesOver(seen[0].headers, '/trade-api/v2/markets', publicPem)).toBe(true)
    expect(lastKalshiReadInfo()).toMatchObject({ status: 200, path: '/markets', signed: true })
  })

  it('without a signer the read is anonymous: no KALSHI-ACCESS headers, signed:false', async () => {
    const seen: Array<Record<string, string>> = []
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async (_u, init) => { seen.push(init?.headers as Record<string, string>); return reply(200) }, now: () => NOW, snapshots: null })
    expect(Object.keys(seen[0]).filter(k => k.startsWith('KALSHI-'))).toEqual([])
    expect(lastKalshiReadInfo()).toMatchObject({ signed: false })
  })

  it('the order book and a single-market read sign their own paths', async () => {
    const { creds, publicPem } = fixture()
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const deps = {
      fetcher: async (url: string, init?: RequestInit) => { seen.push({ url, headers: init?.headers as Record<string, string> }); return url.includes('/orderbook') ? reply(200, { orderbook_fp: { yes_dollars: [['0.5000', '10.00']], no_dollars: [] } }) : reply(200) },
      sign: kalshiReadSigner(false, creds), now: () => NOW, snapshots: null,
    }
    await runKalshiOrderbook(market.ticker, deps)
    await fetchKalshiMarket(market.ticker, deps)
    expect(verifiesOver(seen[0].headers, `/trade-api/v2/markets/${market.ticker}/orderbook`, publicPem)).toBe(true)
    expect(verifiesOver(seen[1].headers, '/trade-api/v2/markets', publicPem)).toBe(true)
  })

  it('every retry is signed again with a fresh timestamp, and a signed 429 is retried signed', async () => {
    const time = fakeTime()
    let stamp = 0
    const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': String(++stamp), 'KALSHI-ACCESS-SIGNATURE': 's' })
    const replies = [reply(429), reply(429), reply(200)]
    const seen: Array<Record<string, string>> = []
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async (_u, init) => { seen.push(init?.headers as Record<string, string>); return replies.shift()! }, sign, now: () => NOW, snapshots: null, ...time })
    expect(seen.map(h => h['KALSHI-ACCESS-TIMESTAMP'])).toEqual(['1', '2', '3'])
    expect(time.waits).toEqual([...KALSHI_429_RETRY_DELAYS_MS])
  })

  it('a rate-limited signed read is NOT repeated anonymously (that would be the worse budget)', async () => {
    const time = fakeTime()
    const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
    let signedCalls = 0
    let anonymousCalls = 0
    const err = await runKalshiMarkets({ ticker: market.ticker }, {
      fetcher: async (_u, init) => { if ((init?.headers as Record<string, string>)['KALSHI-ACCESS-KEY']) signedCalls++; else anonymousCalls++; return reply(429) },
      sign, now: () => NOW, snapshots: null, ...time,
    }).catch(e => e)
    expect(err.message).toMatch(/rate-limited this read: HTTP 429/)
    expect([signedCalls, anonymousCalls]).toEqual([1 + KALSHI_429_RETRY_DELAYS_MS.length, 0])
  })

  for (const refused of [401, 403]) {
    it(`a signed read Kalshi refuses with ${refused} is repeated once without the signature, and that does not spend a rate-limit retry`, async () => {
      const time = fakeTime()
      const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
      const replies = [reply(refused), reply(200)]
      const seen: Array<Record<string, string>> = []
      const out = await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async (_u, init) => { seen.push(init?.headers as Record<string, string>); return replies.shift()! }, sign, now: () => NOW, snapshots: null, ...time })
      expect(out).toContain(market.ticker)
      expect(seen.map(h => 'KALSHI-ACCESS-KEY' in h)).toEqual([true, false])
      expect(time.waits.some(ms => KALSHI_429_RETRY_DELAYS_MS.includes(ms as never))).toBe(false)
      expect(lastKalshiReadInfo()).toMatchObject({ status: 200, signed: false })
    })
  }

  it('the anonymous repeat after a refusal leaves the whole rate-limit budget intact (401, then two 429s, then success)', async () => {
    const time = fakeTime()
    const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
    const replies = [reply(401), reply(429), reply(429), reply(200)]
    const out = await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => replies.shift()!, sign, now: () => NOW, snapshots: null, ...time })
    expect(out).toContain(market.ticker)
    expect(time.waits.filter(ms => KALSHI_429_RETRY_DELAYS_MS.includes(ms as never))).toEqual([...KALSHI_429_RETRY_DELAYS_MS])
  })

  it('after a refusal the next reads are anonymous at once (no doubled requests) until the cooldown passes, then signing resumes', async () => {
    const time = fakeTime()
    const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
    const replies = [reply(401), reply(200)]
    const seen: boolean[] = []
    const deps = { fetcher: async (_u: string, init?: RequestInit) => { seen.push('KALSHI-ACCESS-KEY' in (init?.headers as Record<string, string>)); return replies.shift() ?? reply(200) }, sign, now: () => NOW, snapshots: null, ...time }
    await runKalshiMarkets({ ticker: market.ticker }, deps)
    await runKalshiMarkets({ ticker: market.ticker }, deps)
    expect(seen).toEqual([true, false, false])
    time.advance(KALSHI_SIGNED_READ_COOLDOWN_MS)
    await runKalshiMarkets({ ticker: market.ticker }, deps)
    expect(seen).toEqual([true, false, false, true])
  })

  it('an anonymous 403 is a refusal, not a retry: one request and the error', async () => {
    let calls = 0
    const err = await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => { calls++; return reply(403) }, now: () => NOW, snapshots: null, ...fakeTime() }).catch(e => e)
    expect(err.message).toMatch(/Kalshi returned HTTP 403/)
    expect(calls).toBe(1)
  })

  it('a key that cannot sign does not fail the read: it goes anonymously, and the log says why', async () => {
    const seen: Array<Record<string, string>> = []
    const out = await runKalshiMarkets({ ticker: market.ticker }, {
      fetcher: async (_u, init) => { seen.push(init?.headers as Record<string, string>); return reply(200) },
      sign: async () => { throw new Error('Kalshi private key could not be parsed') }, now: () => NOW, snapshots: null, ...fakeTime(),
    })
    expect(out).toContain(market.ticker)
    expect(Object.keys(seen[0]).filter(k => k.startsWith('KALSHI-'))).toEqual([])
    const entry = getErrorLog().find(e => e.source === 'kalshi')!
    expect(entry.message).toContain('signed read skipped')
    expect(entry.details).toContain('could not be parsed')
  })

  it('the failure log says whether the failed read was signed or anonymous (the attribution the 429 hunt lacked)', async () => {
    const sign = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => reply(429), sign, now: () => NOW, snapshots: null, ...fakeTime() }).catch(() => undefined)
    clearErrorLog()
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => reply(429), now: () => NOW, snapshots: null, ...fakeTime() }).catch(() => undefined)
    expect(getErrorLog().filter(e => e.source === 'kalshi').every(e => e.details?.endsWith('· anonymous'))).toBe(true)
  })
})

describe('kalshi_markets tool — signing, end to end through the relay', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({ ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true, ...over }) as never

  /** Direct calls fail like a CORS block; the relay answers. Records the headers each relay request carried. */
  function stubRelay(relayed: Array<Record<string, string>>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('external-api.kalshi.com')) throw new TypeError('Failed to fetch')
      if (String(url) === 'https://relay.example/v1/kalshi') {
        const body = JSON.parse(String(init?.body)) as { headers: Record<string, string> }
        relayed.push(body.headers)
        return Response.json({ status: 200, body: JSON.stringify({ markets: [market] }) })
      }
      throw new Error(`unexpected fetch ${url}`)
    }))
  }

  it('with a production key saved, the relay receives the signature headers and never the private key', async () => {
    const { creds, publicPem } = fixture()
    saveKalshiCredentials(creds.keyId, creds.privateKeyPem)
    saveKalshiEnv('prod')
    localStorage.setItem(KALSHI_RELAY_URL_STORAGE, 'https://relay.example')
    const relayed: Array<Record<string, string>> = []
    stubRelay(relayed)
    const out = await executeTool({ id: '1', name: 'kalshi_markets', input: { series_ticker: 'KXUFCFIGHT', limit: '30' } }, ctx())
    expect(out).toContain('KXUFCFIGHT-26OCT24A-A1')
    expect(relayed).toHaveLength(1)
    expect(verifiesOver(relayed[0], '/trade-api/v2/markets', publicPem)).toBe(true)
    expect(JSON.stringify(relayed)).not.toContain('PRIVATE KEY')
    expect(JSON.stringify(relayed)).not.toContain(creds.privateKeyPem.replace(/\n/g, '').slice(30, 70))
  })

  it('a public visitor’s read is anonymous even when a key is in storage', async () => {
    const { creds } = fixture()
    saveKalshiCredentials(creds.keyId, creds.privateKeyPem)
    saveKalshiEnv('prod')
    localStorage.setItem(KALSHI_RELAY_URL_STORAGE, 'https://relay.example')
    const relayed: Array<Record<string, string>> = []
    stubRelay(relayed)
    await executeTool({ id: '1', name: 'kalshi_markets', input: { ticker: market.ticker } }, ctx({ ghToken: '', publicRelayUrl: 'https://relay.example' }))
    expect(relayed).toHaveLength(1)
    expect(Object.keys(relayed[0]).filter(k => k.startsWith('KALSHI-'))).toEqual([])
  })

  it('with no key saved the read is anonymous, exactly as before', async () => {
    localStorage.setItem(KALSHI_RELAY_URL_STORAGE, 'https://relay.example')
    const relayed: Array<Record<string, string>> = []
    stubRelay(relayed)
    await executeTool({ id: '1', name: 'kalshi_markets', input: { ticker: market.ticker } }, ctx())
    expect(Object.keys(relayed[0]).filter(k => k.startsWith('KALSHI-'))).toEqual([])
  })
})

// Kimi's review note on #278: a refused or unusable key quietly sends every read back to the anonymous budget that was
// already being rate-limited, and the only trace was a warning in a log the owner rarely opens. The pause is now said
// out loud where the account's state is shown (the balance block shared by /funds status, funds_status and the Funds
// panel) and in the 429 message.
describe('a paused signature is visible, not silent', () => {
  const signer = async () => ({ 'KALSHI-ACCESS-KEY': 'k', 'KALSHI-ACCESS-TIMESTAMP': '1', 'KALSHI-ACCESS-SIGNATURE': 's' })
  /** Refuses the first (signed) request with `status`, then answers every later request with `later`. */
  const refuseOnce = (status: number, later: number) => { let n = 0; return async () => (++n === 1 ? reply(status) : reply(later)) }
  const balance: KalshiBalance = { balanceCents: 2500, balanceDollars: 25, portfolioValueCents: 2500, updatedTs: null, breakdown: [] }
  const client = (failure?: Error): KalshiClient => {
    const unused = async (): Promise<never> => { throw new Error('not used') }
    return { getBalance: async () => { if (failure) throw failure; return balance }, createOrder: unused, findOrderByClientOrderId: unused, getSettlements: unused, getMarketQuote: unused }
  }
  const memoryStore = (initial: KalshiBalanceSnapshot | null = null): KalshiBalanceSnapshotStore => {
    let saved = initial
    return { load: () => saved, save: s => { saved = s } }
  }
  /** A refused signed read at fake time 1_000_000, leaving signing paused until 1_000_000 + the cooldown. */
  async function pauseSigning(status = 401) {
    const time = fakeTime()
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: refuseOnce(status, 200), sign: signer, now: () => NOW, snapshots: null, ...time })
    return time.clock()
  }

  it('says nothing before any refusal, and again nothing once the pause has run out', async () => {
    expect(describeSignedReadsPause(1_000_000)).toBeNull()
    const at = await pauseSigning()
    expect(describeSignedReadsPause(at)).toContain('Signed Kalshi reads are paused until')
    expect(describeSignedReadsPause(at + KALSHI_SIGNED_READ_COOLDOWN_MS)).toBeNull()
  })

  it('names the end of the pause in UTC and why: the HTTP status Kalshi answered', async () => {
    const at = await pauseSigning(403)
    const until = new Date(at + KALSHI_SIGNED_READ_COOLDOWN_MS).toISOString().slice(11, 19)
    expect(describeSignedReadsPause(at)).toBe(`Signed Kalshi reads are paused until ${until} UTC (Kalshi answered the signed read with HTTP 403); market reads are going out anonymously and may be rate-limited.`)
  })

  it('a key that cannot sign is named by the auth module’s own message; any other error shows only a generic reason', async () => {
    const { creds } = fixture()
    const unusable = kalshiReadSigner(false, { ...creds, privateKeyPem: 'not a key' })
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => reply(200), sign: unusable, now: () => NOW, snapshots: null, ...fakeTime() })
    expect(describeSignedReadsPause(1_000_000)).toContain('not a PEM key')
    resetKalshiReadSpacing()
    const leaky = async (): Promise<Record<string, string>> => { throw new Error('secret-key-material-0123') }
    await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => reply(200), sign: leaky, now: () => NOW, snapshots: null, ...fakeTime() })
    const note = describeSignedReadsPause(1_000_000)!
    expect(note).toContain('the saved key could not sign')
    expect(note).not.toContain('secret-key-material')
  })

  it('the shared balance block carries the line on every path: live, stale snapshot and unreadable', async () => {
    const at = await pauseSigning()
    const note = describeSignedReadsPause(at)!
    expect(await readKalshiBalanceBlock(client(), { env: 'prod', now: () => at, store: memoryStore() })).toContain(note)
    const snapshot: KalshiBalanceSnapshot = { balance, fetchedAt: at - 60_000, env: 'prod' }
    const stale = await readKalshiBalanceBlock(client(new KalshiNetworkError('offline')), { env: 'prod', now: () => at, store: memoryStore(snapshot) })
    expect(stale).toContain('STALE')
    expect(stale).toContain(note)
    const unreadable = await readKalshiBalanceBlock(client(new KalshiNetworkError('offline')), { env: 'prod', now: () => at, store: memoryStore() })
    expect(unreadable).toContain('could not be read')
    expect(unreadable).toContain(note)
  })

  it('the balance block is unchanged while signing is not paused', async () => {
    const block = await readKalshiBalanceBlock(client(), { env: 'prod', now: () => 1_000_000, store: memoryStore() })
    expect(block).not.toContain('paused')
  })

  it('a 429 that follows a refused key says the read was anonymous because signing is paused', async () => {
    const time = fakeTime()
    let n = 0
    const err = await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => (++n === 1 ? reply(401) : reply(429)), sign: signer, now: () => NOW, snapshots: null, ...time }).catch(e => e)
    expect(err.message).toMatch(/rate-limited this read: HTTP 429/)
    expect(err.message).toContain('kalshi_owner_prices')
    expect(err.message).toContain('Signed Kalshi reads are paused until')
    expect(err.message).toContain('HTTP 401')
  })

  it('an owner with no key (no signer) never sees the pause line in a 429', async () => {
    const err = await runKalshiMarkets({ ticker: market.ticker }, { fetcher: async () => reply(429), now: () => NOW, snapshots: null, ...fakeTime() }).catch(e => e)
    expect(err.message).toMatch(/rate-limited this read/)
    expect(err.message).not.toContain('paused')
  })
})
