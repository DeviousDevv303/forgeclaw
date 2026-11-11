// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * SpiderPanel — the readout for the throne spiders. Every number is counted from ledger lines (src/lib/spiderlings.ts) and
 * the lines are listed under it, newest first, each with its own time; the header says "as of" when it was last computed.
 * A demo feed is labelled DEMO in amber on the panel itself: simulated events are never presented as live.
 * Visibility (owner's order, 2026-11-10): the strip is not on screen constantly — spiderPanelVisible (spiderlings.ts)
 * raises it when a run starts, keeps it while anything is in flight, and hides it shortly after the activity settles.
 */
import React, { useState } from 'react'
import { formatClock, panelLines, spiderCounters, spiderPanelVisible, type SpiderLedger } from '../lib/spiderlings'

/**
 * Clearance above the composer's sticky bar (App.tsx: sticky bottom 0, 10px top + 12px bottom
 * padding, around an 8px-padded row whose tallest control is 36px — ≈70px all told). The panel
 * used to sit at bottom:8 in the same fixed layer and covered the composer and its SEND button;
 * 92px keeps the whole strip above that bar with margin. Scoped to the panel: nothing else moves.
 */
export const SPIDER_PANEL_BOTTOM_PX = 92

const TONE_COLOR = { out: '#8fd0ff', ok: '#6bffb0', flag: '#ff6670', unknown: '#aab0c0' } as const
/** Lines listed under the counters; the rest are counted in the footer so no number outruns its lines silently. */
const SHOWN = 12
const GLYPH = { out: '↗', ok: '↙', flag: '⚑', unknown: '?' } as const

export const SpiderPanel: React.FC<{ ledger: SpiderLedger; now: number; ambient?: { seed: number; freezeMs?: number } | null }> = ({ ledger, now, ambient = null }) => {
  const [open, setOpen] = useState(false)
  // Hidden between runs: render nothing, keep the state (an expanded list reopens as it was).
  if (!spiderPanelVisible(ledger, now)) return null
  const c = spiderCounters(ledger, now)
  const all = panelLines(ledger, now, Infinity)
  const lines = all.slice(0, SHOWN)
  const demo = ledger.source === 'demo'
  return (
    <div
      data-testid="spider-panel"
      data-source={ledger.source}
      style={{
        position: 'fixed', left: 8, bottom: SPIDER_PANEL_BOTTOM_PX, zIndex: 6, width: 'min(340px, calc(100vw - 16px))', boxSizing: 'border-box', padding: '6px 8px',
        background: 'rgba(8,10,18,0.82)', border: `1px solid ${demo ? 'rgba(255,190,70,0.7)' : 'rgba(120,200,255,0.35)'}`, borderRadius: 8,
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace', color: '#cfe3f5', backdropFilter: 'blur(4px)',
      }}
    >
      {demo && (
        <div data-testid="spider-demo-flag" style={{ color: '#ffbe46', fontWeight: 700, marginBottom: 3 }}>
          DEMO · simulated events · not live
        </div>
      )}
      <button
        type="button"
        data-testid="spider-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', paddingRight: 16 }}
      >
        <span aria-hidden="true">🕷 </span>
        <span data-testid="spider-counters" style={{ overflowWrap: 'anywhere' }}>
          in flight <b data-testid="spider-inflight">{c.inFlight}</b> · returned <b data-testid="spider-returned">{c.returned}</b> · flagged <b data-testid="spider-flagged">{c.flagged}</b> · unknown <b data-testid="spider-unknown">{c.unknown}</b>
          {c.unresolved > 0 && <> · unresolved <b data-testid="spider-unresolved">{c.unresolved}</b></>}
        </span>
        <span style={{ float: 'right', opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
      </button>
      <div data-testid="spider-asof" style={{ opacity: 0.7, overflowWrap: 'anywhere' }}>
        as of {formatClock(now)} · counting since {formatClock(ledger.since)}{demo ? ' (demo feed)' : ' (this session)'}
      </div>
      {ambient && (
        <div data-testid="spider-ambient" style={{ opacity: 0.6, overflowWrap: 'anywhere' }}>
          ambient life · seed {ambient.seed}{ambient.freezeMs !== undefined ? ` · frozen at ${(ambient.freezeMs / 1000).toFixed(1)} s` : ''} · not tool events, not counted
        </div>
      )}
      {open && (
        <ol data-testid="spider-lines" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: '38vh', overflowY: 'auto' }}>
          {lines.length === 0 && <li data-testid="spider-empty" style={{ opacity: 0.7 }}>no tool events yet: nothing is out of the throne</li>}
          {lines.map(l => (
            <li key={l.key} data-tone={l.tone} style={{ color: TONE_COLOR[l.tone], display: 'flex', gap: 6 }}>
              <span style={{ opacity: 0.75, flex: '0 0 auto' }}>{formatClock(l.at)}</span>
              <span aria-hidden="true">{GLYPH[l.tone]}</span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
      {open && all.length > lines.length && <div data-testid="spider-more" style={{ opacity: 0.7 }}>showing the newest {lines.length} of {all.length} lines</div>}
    </div>
  )
}

export default SpiderPanel
