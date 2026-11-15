// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { useState, useEffect, useRef } from 'react'
import { ProviderHeartbeat } from '../lib/ai/providerHeartbeat'
import type { HeartbeatResult } from '../lib/ai/providerHeartbeat'
import type { ProviderId } from '../lib/modelProviders'

export type { ProviderStatus } from '../lib/ai/providerStatus'

export interface UseHeartbeatReturn extends HeartbeatResult {
  checking: boolean
  ping: () => void
  reportSuccess: () => void
}

export function useProviderHeartbeat(
  providerId: ProviderId,
  apiKey: string,
  model: string,
): UseHeartbeatReturn {
  const [result, setResult] = useState<HeartbeatResult>({
    status: apiKey?.trim() ? 'UNKNOWN' : 'NO_KEY',
    lastSuccessAt: null,
    lastCheckedAt: 0,
    lastError: null,
  })
  const [checking, setChecking] = useState(false)

  const hbRef = useRef<ProviderHeartbeat | null>(null)
  const latestRef = useRef({ providerId, apiKey, model })

  useEffect(() => {
    latestRef.current = { providerId, apiKey, model }
  }, [providerId, apiKey, model])

  useEffect(() => {
    const hb = new ProviderHeartbeat(r => {
      setResult(r)
      setChecking(false)
    })
    hbRef.current = hb
    hb.start(providerId, apiKey, model)
    return () => hb.stop()
  }, [providerId, apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...result,
    checking,
    ping: () => {
      const hb = hbRef.current
      if (!hb || hb.isRunning) return
      setChecking(true)
      const { providerId: pId, apiKey: pKey, model: pModel } = latestRef.current
      void hb.ping(pId, pKey, pModel)
    },
    reportSuccess: () => hbRef.current?.reportSuccess(),
  }
}
