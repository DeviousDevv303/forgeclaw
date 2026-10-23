// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { createSign, createVerify, generateKeyPairSync, verify as nodeVerify, webcrypto } from 'node:crypto'

// jsdom's WebCrypto has no Ed25519; a current browser's does. Sign with Node's WebCrypto,
// which implements the same algorithms the module targets in production.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
import { describe, expect, it } from 'vitest'
import {
  KalshiAuthError,
  effectiveKalshiRelayUrl,
  kalshiBaseUrl,
  loadKalshiCredentials,
  loadKalshiEnv,
  loadKalshiRelayUrl,
  saveKalshiCredentials,
  saveKalshiEnv,
  saveKalshiRelayUrl,
  signKalshiRequest,
  wrapPkcs1ToPkcs8,
  type KalshiCredentials,
} from './kalshiAuth'

const TS = 1_763_600_000_000
const PATH = '/trade-api/v2/portfolio/balance'

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function edCreds(): { creds: KalshiCredentials; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { creds: { keyId: 'key-ed', privateKeyPem: privatePem, env: 'demo' }, publicPem }
}

describe('signKalshiRequest — Ed25519 (PKCS#8, as Kalshi issues today)', () => {
  it('produces a signature the public key verifies over timestamp+METHOD+path', async () => {
    const { creds, publicPem } = edCreds()
    const headers = await signKalshiRequest(creds, 'get', PATH, TS)
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key-ed')
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toBe(String(TS))
    const sig = b64ToBytes(headers['KALSHI-ACCESS-SIGNATURE'])
    expect(nodeVerify(null, Buffer.from(`${TS}GET${PATH}`), publicPem, Buffer.from(sig))).toBe(true)
  })

  it('signs a different string when the method or path changes', async () => {
    const { creds, publicPem } = edCreds()
    const headers = await signKalshiRequest(creds, 'POST', '/trade-api/v2/portfolio/events/orders', TS)
    const sig = Buffer.from(b64ToBytes(headers['KALSHI-ACCESS-SIGNATURE']))
    expect(nodeVerify(null, Buffer.from(`${TS}GET${PATH}`), publicPem, sig)).toBe(false)
    expect(nodeVerify(null, Buffer.from(`${TS}POST/trade-api/v2/portfolio/events/orders`), publicPem, sig)).toBe(true)
  })

  it('accepts a PEM pasted into a single-line password field (newlines stripped by the input)', async () => {
    const { creds, publicPem } = edCreds()
    const flattened: KalshiCredentials = { ...creds, privateKeyPem: creds.privateKeyPem.replace(/\n/g, '') }
    const headers = await signKalshiRequest(flattened, 'GET', PATH, TS)
    const sig = b64ToBytes(headers['KALSHI-ACCESS-SIGNATURE'])
    expect(nodeVerify(null, Buffer.from(`${TS}GET${PATH}`), publicPem, Buffer.from(sig))).toBe(true)
  })

  it('refuses a path carrying a query string (Kalshi would reject the signature)', async () => {
    const { creds } = edCreds()
    await expect(signKalshiRequest(creds, 'GET', `${PATH}?subaccount=0`, TS)).rejects.toBeInstanceOf(KalshiAuthError)
  })
})

describe('signKalshiRequest — RSA keys from Kalshi (PKCS#1 PEM)', () => {
  function rsaCreds(): { creds: KalshiCredentials; publicPem: string; pkcs1Pem: string } {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pkcs1Pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    return { creds: { keyId: 'key-rsa', privateKeyPem: pkcs1Pem, env: 'prod' }, publicPem, pkcs1Pem }
  }

  it('wraps PKCS#1 to PKCS#8 and the signature verifies as RSA-PSS/SHA-256/salt 32', async () => {
    const { creds, publicPem } = rsaCreds()
    const headers = await signKalshiRequest(creds, 'POST', '/trade-api/v2/portfolio/events/orders', TS)
    const verify = createVerify('RSA-SHA256')
    verify.update(`${TS}POST/trade-api/v2/portfolio/events/orders`)
    const ok = verify.verify(
      { key: publicPem, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 },
      b64ToBytes(headers['KALSHI-ACCESS-SIGNATURE']),
    )
    expect(ok).toBe(true)
  })

  it('wrapPkcs1ToPkcs8 output signs identically to the original key (node cross-check)', () => {
    const { pkcs1Pem } = rsaCreds()
    const body = pkcs1Pem.replace(/-----.*?-----/g, '').replace(/\s+/g, '')
    const wrapped = wrapPkcs1ToPkcs8(new Uint8Array(Buffer.from(body, 'base64')))
    const sign = createSign('RSA-SHA256')
    sign.update('probe')
    // Node accepts the wrapped DER as a PKCS#8 private key.
    const sig = sign.sign({ key: Buffer.from(wrapped), format: 'der', type: 'pkcs8', padding: 6, saltLength: 32 })
    expect(sig.length).toBe(256)
  })
})

describe('credential storage', () => {
  it('round-trips and reports null until both halves exist', () => {
    localStorage.clear()
    expect(loadKalshiCredentials()).toBeNull()
    saveKalshiCredentials('only-the-id', '')
    expect(loadKalshiCredentials()).toBeNull()
    saveKalshiCredentials('the-id', 'the-key')
    expect(loadKalshiCredentials()).toEqual({ keyId: 'the-id', privateKeyPem: 'the-key', env: 'demo' })
  })

  it('defaults to the demo environment until the owner switches it', () => {
    localStorage.clear()
    expect(loadKalshiEnv()).toBe('demo')
    expect(kalshiBaseUrl('demo')).toContain('demo')
    saveKalshiEnv('prod')
    expect(loadKalshiEnv()).toBe('prod')
    expect(kalshiBaseUrl('prod')).toBe('https://external-api.kalshi.com/trade-api/v2')
    saveKalshiEnv('demo')
  })

  it('a garbage key is a named auth error, never a silent failure', async () => {
    const creds: KalshiCredentials = { keyId: 'x', privateKeyPem: 'not a key at all', env: 'demo' }
    await expect(signKalshiRequest(creds, 'GET', PATH, TS)).rejects.toBeInstanceOf(KalshiAuthError)
    await expect(signKalshiRequest(creds, 'GET', PATH, TS)).rejects.toThrow(/not a PEM key/)
  })
})

describe('relay URL storage and resolution', () => {
  it('round-trips, normalized: whitespace and trailing slashes never survive', () => {
    localStorage.clear()
    expect(loadKalshiRelayUrl()).toBe('')
    saveKalshiRelayUrl('  https://forgeclaw-relay.example.workers.dev// ')
    expect(loadKalshiRelayUrl()).toBe('https://forgeclaw-relay.example.workers.dev')
    saveKalshiRelayUrl('')
    expect(loadKalshiRelayUrl()).toBe('')
  })

  it('precedence: explicit beats saved, saved beats the build default (empty in tests)', () => {
    localStorage.clear()
    expect(effectiveKalshiRelayUrl()).toBe('') // no explicit, no saved, PUBLIC_RELAY_URL unset here
    saveKalshiRelayUrl('https://saved.example')
    expect(effectiveKalshiRelayUrl()).toBe('https://saved.example')
    expect(effectiveKalshiRelayUrl('https://explicit.example/')).toBe('https://explicit.example')
    // An explicit '' is a real value (the order path's "fallback disabled"), not "unset".
    expect(effectiveKalshiRelayUrl('')).toBe('')
    localStorage.clear()
  })
})
