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
 * panel is a keyboard shortcut, never a second door. It renders while a proposal is
 * waiting — or whenever this browser holds Kalshi credentials, for the Kalshi (live)
 * balance section (balance plan, 2026-10-23) — and re-reads the ledger whenever `refreshKey` changes (App bumps it
 * after every funds command) or the ledger itself broadcasts a save — so a proposal saved
 * by a model tool outside a /funds command shows its OK / No buttons at once.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FUNDS_CHANGED_EVENT, loadFunds, money, type FundsPosition } from '../lib/fundsLedger'
import { effectiveKalshiRelayUrl, loadKalshiCredentials } from '../lib/kalshiAuth'
import { createKalshiClient, relayFallbackFetcher } from '../lib/kalshiTrade'
import { readKalshiBalanceBlock } from '../lib/kalshiBalanceDisplay'

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

/**
 * The Kalshi (live) section: the exchange's own balance — total, per-shard lines,
 * timestamps — from the shared formatter (kalshiBalanceDisplay), so the panel shows
 * exactly what funds_status and /funds status show. It renders only when this browser
 * holds Kalshi credentials, refreshes on mount and whenever refreshKey moves, and
 * on demand — never on a timer: the balance endpoint's budget is one read a second
 * and Kalshi's spec advises against polling it. The ledger below is a separate
 * record and the two are never merged (balance plan, 2026-10-23).
 */
function KalshiLiveSection({ refreshKey }: { refreshKey: number }) {
  const [block, setBlock] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const refresh = useCallback(async () => {
    const creds = loadKalshiCredentials()
    if (!creds) return
    setReading(true)
    try {
      const client = createKalshiClient(creds, relayFallbackFetcher((url, init) => fetch(url, init), effectiveKalshiRelayUrl()))
      setBlock(await readKalshiBalanceBlock(client, { env: creds.env }))
    } finally {
      setReading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, refreshKey])

  if (!loadKalshiCredentials()) return null
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ color: '#cfe3b8', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {block ?? 'Kalshi (live): reading…'}
      </div>
      <div style={rowStyle}>
        <button style={{ ...okStyle, opacity: reading ? 0.45 : 1 }} disabled={reading} onClick={() => { void refresh() }}>
          {reading ? 'Reading…' : 'Refresh balance'}
        </button>
      </div>
    </div>
  )
}

export function FundsPanel({ onCommand, refreshKey }: { onCommand: (text: string) => void; refreshKey: number }) {
  const [amount, setAmount] = useState('')
  // The ledger lives outside React (localStorage), so the panel re-reads it whenever
  // refreshKey changes — App bumps it after every funds command — and whenever the
  // ledger broadcasts a save (FUNDS_CHANGED_EVENT): a model tool's funds_propose saves
  // outside any /funds command, and without this subscription its proposal would show
  // no OK / No buttons until the next command or tab switch.
  const [ledgerTick, setLedgerTick] = useState(0)
  useEffect(() => {
    const bump = () => setLedgerTick(t => t + 1)
    window.addEventListener(FUNDS_CHANGED_EVENT, bump)
    return () => window.removeEventListener(FUNDS_CHANGED_EVENT, bump)
  }, [])
  const proposed = useMemo(
    () => {
      void refreshKey // the trigger itself: a new key means the ledger changed under us
      void ledgerTick // or the ledger broadcast a save from outside a /funds command
      return loadFunds().positions.filter(p => p.status === 'proposed')
    },
    [refreshKey, ledgerTick],
  )

  // The panel exists while a proposal waits — or, since the balance plan
  // (2026-10-23), whenever this browser holds Kalshi credentials, so the live
  // balance section above the proposals is visible with none waiting too.
  const hasCreds = loadKalshiCredentials() !== null
  if (proposed.length === 0 && !hasCreds) return null

  const parsed = Number(amount)
  const canAdd = Number.isFinite(parsed) && parsed > 0
  return (
    <div style={panelStyle} role="group" aria-label="Funds">
      <KalshiLiveSection refreshKey={refreshKey} />
      {proposed.length > 0 && (
        <>
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
        </>
      )}
    </div>
  )
}
