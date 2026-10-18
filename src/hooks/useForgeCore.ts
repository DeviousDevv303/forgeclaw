// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
//
// Bridges the ForgeOps event stream into window.forgeCore. Observe-only.

import { useEffect, useRef } from 'react'
import type { AgentEvent, ForgeOpsState } from '../types/forgeOps'
import { installForgeCore } from '../core/forgeclawReactiveCore'
import { takeNewEvents } from '../lib/forgeEventCursor'

export function useForgeCore(forgeOpsState: ForgeOpsState): void {
  const lastEventRef = useRef<AgentEvent | null>(null)
  useEffect(() => {
    const events = forgeOpsState.events
    const fresh = takeNewEvents(events, lastEventRef.current)
    if (fresh.length === 0) return
    lastEventRef.current = events[events.length - 1]
    const core = installForgeCore()
    for (const event of fresh) core.ingest(event)
  }, [forgeOpsState.events])
}
