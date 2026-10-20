// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Settings panel for the self-sculpt key (src/lib/sculptKey.ts). The key never leaves this browser.
import { useState } from 'react'
import { hasSculptKey, isSculptUnlocked, lockSculpt, SCULPT_KEY_MIN_LENGTH, setSculptKey, unlockSculpt } from '../lib/sculptKey'

const input: React.CSSProperties = { flex: 1, minWidth: 0, background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }
const button: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', color: '#aaa', borderRadius: '4px', padding: '0 12px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }

export function SculptKeyPanel() {
  const [key, setKey] = useState('')
  const [current, setCurrent] = useState('')
  const [changing, setChanging] = useState(false)
  const [status, setStatus] = useState('')
  const [, rerender] = useState(0)
  const configured = hasSculptKey()
  const unlocked = isSculptUnlocked()
  const done = (message: string) => { setKey(''); setCurrent(''); setChanging(false); setStatus(message); rerender(n => n + 1) }

  const submit = async () => {
    try {
      if (!configured || changing) {
        await setSculptKey(key, changing ? current : undefined)
        done('Self-sculpt key saved. Self-sculpt stays unlocked in this browser until you lock it.')
      } else if (await unlockSculpt(key)) {
        done('Unlocked. It stays unlocked in this browser until you lock it.')
      } else {
        setKey('')
        setStatus('Wrong key. Self-sculpt stays locked.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section aria-labelledby="sculpt-key-heading" style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <label id="sculpt-key-heading" style={{ color: '#f97316', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold', fontFamily: 'monospace' }}>Self-sculpt key</label>
        <span style={{ color: unlocked ? '#22c55e' : '#ef4444', fontSize: '10px', fontFamily: 'monospace' }}>● {unlocked ? 'unlocked' : configured ? 'locked' : 'not set'}</span>
      </div>
      <div style={{ color: '#666', fontSize: '10px', lineHeight: 1.5, marginBottom: '8px' }}>
        ForgeClaw can only change its own code after you unlock it with this key. Only you know it; it is stored as a hash in this browser and never sent anywhere.
        {!configured && ` Choose a phrase of at least ${SCULPT_KEY_MIN_LENGTH} characters.`}
      </div>
      {changing && <input aria-label="Current self-sculpt key" type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="current key" style={{ ...input, width: '100%', marginBottom: '6px' }} />}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input aria-label="Self-sculpt key" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit() }} placeholder={!configured || changing ? 'new key' : 'enter your key'} style={input} />
        <button onClick={() => void submit()} style={button}>{!configured ? 'SET KEY' : changing ? 'CHANGE' : 'UNLOCK'}</button>
        {unlocked && !changing && <button onClick={() => { lockSculpt(); done('Locked.') }} style={button}>LOCK</button>}
      </div>
      {configured && !changing && <button onClick={() => { setChanging(true); setStatus('') }} style={{ ...button, marginTop: '6px', padding: '4px 10px' }}>CHANGE KEY</button>}
      {status && <div role="status" style={{ color: '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace' }}>{status}</div>}
    </section>
  )
}
