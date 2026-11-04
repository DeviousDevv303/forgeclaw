// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Canvas drawing for the spiderlings. Reads poses (spiderRoutes.poseOf) and draws; it decides nothing. A spider is drawn only
 * for a run that is in the ledger, so there is nothing here that can animate without an event line behind it.
 */
import { isStale, type SpiderChannel, type SpiderRun } from '../lib/spiderlings'
import { CHEST, poseOf, type AnchorSet, type Pose, type PoseTone, type Pt } from './spiderRoutes'

type RGB = [number, number, number]
const TONE: Record<PoseTone, RGB> = { work: [120, 200, 255], ok: [90, 255, 170], flag: [255, 70, 80], unknown: [170, 170, 185] }

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`

/** One spider at canvas position (x, y), facing `heading`, `size` px long. `gait` advances the legs. */
export function drawSpider(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, tone: PoseTone, gait: number, alpha: number, moving: boolean) {
  const c = TONE[tone]
  ctx.save()
  ctx.translate(x, y); ctx.rotate(heading)
  ctx.globalAlpha = alpha
  // soft glow
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.6)
  g.addColorStop(0, rgba(c, tone === 'unknown' ? 0.12 : 0.5)); g.addColorStop(1, rgba(c, 0))
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, size * 1.6, 0, Math.PI * 2); ctx.fill()
  // legs: four a side, two segments each, alternating gait
  ctx.strokeStyle = rgba(c, tone === 'unknown' ? 0.7 : 0.95); ctx.lineWidth = Math.max(1, size * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      const rootX = size * (0.18 - i * 0.13)
      const swing = moving ? Math.sin(gait + (i % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0)) * 0.35 : 0
      const spread = 0.55 + i * 0.28 + swing
      const k1x = rootX + (i < 2 ? 1 : -1) * size * 0.18 * Math.cos(spread), k1y = side * size * 0.42 * Math.sin(Math.max(0.2, spread))
      const k2x = k1x + (i < 2 ? 1 : -1) * size * 0.16 * Math.cos(spread * 0.6 + swing), k2y = side * size * 0.78 * Math.max(0.55, Math.sin(spread * 0.9))
      ctx.beginPath(); ctx.moveTo(rootX, 0); ctx.lineTo(k1x, k1y); ctx.lineTo(k2x, k2y); ctx.stroke()
    }
  }
  // body: abdomen behind, head in front
  ctx.fillStyle = tone === 'unknown' ? 'rgba(20,20,28,0.55)' : 'rgba(10,12,22,0.92)'
  ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = Math.max(1, size * 0.08)
  ctx.beginPath(); ctx.ellipse(-size * 0.34, 0, size * 0.36, size * 0.27, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(size * 0.14, 0, size * 0.22, size * 0.19, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  if (tone !== 'unknown') { // eyes
    ctx.fillStyle = rgba(c, 1)
    ctx.beginPath(); ctx.arc(size * 0.27, -size * 0.07, size * 0.04, 0, Math.PI * 2); ctx.arc(size * 0.27, size * 0.07, size * 0.04, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

function thread(ctx: CanvasRenderingContext2D, pts: Pt[], P: (p: Pt) => Pt, tone: PoseTone, width: number, alpha: number) {
  if (pts.length < 2) return
  const c = TONE[tone]
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = width
  ctx.beginPath(); pts.forEach((p, i) => { const q = P(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y) }); ctx.stroke()
  ctx.restore()
}

/** A ring expanding from the chest circle: green when the spider returned, red when it came back flagged. */
function dockRing(ctx: CanvasRenderingContext2D, pose: Pose, P: (p: Pt) => Pt, k: number) {
  const q = P(CHEST), c = TONE[pose.tone], d = pose.progress
  ctx.save(); ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rgba(c, 0.85 * (1 - d)); ctx.lineWidth = Math.max(1.5, 3 * k)
  ctx.beginPath(); ctx.arc(q.x, q.y, (14 + 52 * d) * k, 0, Math.PI * 2); ctx.stroke()
  const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 30 * k)
  g.addColorStop(0, rgba(c, 0.55 * (1 - d))); g.addColorStop(1, rgba(c, 0))
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, 30 * k, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

export interface DrawStats { drawn: number; byPhase: Record<string, number> }

/** Draw every spider of `runs` at `now`. Returns what was drawn so a test (or the panel) can compare it to the ledger. */
export function drawSpiders(ctx: CanvasRenderingContext2D, runs: readonly SpiderRun[], now: number, anchors: AnchorSet, P: (p: Pt) => Pt, k: number, t: number, view: { w: number; h: number }): DrawStats {
  const stats: DrawStats = { drawn: 0, byPhase: {} }
  const open = new Map<SpiderChannel, { fresh: number; unknown: number }>()
  for (const run of runs) {
    const pose = poseOf(run, now, anchors)
    if (!pose) continue
    stats.drawn += 1; stats.byPhase[pose.phase] = (stats.byPhase[pose.phase] ?? 0) + 1
    if (run.endedAt === undefined) {
      const tag = open.get(run.channel) ?? { fresh: 0, unknown: 0 }
      if (isStale(run, now)) tag.unknown += 1; else tag.fresh += 1
      open.set(run.channel, tag)
    }
    const q = P(pose)
    const size = 17 * k + 5
    thread(ctx, pose.thread, P, pose.tone === 'work' ? 'work' : pose.tone, Math.max(1, 1.6 * k), pose.phase === 'back' || pose.phase === 'dock' ? 0.8 * pose.alpha : pose.tone === 'unknown' ? 0.18 * pose.alpha : 0.4)
    if (pose.phase === 'dock') dockRing(ctx, pose, P, k)
    const y = q.y
    let heading = pose.heading
    if (pose.phase === 'working') { // hover at the node: a slow patrol, so it reads as occupied, not frozen
      const a = pose.progress * Math.PI * 2
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(TONE.work, 0.25 + 0.2 * Math.sin(a)); ctx.lineWidth = Math.max(1, 1.5 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, (16 + 4 * Math.sin(a)) * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
      heading = a + Math.PI / 2
      const orbit = 15 * k
      drawSpider(ctx, q.x + Math.cos(a) * orbit, y + Math.sin(a) * orbit * 0.6, heading, size, pose.tone, t / 90, pose.alpha, true)
      continue
    }
    if (pose.phase === 'unknown') { // unknown: a hollow grey spider, still, with a ring that does not pulse
      ctx.save(); ctx.strokeStyle = rgba(TONE.unknown, 0.5 * pose.alpha); ctx.setLineDash([3, 3]); ctx.lineWidth = Math.max(1, 1.3 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, 17 * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
    }
    if (pose.phase === 'dock') heading = -Math.PI / 2
    drawSpider(ctx, q.x, y, heading, pose.phase === 'dock' ? size * (1 - pose.progress * 0.5) : size, pose.tone, t / 70, pose.alpha, pose.phase === 'out' || pose.phase === 'back')
  }
  // Node tags: only for a channel with an unanswered run, so an idle painting carries no text at all.
  ctx.save(); ctx.font = `${Math.max(10, 11 * k)}px ui-monospace, monospace`; ctx.textAlign = 'center'
  for (const [channel, n] of open) {
    const q = P(anchors[channel])
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const label = `${channel}${n.fresh ? ` · ${n.fresh} in flight` : ''}${n.unknown ? ` · ${n.unknown} unknown` : ''}`, w = ctx.measureText(label).width + 10
    const cx = Math.min(view.w - w / 2 - 4, Math.max(w / 2 + 4, q.x)) // keep the tag on screen
    ctx.fillRect(cx - w / 2, q.y + 20 * k, w, 14); ctx.fillStyle = 'rgba(210,235,255,0.95)'; ctx.fillText(label, cx, q.y + 20 * k + 11)
  }
  ctx.restore()
  return stats
}
