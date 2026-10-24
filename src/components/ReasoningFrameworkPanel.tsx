// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Settings panel for the owner's private reasoning framework (src/lib/ownerScaffold.ts). It stays in this browser.
import { useState } from 'react'
import { LEGACY_SCAFFOLD_LIMIT, loadOwnerScaffold, MAX_SCAFFOLD_CHARS, saveOwnerScaffold } from '../lib/ownerScaffold'

const button: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', color: '#aaa', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '10px', fontFamily: 'monospace', fontWeight: 'bold' }

export function ReasoningFrameworkPanel() {
  const [text, setText] = useState(() => loadOwnerScaffold())
  const [saved, setSaved] = useState(() => loadOwnerScaffold())
  const [status, setStatus] = useState('')
  // No silent cut: the box takes any length and says plainly what past the limit would be dropped.
  const over = text.length > MAX_SCAFFOLD_CHARS
  const save = (value: string) => {
    const stored = saveOwnerScaffold(value)
    const cut = value.trim().length - stored.length
    setText(stored); setSaved(stored)
    setStatus(!stored ? 'Cleared. Nexus Intelligence uses its default reasoning loop.'
      : cut > 0 ? `Saved, but the last ${cut.toLocaleString()} characters were past the ${MAX_SCAFFOLD_CHARS.toLocaleString()} limit and were cut. Shorten it so every phase fits.`
        : 'Saved in this browser. Nexus Intelligence reasons with it from the next message.')
  }
  return (
    <section aria-labelledby="framework-heading" style={{ marginTop: '8px', borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <label id="framework-heading" htmlFor="framework-text" style={{ color: '#f97316', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold', fontFamily: 'monospace' }}>Your reasoning framework</label>
        <span style={{ color: saved ? '#22c55e' : '#666', fontSize: '10px', fontFamily: 'monospace' }}>● {saved ? 'active' : 'not set'}</span>
      </div>
      <div style={{ color: '#666', fontSize: '10px', lineHeight: 1.5, marginBottom: '8px', overflowWrap: 'anywhere' }}>
        Paste the way you reason: your phases and what each means. Nexus Intelligence thinks through it privately on every task instead of its default loop. It is stored only in this browser, never in the repository. It is sent to the model you are chatting with, like the rest of the prompt. Up to {MAX_SCAFFOLD_CHARS.toLocaleString()} characters.
      </div>
      <textarea id="framework-text" value={text} rows={7} onChange={e => setText(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', outline: 'none', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
        <button onClick={() => save(text)} style={button}>SAVE</button>
        {saved && <button onClick={() => save('')} style={button}>CLEAR</button>}
        <span style={{ color: over ? '#ef4444' : '#555', fontSize: '10px', fontFamily: 'monospace', marginLeft: 'auto' }}>{text.length.toLocaleString()}/{MAX_SCAFFOLD_CHARS.toLocaleString()}</span>
      </div>
      {over && <div role="alert" style={{ color: '#ef4444', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>Too long: only the first {MAX_SCAFFOLD_CHARS.toLocaleString()} characters are used. Everything from "{text.slice(MAX_SCAFFOLD_CHARS, MAX_SCAFFOLD_CHARS + 40).trim()}…" on would be cut.</div>}
      {!over && saved.length === LEGACY_SCAFFOLD_LIMIT && text === saved && <div role="alert" style={{ color: '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace' }}>Your saved framework is exactly {LEGACY_SCAFFOLD_LIMIT.toLocaleString()} characters, the old limit, so it was probably cut. Paste the full version again; up to {MAX_SCAFFOLD_CHARS.toLocaleString()} now fits.</div>}
      {status && <div role="status" style={{ color: '#eab308', fontSize: '10px', marginTop: '6px', fontFamily: 'monospace' }}>{status}</div>}
    </section>
  )
}
