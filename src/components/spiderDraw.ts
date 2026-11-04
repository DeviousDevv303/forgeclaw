// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Canvas drawing for the spiderlings. Reads poses (spiderRoutes.poseOf) and ambient scenes (spiderAmbient) and draws; it decides nothing.
 *
 * Two kinds of spider, drawn by two functions on purpose:
 *   drawSpiders  — one per ledger run (a real TOOL_START with no end yet, or just ended). These carry state: a coloured halo says
 *                  working / returned / flagged / unknown, and they are the ones the counters count.
 *   drawAmbient  — life on the painting: no halo, no label, no ledger. They claim nothing.
 * Both are jumping spiders drawn after the owner's reference photo (Phidippus carneus): see drawSpider.
 * Silk is not a neural line: thin, pale, slight sag, drawn with normal compositing (no glow, no pulse, no travelling light).
 */
import { isStale, type SpiderChannel, type SpiderRun } from '../lib/spiderlings'
import type { AmbientScene } from './spiderAmbient'
import { renderJumperFront, renderJumperTop, type Morph } from './spiderRender'
import { CHEST, poseOf, type AnchorSet, type Pose, type PoseTone, type Pt, type Surface } from './spiderRoutes'

type RGB = [number, number, number]
const TONE: Record<PoseTone, RGB> = { work: [120, 200, 255], ok: [90, 255, 170], flag: [255, 70, 80], unknown: [170, 170, 185] }
const SILK: RGB = [238, 242, 255]
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`

export interface SpiderLook {
  /** Present for a spider that carries state (its halo shows the state); absent for an ambient spider. */
  tone?: PoseTone
  gait: number
  alpha: number
  moving: boolean
  /** Height above the ground in screen px (a hop); the shadow stays on the ground. */
  lift?: number
  groom?: boolean
  /** carneus (7511, black with a red abdomen) or red (7509, red cephalothorax and abdomen). */
  morph?: Morph
  pitch?: number
  squash?: number
  surface?: Surface
  /** Eyeshine colour, matched to the scene's light. */
  glint?: string
  /** Front view: the head turned toward what it watches. */
  tilt?: number
}

/** A jumping spider at (x, y) on the ground, facing `heading`, `size` px long, seen from above (renderer: spiderRender.ts). */
export function drawSpider(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, look: SpiderLook) {
  const s = size, lift = look.lift ?? 0, unknown = look.tone === 'unknown'
  ctx.save()
  ctx.globalAlpha = look.alpha
  if (lift > 0.5) { // shadow on the ground, smaller and fainter the higher it is
    ctx.fillStyle = `rgba(0,0,0,${(0.4 / (1 + lift / (s * 1.4))).toFixed(3)})`
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.15, s * 0.7 / (1 + lift / (s * 3)), s * 0.26 / (1 + lift / (s * 3)), 0, 0, Math.PI * 2); ctx.fill()
  }
  if (look.tone && !unknown) { // the halo is the state, and only a spider that carries state has one
    const c = TONE[look.tone], g = ctx.createRadialGradient(x, y - lift, 0, x, y - lift, s * 1.6)
    g.addColorStop(0, rgba(c, 0.42)); g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - lift, s * 1.6, 0, Math.PI * 2); ctx.fill()
  }
  ctx.translate(x, y - lift); ctx.rotate(heading)
  renderJumperTop(ctx, s, { gait: look.gait, moving: look.moving, groom: look.groom, morph: unknown ? 'ghost' : look.morph, pitch: look.pitch, squash: look.squash, surface: look.surface, glint: look.glint })
  ctx.restore()
}

/** The same spider turned to look back at the viewer (at rest): the face is what makes it a character. Origin = the ground under it. */
export function drawSpiderFront(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, look: SpiderLook) {
  const unknown = look.tone === 'unknown'
  ctx.save(); ctx.globalAlpha = look.alpha
  if (look.tone && !unknown) {
    const c = TONE[look.tone], g = ctx.createRadialGradient(x, y - size * 0.4, 0, x, y - size * 0.4, size * 1.5)
    g.addColorStop(0, rgba(c, 0.4)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - size * 0.4, size * 1.5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.translate(x, y)
  renderJumperFront(ctx, size, { gait: look.gait, moving: false, groom: look.groom, morph: unknown ? 'ghost' : look.morph, squash: look.squash, glint: look.glint, tilt: look.tilt })
  ctx.restore()
}

/** Silk: fine, pale, with whatever sag the polyline already has. Not a cable: no glow, no pulse, no travelling light. */
export function drawSilk(ctx: CanvasRenderingContext2D, pts: Pt[], P: (p: Pt) => Pt, k: number, alpha: number, color: RGB = SILK) {
  if (pts.length < 2 || alpha <= 0.01) return
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = Math.max(0.8, 0.9 * k)
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

/** Draw every ledger spider of `runs` at `now`. Returns what was drawn so a test (or the panel) can compare it to the ledger. */
export function drawSpiders(ctx: CanvasRenderingContext2D, runs: readonly SpiderRun[], now: number, anchors: AnchorSet, P: (p: Pt) => Pt, k: number, t: number, view: { w: number; h: number }, glint = 'rgba(255,255,255,0.9)'): DrawStats {
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
    const q = P(pose), size = 24 * k + 8
    // the dragline: silver silk behind the spider; red when it is flagged (the owner's "red thread"); faint grey when unknown
    const silk = pose.tone === 'flag' && (pose.phase === 'back' || pose.phase === 'dock') ? ([255, 80, 92] as RGB) : pose.tone === 'unknown' ? ([170, 170, 185] as RGB) : SILK
    drawSilk(ctx, pose.thread, P, k, pose.tone === 'unknown' ? 0.35 * pose.alpha : pose.phase === 'back' || pose.phase === 'dock' ? 0.9 * pose.alpha : 0.7, silk)
    if (pose.phase === 'dock') dockRing(ctx, pose, P, k)
    if (pose.phase === 'working') { // at the node: a slow patrol so it reads as occupied, not frozen
      const a = pose.progress * Math.PI * 2, orbit = 15 * k
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(TONE.work, 0.25 + 0.2 * Math.sin(a)); ctx.lineWidth = Math.max(1, 1.5 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, (16 + 4 * Math.sin(a)) * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
      drawSpider(ctx, q.x + Math.cos(a) * orbit, q.y + Math.sin(a) * orbit * 0.6, a + Math.PI / 2, size, { tone: pose.tone, gait: t / 90, alpha: pose.alpha, moving: true, surface: pose.surface, glint })
      continue
    }
    if (pose.phase === 'unknown') { // unknown: a dim spider, still, ringed by a dashed line that does not pulse
      ctx.save(); ctx.strokeStyle = rgba(TONE.unknown, 0.5 * pose.alpha); ctx.setLineDash([3, 3]); ctx.lineWidth = Math.max(1, 1.3 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, 17 * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
    }
    // stalking is low and silent: no bob; a freeze stops the legs; a climb pitches the body
    drawSpider(ctx, q.x, q.y, pose.phase === 'dock' ? -Math.PI / 2 : pose.heading, pose.phase === 'dock' ? size * (1 - pose.progress * 0.5) : size, {
      tone: pose.tone, gait: t / (pose.tone === 'flag' ? 45 : 70), alpha: pose.alpha, moving: pose.moving, pitch: pose.pitch, surface: pose.surface, glint,
    })
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

/** Ambient life: hoppers, webs, the wall spider. No halo, no tag, no ledger: it claims nothing. Returns how many spiders were drawn. */
export function drawAmbient(ctx: CanvasRenderingContext2D, scene: AmbientScene, P: (p: Pt) => Pt, k: number, t: number, glint = 'rgba(255,255,255,0.9)', attend: Pt | null = null): number {
  for (const s of scene.silk) drawSilk(ctx, s.pts, P, k, s.alpha)
  const size = 21 * k + 7
  for (const sp of scene.spiders) {
    const q = P(sp)
    // attention: a resting spider turns its head toward what it is watching (the cursor if it moved lately, else the turning cube)
    const tilt = attend ? Math.max(-0.32, Math.min(0.32, (attend.x - sp.x) / 600)) : 0
    const surface: Surface = sp.kind === 'climber' ? 'wall' : 'floor'
    const look: SpiderLook = { gait: t / 80, alpha: 0.97, moving: sp.moving, lift: sp.lift * k, groom: sp.groom, morph: sp.id === 'hopper-2' ? 'red' : 'carneus', squash: sp.squash, surface, glint, tilt, pitch: sp.kind === 'climber' && sp.moving ? 0.5 : 0 }
    // At rest it turns to look back at the viewer (the face is what makes it a character); travelling, it is seen from above.
    if (!sp.moving && sp.lift <= 0 && (sp.action === 'idle' || sp.action === 'groom' || sp.action === 'rest')) drawSpiderFront(ctx, q.x, q.y, size * 1.15, look)
    else drawSpider(ctx, q.x, q.y, sp.heading, sp.kind === 'climber' ? size * 1.1 : size, look)
  }
  return scene.spiders.length
}
