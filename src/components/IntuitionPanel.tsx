/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * Synthetic Intuition panel (read-only). Shows, per pattern class and regime, the graded denominators, the Wilson lower bound
 * and the 0-7 bucket the model would be shown, plus every journaled packet and whether the harness would accept it
 * (RESOLVES) or reject it (FAILS CLOSED). It has no buttons that change evidence: leverage is earned only from graded records.
 */
import { useEffect, useState } from 'react'
import { BUCKET_EDGES_ID, ESTIMATOR_ID } from '../lib/intuition/boundMath'
import { INTUITION_CHANGED_EVENT, allStats, loadLedger, type IntuitionLedger } from '../lib/intuition/ledger'
import { resolvePacket } from '../lib/intuition/packet'
import type { PatternRegistry } from '../lib/intuition/patternClasses'

const box: React.CSSProperties = { margin: '8px 0', background: '#0e1218', border: '1px solid #243044', borderRadius: '8px', padding: '8px 10px', color: '#cbd5e1', fontSize: '12px' }
const mono: React.CSSProperties = { fontFamily: 'monospace' }

export function IntuitionPanel({ open, registry, onClose }: { open: boolean; registry: PatternRegistry; onClose: () => void }) {
  const [ledger, setLedger] = useState<IntuitionLedger>(() => loadLedger())
  useEffect(() => {
    const refresh = () => setLedger(loadLedger())
    window.addEventListener(INTUITION_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => { window.removeEventListener(INTUITION_CHANGED_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [open])
  if (!open) return null
  const stats = allStats(ledger)
  return (
    <section aria-label="Synthetic Intuition ledger" style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong style={{ flex: '1 1 auto', whiteSpace: 'nowrap' }}>Synthetic Intuition · read-only</strong>
        <span style={{ ...mono, color: registry.status === 'frozen' ? '#86efac' : '#fbbf24' }}>registry {registry.version} · {registry.status}</span>
        <button onClick={onClose} aria-label="Close Synthetic Intuition ledger" style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #243044', borderRadius: '5px', cursor: 'pointer' }}>close</button>
      </div>
      <div style={{ ...mono, color: '#64748b', marginTop: '3px' }}>{ESTIMATOR_ID} · {BUCKET_EDGES_ID}</div>
      {registry.status !== 'frozen' && <div role="note" style={{ color: '#fbbf24', marginTop: '4px' }}>Registry is a draft: packets are not issued to a model until the pattern-class list is frozen.</div>}
      {stats.length === 0 ? (
        <div style={{ marginTop: '6px' }}>No graded evidence yet. Every class sits at bucket 0 until real graded records earn more.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
        <table style={{ ...mono, width: '100%', marginTop: '6px', borderCollapse: 'collapse', fontSize: '11px', whiteSpace: 'nowrap' }}>
          <thead><tr style={{ textAlign: 'left', color: '#94a3b8' }}><th>class</th><th>regime</th><th>hits/n</th><th>lower bound</th><th>bucket</th><th>excluded</th></tr></thead>
          <tbody>
            {stats.map(s => {
              const ex = Object.entries(s.excluded).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ')
              return (
                <tr key={`${s.patternClassId}|${s.regime}`}>
                  <td>{s.patternClassId}</td><td>{s.regime}</td><td>{s.hits}/{s.n}</td><td>{s.lowerBound.toFixed(2)}</td><td>{s.bucket}</td><td>{ex || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
      {ledger.journal.length > 0 && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ color: '#94a3b8' }}>Journaled packets</div>
          {ledger.journal.map(j => {
            const r = resolvePacket(ledger, registry, j.packetHash)
            return (
              <div key={j.packetHash} style={{ ...mono, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span>{j.packet}</span><span style={{ color: '#64748b' }}>{j.packetHash.slice(0, 12)}</span>
                <span style={{ color: r.ok ? '#86efac' : '#fca5a5' }}>{r.ok ? 'RESOLVES' : `FAILS CLOSED: ${r.reason}`}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
