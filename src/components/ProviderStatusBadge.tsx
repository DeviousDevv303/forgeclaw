// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

import { useState, useEffect } from 'react'
import { STATUS_META } from '../lib/ai/providerStatus'
import type { ProviderStatus } from '../lib/ai/providerStatus'

interface Props {
  status: ProviderStatus
  lastSuccessAt: number | null
  lastError: string | null
  checking: boolean
  onPing: () => void
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function ProviderStatusBadge({ status, lastSuccessAt, lastError, checking, onPing }: Props) {
  // Tick every 20s so "Xm ago" stays fresh without excess renders
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 20_000)
    return () => clearInterval(id)
  }, [])

  const meta = STATUS_META[status]
  const isChecking = checking
  const tooltipText = lastError
    ? `${meta.tip}\n${lastError}`
    : meta.tip

  return (
    <div
      title={tooltipText}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.5px',
        userSelect: 'none',
      }}
    >
      {/* Status dot */}
      <span style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        background: meta.color,
        boxShadow: status === 'ONLINE' ? `0 0 5px ${meta.color}` : 'none',
        animation: isChecking ? 'pulse 1s infinite' : 'none',
      }} />

      {/* Status label */}
      <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>

      {/* Last success */}
      {lastSuccessAt && !isChecking && (
        <span style={{ color: '#444' }}>· {timeAgo(lastSuccessAt)}</span>
      )}

      {/* Manual ping button */}
      <button
        onClick={onPing}
        disabled={checking}
        title="Test provider now"
        style={{
          background: 'none', border: '1px solid #333', borderRadius: '3px',
          color: checking ? '#333' : '#555',
          cursor: checking ? 'not-allowed' : 'pointer',
          padding: '1px 5px', fontSize: '9px', fontFamily: 'monospace',
          lineHeight: 1, marginLeft: '2px',
        }}
      >
        ↻
      </button>
    </div>
  )
}
