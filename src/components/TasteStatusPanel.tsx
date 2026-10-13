import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_TASTE_ENDPOINT, TasteProviderClient } from '../lib/ai/providers/tasteProvider'

const STORAGE_KEY = 'fc_taste_endpoint'
type Status = 'checking' | 'online' | 'offline'

export function TasteStatusPanel() {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem(STORAGE_KEY) || DEFAULT_TASTE_ENDPOINT)
  const [status, setStatus] = useState<Status>('checking')
  const [detail, setDetail] = useState('')

  const check = useCallback(async (url = endpoint) => {
    setStatus('checking')
    setDetail('')
    try {
      const health = await new TasteProviderClient(url).health()
      setStatus('online')
      setDetail(typeof health.status === 'string' ? health.status : 'health check passed')
    } catch (error) {
      setStatus('offline')
      setDetail(error instanceof Error ? error.message : 'NEXUS Taste is unavailable')
    }
  }, [endpoint])

  useEffect(() => {
    const timer = globalThis.setTimeout(() => { void check() }, 0)
    return () => globalThis.clearTimeout(timer)
  }, [check])

  const save = () => {
    const next = endpoint.trim().replace(/\/+$/, '') || DEFAULT_TASTE_ENDPOINT
    setEndpoint(next)
    localStorage.setItem(STORAGE_KEY, next)
    void check(next)
  }
  const color = status === 'online' ? '#22c55e' : status === 'offline' ? '#ef4444' : '#eab308'

  return (
    <section aria-labelledby="taste-status-heading" style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <label id="taste-status-heading" style={{ color: '#f97316', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold', fontFamily: 'monospace' }}>NEXUS Taste</label>
        <span style={{ color, fontSize: '10px', fontFamily: 'monospace' }}>● {status === 'checking' ? 'CHECKING' : status.toUpperCase()}</span>
      </div>
      <div style={{ color: '#666', fontSize: '10px', lineHeight: 1.5, marginBottom: '8px' }}>Optional aesthetic extraction and feedback service. Chat remains available when Taste is offline.</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input aria-label="NEXUS Taste endpoint" type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} style={{ flex: 1, minWidth: 0, background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }} />
        <button onClick={save} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#aaa', borderRadius: '4px', padding: '0 12px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }}>SAVE / CHECK</button>
      </div>
      <div role="status" style={{ color: status === 'offline' ? '#ef4444' : '#555', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', wordBreak: 'break-word' }}>{detail || 'Probing GET /health…'}</div>
    </section>
  )
}
