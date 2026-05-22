// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { callProvider } from '../modelProviders'
import type { ProviderId } from '../modelProviders'
import { classifyProviderError } from './providerStatus'
import type { ProviderStatus } from './providerStatus'

// Passive ping every 15 minutes. If the user had a successful response within
// GRACE_MS we skip the network call — ForgeMind's own calls are the heartbeat.
export const HEARTBEAT_INTERVAL_MS = 15 * 60_000
export const ONLINE_GRACE_MS       = 15 * 60_000

export interface HeartbeatResult {
  status: ProviderStatus
  lastSuccessAt: number | null
  lastCheckedAt: number
  lastError: string | null
}

export type HeartbeatListener = (result: HeartbeatResult) => void

export class ProviderHeartbeat {
  private status: ProviderStatus = 'UNKNOWN'
  private lastSuccessAt: number | null = null
  private lastCheckedAt = 0
  private lastError: string | null = null
  private _running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly listener: HeartbeatListener

  constructor(listener: HeartbeatListener) {
    this.listener = listener
  }

  get isRunning() { return this._running }

  start(providerId: ProviderId, apiKey: string, model: string): void {
    this.stop()
    void this.ping(providerId, apiKey, model)
    this.timer = setInterval(
      () => void this.ping(providerId, apiKey, model),
      HEARTBEAT_INTERVAL_MS,
    )
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  // Called externally when a real ForgeMind request succeeds — avoids
  // redundant ping immediately after a user interaction.
  reportSuccess(): void {
    this.lastSuccessAt = Date.now()
    this.lastCheckedAt = Date.now()
    this.status = 'ONLINE'
    this.lastError = null
    this.emit()
  }

  async ping(providerId: ProviderId, apiKey: string, model: string): Promise<void> {
    if (!apiKey?.trim()) {
      this.status = 'NO_KEY'
      this.lastError = null
      this.lastCheckedAt = Date.now()
      this.emit()
      return
    }

    // Grace window — recent success means we're still online
    if (
      this.lastSuccessAt &&
      Date.now() - this.lastSuccessAt < ONLINE_GRACE_MS &&
      !this._running
    ) {
      this.status = 'ONLINE'
      this.lastCheckedAt = Date.now()
      this.emit()
      return
    }

    if (this._running) return
    this._running = true
    this.lastCheckedAt = Date.now()

    try {
      await callProvider(
        providerId, model,
        'Connectivity check. Reply with one word.',
        [{ role: 'user', content: 'ping' }],
        apiKey,
        { maxTokens: 1 },
      )
      this.status = 'ONLINE'
      this.lastSuccessAt = Date.now()
      this.lastError = null
    } catch (err) {
      this.status = classifyProviderError(err, apiKey)
      this.lastError = err instanceof Error ? err.message : String(err)
    } finally {
      this._running = false
      this.emit()
    }
  }

  private emit(): void {
    this.listener({
      status: this.status,
      lastSuccessAt: this.lastSuccessAt,
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
    })
  }
}
