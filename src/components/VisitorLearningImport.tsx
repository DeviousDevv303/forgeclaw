// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Owner-only: import visitors' conversations from the relay into NEXUS (as unapproved candidates)
// and read the error reports every user's browser sent. Needs the relay's OWNER_KEY.
import { useState } from 'react'
import { corpusRepository } from '../lib/corpus'
import { buildLearningEvent } from '../lib/learningEvents'
import { PUBLIC_RELAY_URL } from '../lib/publicRelay'

const KEY = 'fc_relay_owner_key'
const box: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 14px', margin: '0 20px 20px' }
const button: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', color: '#aaa', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }

interface ErrorReport { mode: string; ts: string; ua: string; entries: Array<{ timestamp: number; level: string; source: string; message: string }> }

export function VisitorLearningImport() {
  const [ownerKey, setOwnerKey] = useState(() => { try { return localStorage.getItem(KEY) || '' } catch { return '' } })
  const [status, setStatus] = useState('')
  const [reports, setReports] = useState<ErrorReport[]>([])
  if (!PUBLIC_RELAY_URL) return null

  const call = async (path: string) => {
    try { localStorage.setItem(KEY, ownerKey) } catch { /* not remembered */ }
    const res = await fetch(`${PUBLIC_RELAY_URL}${path}`, { headers: { Authorization: `Bearer ${ownerKey}` } })
    if (!res.ok) throw new Error(res.status === 401 ? 'Wrong owner key.' : `Relay ${res.status}`)
    return (await res.json() as { records: unknown[] }).records
  }

  const importLearning = async () => {
    setStatus('Importing…')
    try {
      const records = await call('/v1/learning') as Array<{ task: string; result: string; model: string }>
      for (const r of records) {
        await corpusRepository.appendInteraction({
          ...buildLearningEvent({ channel: 'chat', input: r.task, result: r.result, outcome: 'completed', runtime: 'public-relay', model: r.model || 'public', actor: 'user' }),
          source: 'learning:visitor',
        })
      }
      setStatus(`Imported ${records.length} visitor conversation(s) into NEXUS as unapproved candidates (duplicates are merged).`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const loadErrors = async () => {
    setStatus('Loading error reports…')
    try {
      const records = await call('/v1/errors') as ErrorReport[]
      setReports(records.slice(-20).reverse())
      setStatus(`${records.length} error report(s) stored.`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  return (
    <section style={box} aria-label="Visitor learning">
      <div style={{ fontSize: '10px', color: '#f97316', letterSpacing: '2px', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '8px' }}>VISITORS · LEARNING & ERROR REPORTS</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input aria-label="Relay owner key" type="password" value={ownerKey} onChange={e => setOwnerKey(e.target.value)} placeholder="relay owner key" style={{ flex: 1, minWidth: '160px', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '11px', fontFamily: 'monospace' }} />
        <button onClick={() => void importLearning()} disabled={!ownerKey} style={button}>IMPORT TO NEXUS</button>
        <button onClick={() => void loadErrors()} disabled={!ownerKey} style={button}>ERROR REPORTS</button>
      </div>
      {status && <div role="status" style={{ color: '#eab308', fontSize: '11px', marginTop: '8px' }}>{status}</div>}
      {reports.map(r => (
        <div key={`${r.ts}${r.ua}`} style={{ borderTop: '1px solid #161616', marginTop: '8px', paddingTop: '6px', fontSize: '11px', color: '#aaa', fontFamily: 'monospace' }}>
          <div style={{ color: '#666' }}>{r.ts.slice(0, 19).replace('T', ' ')} · {r.mode} · {r.ua.slice(0, 60)}</div>
          {r.entries.slice(-5).map(e => <div key={`${e.timestamp}${e.message}`} style={{ color: e.level === 'error' ? '#ef4444' : '#eab308' }}>{e.source}: {e.message.slice(0, 200)}</div>)}
        </div>
      ))}
    </section>
  )
}
