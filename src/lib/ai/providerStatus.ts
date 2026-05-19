// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

export type ProviderStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'NO_KEY'
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT'
  | 'NETWORK_FAILURE'
  | 'BAD_RESPONSE'
  | 'UNKNOWN'

export interface StatusMeta {
  color: string
  label: string
  tip: string
  retryable: boolean
}

export const STATUS_META: Record<ProviderStatus, StatusMeta> = {
  ONLINE:          { color: '#22c55e', label: 'ONLINE',     tip: 'Provider responding normally',               retryable: false },
  OFFLINE:         { color: '#ef4444', label: 'OFFLINE',    tip: 'Cannot reach provider endpoint',            retryable: true  },
  NO_KEY:          { color: '#555555', label: 'NO KEY',     tip: 'No API key — add one in Settings',          retryable: false },
  AUTH_FAILURE:    { color: '#dc2626', label: 'AUTH FAIL',  tip: 'API key rejected — replace key in Settings',retryable: false },
  RATE_LIMIT:      { color: '#f59e0b', label: 'RATE LIMIT', tip: 'Too many requests — wait before retrying',  retryable: true  },
  NETWORK_FAILURE: { color: '#ef4444', label: 'NET FAIL',   tip: 'Network error or DNS failure',              retryable: true  },
  BAD_RESPONSE:    { color: '#f97316', label: 'BAD RESP',   tip: 'Malformed response from provider',          retryable: true  },
  UNKNOWN:         { color: '#6b7280', label: 'UNKNOWN',    tip: 'Status not yet determined',                 retryable: true  },
}

export function classifyProviderError(err: unknown, apiKey: string): ProviderStatus {
  if (!apiKey?.trim()) return 'NO_KEY'

  const msg = err instanceof Error ? err.message : String(err)

  if (/Failed to fetch|NetworkError|net::/i.test(msg))              return 'NETWORK_FAILURE'
  if (/ENOTFOUND|ETIMEDOUT|timeout/i.test(msg))                     return 'OFFLINE'
  if (/401|invalid.*(api.?key|token|auth)|unauthorized/i.test(msg)) return 'AUTH_FAILURE'
  if (/429|rate.?limit|too many request/i.test(msg))                return 'RATE_LIMIT'
  if (/empty response|choices.*null|no content/i.test(msg))         return 'BAD_RESPONSE'

  return 'UNKNOWN'
}
