// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// NEXUS learning growth: a cumulative graph and node field drawn ONLY from the stored
// corpus records handed to it — every point is a real record's real timestamp, every
// node is one admitted entry. Nothing is synthesized to make the graph look fuller
// than the learning underneath it: few entries honestly draw a small graph. The panel
// refreshes its candidate list while open, so a newly admitted entry lands here on
// the next refresh — the status line always names the real counts either way, so a
// young graph reads as young, never as broken (the STALE/SNAPSHOT rule: honest
// states announce themselves).
import { useEffect, useMemo, useRef } from 'react'
import type { LearningCandidate } from '../lib/corpus'
import { growthSeries, type GrowthPoint } from '../lib/nexusGrowth'

// Performance cap for the node field only: past this many admitted entries the field
// stops gaining visible nodes (the graph line and the counts always show the real
// numbers; the legend under the field says when the cap is in effect).
const MAX_FIELD_NODES = 240

// Deterministic per-index placement (a tiny mulberry32): node i always lands in the
// same spot, so a newly admitted entry adds a node without reshuffling the field.
function nodePosition(i: number, w: number, h: number): { x: number; y: number; r: number } {
  let seed = 0x9e3779b9 + i * 0x85ebca6b
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let z = seed
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
  return { x: 14 + rand() * (w - 28), y: 12 + rand() * (h - 24), r: 1.8 + (i % 5) * 0.35 }
}

const CHART_W = 560
const CHART_H = 150
const PAD = { left: 6, right: 6, top: 8, bottom: 20 }

function stepPath(points: GrowthPoint[], pick: (p: GrowthPoint) => number, x: (t: number) => number, y: (v: number) => number): string {
  if (points.length === 0) return ''
  let d = `M ${x(points[0].t).toFixed(1)} ${y(pick(points[0])).toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${x(points[i].t).toFixed(1)} ${y(pick(points[i - 1])).toFixed(1)} L ${x(points[i].t).toFixed(1)} ${y(pick(points[i])).toFixed(1)}`
  }
  return d
}

function dayLabel(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export function NexusGrowthGraph({ candidates }: { candidates: LearningCandidate[] }) {
  const points = useMemo(() => growthSeries(candidates), [candidates])
  const total = candidates.length
  const admitted = useMemo(() => candidates.filter(c => c.admissionStatus === 'approved').length, [candidates])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const shownNodes = Math.min(admitted, MAX_FIELD_NODES)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return // jsdom and a few embedded webviews have no 2d context; the counts and lines still render.
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    // Faint links between neighbours in admission order, then the nodes themselves —
    // the neural background's visual language (small lit points, hairline links).
    ctx.lineWidth = 1
    for (let i = 1; i < shownNodes; i++) {
      const a = nodePosition(i - 1, w, h)
      const b = nodePosition(i, w, h)
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.10)'
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    for (let i = 0; i < shownNodes; i++) {
      const n = nodePosition(i, w, h)
      ctx.fillStyle = i % 10 === 9 ? 'rgba(249, 115, 22, 0.9)' : 'rgba(57, 255, 20, 0.75)'
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill()
    }
  }, [shownNodes])

  const statusLine = total === 0
    ? 'Nexus has admitted 0 entries — no learning records yet; the graph grows as it learns.'
    : `Nexus has admitted ${admitted} of ${total} recorded entr${total === 1 ? 'y' : 'ies'} — the graph grows as it learns.`

  let chart: React.ReactNode = null
  if (points.length > 0) {
    const first = points[0]
    const last = points[points.length - 1]
    const span = Math.max(last.t - first.t, 1)
    const minT = first.t - span * 0.02
    const maxT = last.t + span * 0.02
    const maxV = Math.max(last.total, 1)
    const x = (t: number) => PAD.left + ((t - minT) / (maxT - minT)) * (CHART_W - PAD.left - PAD.right)
    const y = (v: number) => CHART_H - PAD.bottom - (v / maxV) * (CHART_H - PAD.top - PAD.bottom)
    chart = (
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Cumulative learning records: ${last.total} recorded, ${last.admitted} admitted`} data-testid="nexus-growth-chart">
        <line x1={PAD.left} y1={CHART_H - PAD.bottom} x2={CHART_W - PAD.right} y2={CHART_H - PAD.bottom} stroke="#222" strokeWidth="1" />
        <path d={stepPath(points, p => p.total, x, y)} fill="none" stroke="#888" strokeWidth="1.5" data-testid="nexus-growth-total-line" />
        <path d={stepPath(points, p => p.admitted, x, y)} fill="none" stroke="#22c55e" strokeWidth="1.5" data-testid="nexus-growth-admitted-line" />
        <circle cx={x(last.t)} cy={y(last.total)} r="2.5" fill="#888" />
        <circle cx={x(last.t)} cy={y(last.admitted)} r="2.5" fill="#22c55e" />
        <text x={PAD.left} y={CHART_H - 6} fill="#555" fontSize="9" fontFamily="monospace">{dayLabel(first.t)}</text>
        <text x={CHART_W - PAD.right} y={CHART_H - 6} fill="#555" fontSize="9" fontFamily="monospace" textAnchor="end">{dayLabel(last.t)}</text>
      </svg>
    )
  }

  return (
    <div>
      <div role="status" style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace', marginBottom: '8px' }}>{statusLine}</div>
      {chart}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', color: '#666', fontSize: '10px', fontFamily: 'monospace', margin: '6px 0 8px' }}>
        <span><span style={{ color: '#888' }}>—</span> recorded ({total})</span>
        <span><span style={{ color: '#22c55e' }}>—</span> admitted ({admitted})</span>
        {admitted > MAX_FIELD_NODES && <span>node field shows the first {MAX_FIELD_NODES} admitted entries</span>}
      </div>
      <canvas
        ref={canvasRef}
        width={CHART_W}
        height={110}
        style={{ width: '100%', height: '110px', display: 'block', background: '#0a0f0a', border: '1px solid #1a2415', borderRadius: '6px' }}
        aria-label={`Node field: one node per admitted entry (${admitted})`}
        data-testid="nexus-node-field"
      />
    </div>
  )
}
