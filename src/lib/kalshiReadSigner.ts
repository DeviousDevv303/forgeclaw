// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Signs the read-only market calls (kalshi_markets, funds_settle) with the owner's Kalshi key.
 *
 * 2026-10-23/24: every anonymous read the app made came back HTTP 429 for a day while a signed one
 * (funds_status, the balance read) in the same run succeeded. A browser cannot call Kalshi directly
 * (Kalshi answers any request carrying a github.io Origin with 403), so every in-app read rides the
 * owner's relay, and anonymous reads are limited per caller address. Signed reads are limited per account.
 * Whether signing is what clears the 429s is the owner's to confirm on a real run; this module only makes
 * the signed read possible and honest.
 *
 * What it will not do:
 * - sign for a public visitor (a visitor has no key; the owner's key never serves anyone else);
 * - sign a read against the production API with a demo key (it would only draw a 401);
 * - ever hand the private key to anything: the key is used here, by WebCrypto, in this browser. The relay
 *   and Kalshi see only the key ID, the timestamp and the signature, exactly as for the balance read.
 */

import { loadKalshiCredentials, signKalshiRequest, type KalshiCredentials } from './kalshiAuth'

export type KalshiReadSigner = (path: string) => Promise<Record<string, string>>

/**
 * The signer for this run, or undefined when this run must read anonymously: a public visitor, no key pair
 * saved in this browser, or a key saved for the demo environment (the reads go to production).
 * `credentials` is injectable for tests; production callers pass nothing and the Settings pair is read.
 */
export function kalshiReadSigner(visitor: boolean, credentials: KalshiCredentials | null = loadKalshiCredentials()): KalshiReadSigner | undefined {
  if (visitor || !credentials || credentials.env !== 'prod') return undefined
  return async path => ({ ...(await signKalshiRequest(credentials, 'GET', path)) })
}
