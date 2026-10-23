/*
 * Copyright (c) 2026 DeviousDevv303 (Cristian)
 * ForgeClaw — Personal AI Assistant
 * Built with love for Cristian Jr., Layla, and Jozae
 */

/**
 * One-tap funds actions (directive PR B item 6): every proposed position gets OK / No
 * buttons and an add-funds box, rendered over the chat. With 2+ proposals waiting, an
 * "Approve all" button appears too (item 10) — it sends `/funds approve-all`, which the
 * execution layer runs as one single approve per proposal, never a shortcut. A tap sends the SAME owner command
 * the owner would type (`/funds approve p2`, `/funds add 200`) through the normal send path,
 * so the ledger rules, the cage and the Kalshi execution layer all apply unchanged — the
 * panel is a keyboard shortcut, never a second door. It renders only while at least one
 * proposal is waiting, and re-reads the ledger whenever `refreshKey` changes (App bumps it
 * after every funds command).
 */

import { useMemo, useState } from 'react'
import { loadFunds, money, type FundsPosition } from '../lib/fundsLedger'

const panelStyle: React.CSSProperties = {
  margin: '8px 12px 0', background: '#101408', border: '1px solid #2a3319', borderRadius: '8px', padding: '10px 12px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px',
}
const okStyle: React.CSSProperties = {
  background: '#1e4633', color: '#b8f4cf', border: '1px solid #2f6b4c', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
}
const noStyle: React.CSSProperties = {
  background: '#3a1d1d', color: '#f4b8b8', border: '1px solid #6b2f2f', borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
}
const inputStyle: React.CSSProperties = {
  background: '#0a0a0a', color: '#ccc', border: '1px solid #222', borderRadius: '4px', padding: '5px 7px', fontSize: '12px', width: '110px', outline: 'none',
}

function ProposalRow({ p, onCommand }: { p: FundsPosition; onCommand: (text: string) => void }) {
  return (
    <div style={rowStyle}>
      <span style={{ color: '#ddd', fontSize: '12px', fontFamily: 'monospace', flex: '1 1 220px' }}>
        {p.id} · {p.market} · {p.contracts} {p.side.toUpperCase()} @ {money(p.price)} ({money(p.stake)})
        {p.mode === 'paper' ? ' · paper' : ''}
      </span>
      <button style={okStyle} onClick={() => onCommand(`/funds approve ${p.id}`)}>OK</button>
      <button style={noStyle} onClick={() => onCommand(`/funds reject ${p.id}`)}>No</button>
    </div>
  )
}

export function FundsPanel({ onCommand, refreshKey }: { onCommand: (text: string) => void; refreshKey: number }) {
  const [amount, setAmount] = useState('')
  // The ledger lives outside React (localStorage), so the panel re-reads it whenever
  // refreshKey changes — App bumps it after every funds command (see the header note).
  const proposed = useMemo(
    () => {
      void refreshKey // the trigger itself: a new key means the ledger changed under us
      return loadFunds().positions.filter(p => p.status === 'proposed')
    },
    [refreshKey],
  )

  if (proposed.length === 0) return null

  const parsed = Number(amount)
  const canAdd = Number.isFinite(parsed) && parsed > 0
  return (
    <div style={panelStyle} role="group" aria-label="Funds proposals">
      <div style={{ color: '#b8cc7d', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Funds — proposals waiting
      </div>
      {proposed.map(p => <ProposalRow key={p.id} p={p} onCommand={onCommand} />)}
      {proposed.length >= 2 && (
        <div style={rowStyle}>
          <button style={okStyle} onClick={() => onCommand('/funds approve-all')}>Approve all</button>
        </div>
      )}
      <div style={rowStyle}>
        <input
          style={inputStyle}
          inputMode="decimal"
          placeholder="Add funds $"
          aria-label="Add funds amount"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />
        <button
          style={{ ...okStyle, opacity: canAdd ? 1 : 0.45 }}
          disabled={!canAdd}
          onClick={() => { onCommand(`/funds add ${parsed}`); setAmount('') }}
        >
          Add funds
        </button>
      </div>
    </div>
  )
}
