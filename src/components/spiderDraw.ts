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
import { CHEST, poseOf, type AnchorSet, type Pose, type PoseTone, type Pt } from './spiderRoutes'

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
}

/**
 * A jumping spider at (x, y) on the ground, facing `heading`, `size` px long, drawn from above after the owner's reference
 * (Phidippus carneus): a big bright-red abdomen with a white front band and white chevron spots, a glossy black cephalothorax
 * edged with white bands, thick hairy black legs (fine bristles in a fixed pattern, no outline stroke) banded white at the joints (the front pair heaviest, held forward), large
 * forward eyes, and iridescent blue-green chelicerae.
 */
export function drawSpider(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number, look: SpiderLook) {
  const s = size, lift = look.lift ?? 0, unknown = look.tone === 'unknown'
  ctx.save()
  ctx.globalAlpha = look.alpha
  if (lift > 0.5) { // shadow on the ground, smaller and fainter the higher it is
    ctx.fillStyle = `rgba(0,0,0,${(0.4 / (1 + lift / (s * 1.4))).toFixed(3)})`
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.15, s * 0.6 / (1 + lift / (s * 3)), s * 0.22 / (1 + lift / (s * 3)), 0, 0, Math.PI * 2); ctx.fill()
  }
  if (look.tone && !unknown) { // the halo is the state, and only a spider that carries state has one
    const c = TONE[look.tone], g = ctx.createRadialGradient(x, y - lift, 0, x, y - lift, s * 1.6)
    g.addColorStop(0, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - lift, s * 1.6, 0, Math.PI * 2); ctx.fill()
  }
  ctx.translate(x, y - lift); ctx.rotate(heading)
  const black = unknown ? 'rgb(48,50,60)' : 'rgb(12,12,16)'
  const white = unknown ? 'rgba(150,152,165,0.7)' : 'rgba(240,240,236,0.95)'
  const red = unknown ? 'rgb(92,86,90)' : 'rgb(226,48,30)'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'

  // Fixed hair pattern: a hash of (part, index), never Math.random, so the fur does not flicker from frame to frame.
  const hh = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) }
  /** Fine bristles along a segment, both sides, swept back toward `from`; pale ones where `pale(u)` says so. */
  const bristles = (ax: number, ay: number, bx: number, by: number, half: number, seed: number, n: number, pale: (u: number) => boolean) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, tx = dx / len, ty = dy / len
    const dark = new Path2D(), light = new Path2D()
    for (let j = 0; j < n; j++) for (const sd of [-1, 1]) {
      const u = (j + 0.5 + (hh(seed, j * 2 + sd) - 0.5) * 0.6) / n
      const px = ax + dx * u + nx * sd * half * 0.85, py = ay + dy * u + ny * sd * half * 0.85
      const l = s * (0.028 + hh(seed + 3, j * 2 + sd) * 0.03), back = 0.5 + hh(seed + 7, j + sd) * 0.45
      const path = pale(u) ? light : dark
      path.moveTo(px, py); path.lineTo(px + (nx * sd - tx * back) * l, py + (ny * sd - ty * back) * l)
    }
    ctx.lineWidth = Math.max(0.45, s * 0.012)
    ctx.strokeStyle = unknown ? 'rgba(90,92,104,0.7)' : 'rgba(70,70,80,0.85)'; ctx.stroke(dark)
    ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.5)' : 'rgba(225,225,220,0.7)'; ctx.stroke(light)
  }

  // Legs first (under the body). Four a side, thick and tapering: femur, then tibia/tarsus; pair I heaviest and held forward.
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 4; i++) {
      const phase = look.moving ? Math.sin(look.gait * 1.6 + (i % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0)) : 0
      const rootX = s * (0.24 - i * 0.12), rootY = side * s * 0.14
      const ang = [0.32, 0.98, 1.85, 2.45][i] + phase * 0.12 // from forward, radians
      const l1 = s * [0.66, 0.56, 0.56, 0.68][i], l2 = s * [0.66, 0.58, 0.62, 0.76][i]
      const kx = rootX + Math.cos(ang) * l1, ky = rootY + side * Math.sin(ang) * l1
      const bend = ang + (i < 2 ? -0.35 : 0.35) - (i === 0 ? 0.25 : 0)
      const fx = kx + Math.cos(bend) * l2, fy = ky + side * Math.sin(bend) * l2
      const w1 = s * (i === 0 ? 0.2 : 0.165), w2 = w1 * 0.74
      const seed = (side + 2) * 10 + i
      bristles(rootX, rootY, kx, ky, w1 / 2, seed, 12, u => u > 0.8)
      bristles(kx, ky, fx, fy, w2 / 2, seed + 50, 12, u => u > 0.58 && u < 0.74)
      ctx.strokeStyle = black
      ctx.lineWidth = w1; ctx.beginPath(); ctx.moveTo(rootX, rootY); ctx.lineTo(kx, ky); ctx.stroke()
      ctx.lineWidth = w2; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke()
      if (!unknown) { // a soft highlight along the top of each segment, so the leg reads round, not flat
        ctx.strokeStyle = 'rgba(120,126,145,0.32)'
        const hl = (ax: number, ay: number, bx: number, by: number, w: number) => { const len = Math.hypot(bx - ax, by - ay) || 1, ox = (-(by - ay) / len) * w * 0.22 * -side, oy = ((bx - ax) / len) * w * 0.22 * -side; ctx.lineWidth = w * 0.3; ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.lineTo(bx + ox, by + oy); ctx.stroke() }
        hl(rootX, rootY, kx, ky, w1); hl(kx, ky, fx, fy, w2)
      }
      // white rings across the full leg width: near the knee and on the lower leg
      ctx.save(); ctx.lineCap = 'butt'; ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.55)' : 'rgba(232,232,228,0.88)'
      const band = (ax: number, ay: number, bx: number, by: number, u: number, w: number) => { const px = ax + (bx - ax) * u, py = ay + (by - ay) * u, dx = (bx - ax) * 0.05, dy = (by - ay) * 0.05; ctx.lineWidth = w * 0.98; ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke() }
      band(rootX, rootY, kx, ky, 0.86, w1); band(kx, ky, fx, fy, 0.66, w2)
      ctx.restore()
    }
  }
  // Abdomen: big, bright red, shaded round, furred (speckle and a bristle fringe), a white band at its front, white chevron spots.
  const AX = -s * 0.6, ARX = s * 0.42, ARY = s * 0.32
  // fringe first, so the body covers the roots of the hairs
  const fringe = new Path2D(), fringeLight = new Path2D()
  for (let j = 0; j < 34; j++) {
    const a = (j / 34) * Math.PI * 2 + (hh(901, j) - 0.5) * 0.15, l = s * (0.04 + hh(902, j) * 0.05)
    const px = AX + Math.cos(a) * ARX * 0.97, py = Math.sin(a) * ARY * 0.97
    const path = Math.cos(a) > 0.72 ? fringeLight : fringe
    path.moveTo(px, py); path.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l)
  }
  ctx.lineWidth = Math.max(0.55, s * 0.018)
  ctx.strokeStyle = unknown ? 'rgba(100,96,100,0.8)' : 'rgba(170,30,20,0.95)'; ctx.stroke(fringe)
  ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.6)' : 'rgba(240,240,236,0.9)'; ctx.stroke(fringeLight)
  ctx.fillStyle = red
  ctx.beginPath(); ctx.ellipse(AX, 0, ARX, ARY, 0, 0, Math.PI * 2); ctx.fill()
  if (!unknown) {
    const shade = ctx.createRadialGradient(AX + s * 0.06, -s * 0.1, s * 0.04, AX, 0, ARX)
    shade.addColorStop(0, 'rgba(255,150,120,0.42)'); shade.addColorStop(0.55, 'rgba(255,90,60,0)'); shade.addColorStop(1, 'rgba(70,0,0,0.6)')
    ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(AX, 0, ARX, ARY, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(70,6,4,0.55)' // the fine dark speckle of the reference's red fur
    for (let j = 0; j < 30; j++) {
      const r = Math.sqrt(hh(903, j)) * 0.85, a = hh(904, j) * Math.PI * 2
      ctx.beginPath(); ctx.arc(AX + Math.cos(a) * ARX * r, Math.sin(a) * ARY * r, Math.max(0.4, s * 0.011), 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.save(); ctx.lineCap = 'butt'; ctx.strokeStyle = white; ctx.lineWidth = s * 0.065
  ctx.beginPath(); ctx.ellipse(AX, 0, ARX * 0.9, ARY * 0.88, 0, -0.75, 0.75); ctx.stroke() // the front band, facing the head
  ctx.restore()
  ctx.fillStyle = white
  for (const [dx, dy] of [[-0.58, -0.07], [-0.58, 0.07], [-0.74, -0.12], [-0.74, 0.12], [-0.88, -0.05], [-0.88, 0.05]] as const) {
    ctx.beginPath(); ctx.ellipse(s * dx, s * dy, s * 0.03, s * 0.022, 0, 0, Math.PI * 2); ctx.fill()
  }
  // Cephalothorax: squarish, black, shaded round, a short bristle fringe, white bands down its sides.
  const head = new Path2D(), headLight = new Path2D()
  for (let j = 0; j < 26; j++) {
    const a = (j / 26) * Math.PI * 2 + (hh(905, j) - 0.5) * 0.2, l = s * (0.035 + hh(906, j) * 0.04)
    const px = s * 0.09 + Math.cos(a) * s * 0.38, py = Math.sin(a) * s * 0.34
    const path = Math.cos(a) > 0.8 ? headLight : head
    path.moveTo(px, py); path.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l)
  }
  ctx.lineWidth = Math.max(0.55, s * 0.018)
  ctx.strokeStyle = unknown ? 'rgba(90,92,104,0.8)' : 'rgba(58,58,66,0.95)'; ctx.stroke(head)
  ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.6)' : 'rgba(236,236,230,0.9)'; ctx.stroke(headLight)
  const headFill = unknown ? black : (() => { const g = ctx.createRadialGradient(s * 0.14, -s * 0.08, s * 0.02, s * 0.09, 0, s * 0.48); g.addColorStop(0, 'rgb(52,54,66)'); g.addColorStop(0.6, 'rgb(14,14,19)'); g.addColorStop(1, 'rgb(4,4,6)'); return g })()
  ctx.fillStyle = headFill
  ctx.beginPath(); ctx.roundRect(s * -0.3, -s * 0.35, s * 0.78, s * 0.7, s * 0.24); ctx.fill()
  ctx.save(); ctx.lineCap = 'butt'; ctx.strokeStyle = white; ctx.lineWidth = s * 0.085
  ctx.beginPath(); ctx.ellipse(s * 0.08, 0, s * 0.34, s * 0.29, 0, Math.PI * 0.58, Math.PI * 1.42); ctx.stroke() // the broad white band round the back of the head
  ctx.restore()
  if (!unknown) {
    // Eyes along the front edge: two big anterior medians, smaller laterals; then the iridescent chelicerae and the palps.
    const eye = (ex: number, ey: number, r: number) => {
      ctx.fillStyle = 'rgb(3,4,6)'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(ex + r * 0.25, ey - r * 0.3, Math.max(0.5, r * 0.3), 0, Math.PI * 2); ctx.fill()
    }
    eye(s * 0.37, -s * 0.09, s * 0.085); eye(s * 0.37, s * 0.09, s * 0.085)
    eye(s * 0.33, -s * 0.21, s * 0.045); eye(s * 0.33, s * 0.21, s * 0.045)
    const iri = ctx.createLinearGradient(s * 0.44, -s * 0.1, s * 0.52, s * 0.1)
    iri.addColorStop(0, 'rgb(40,120,190)'); iri.addColorStop(0.5, 'rgb(60,200,170)'); iri.addColorStop(1, 'rgb(40,90,200)')
    ctx.fillStyle = iri
    ctx.beginPath(); ctx.ellipse(s * 0.47, -s * 0.06, s * 0.06, s * 0.05, 0, 0, Math.PI * 2); ctx.ellipse(s * 0.47, s * 0.06, s * 0.06, s * 0.05, 0, 0, Math.PI * 2); ctx.fill()
    const wiggle = look.groom ? Math.sin(look.gait * 2) * 0.2 : 0 // pedipalps, white-tipped; they move when it grooms
    ctx.strokeStyle = black; ctx.lineWidth = s * 0.07
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 0.4, side * s * 0.14); ctx.lineTo(s * 0.55, side * s * (0.15 + wiggle * side)); ctx.stroke() }
    ctx.fillStyle = white
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 0.56, side * s * (0.15 + wiggle * side), s * 0.035, 0, Math.PI * 2); ctx.fill() }
  }
  ctx.restore()
}

/**
 * The same spider turned to look back at the viewer: what makes a jumping spider a character rather than an arthropod. Two huge
 * anterior median eyes dominate the face (glossy, a dark-green ring, a bright catchlight), smaller laterals beside them, a white
 * "moustache" fringe under the eyes, iridescent blue-green chelicerae, fuzzy white-tipped palps, the red abdomen rising behind the
 * head, and eight thick banded legs planted wide in an alert stance. Fuzz: a fixed pattern of fine hairs round every edge.
 */
export function drawSpiderFront(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, look: SpiderLook) {
  const s = size * 0.9, unknown = look.tone === 'unknown'
  const hh = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) }
  const black = unknown ? 'rgb(48,50,60)' : 'rgb(12,12,16)'
  const white = unknown ? 'rgba(150,152,165,0.7)' : 'rgba(240,240,236,0.95)'
  const breathe = look.groom ? Math.sin(look.gait * 2) * 0.02 : Math.sin(look.gait * 0.25) * 0.012
  ctx.save(); ctx.globalAlpha = look.alpha; ctx.translate(x, y - s * 0.25); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (look.tone && !unknown) {
    const c = TONE[look.tone], g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.5)
    g.addColorStop(0, rgba(c, 0.4)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2); ctx.fill()
  }
  // shadow under the stance
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, s * 0.5, s * 0.85, s * 0.14, 0, 0, Math.PI * 2); ctx.fill()
  const fuzz = (cx: number, cy: number, rx: number, ry: number, n: number, seed: number, len: number, pale: (a: number) => boolean) => {
    const dark = new Path2D(), light = new Path2D()
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (hh(seed, j) - 0.5) * 0.2, l = s * len * (0.6 + hh(seed + 1, j) * 0.8)
      const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry, path = pale(a) ? light : dark
      path.moveTo(px, py); path.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l)
    }
    ctx.lineWidth = Math.max(0.45, s * 0.013)
    ctx.strokeStyle = unknown ? 'rgba(90,92,104,0.7)' : 'rgba(80,80,90,0.85)'; ctx.stroke(dark)
    ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.5)' : 'rgba(228,228,222,0.8)'; ctx.stroke(light)
  }
  // abdomen, red, rising behind the head
  if (!unknown) fuzz(0, -s * 0.36, s * 0.42, s * 0.24, 30, 701, 0.05, () => false)
  ctx.fillStyle = unknown ? 'rgb(92,86,90)' : 'rgb(226,48,30)'
  ctx.beginPath(); ctx.ellipse(0, -s * 0.36, s * 0.42, s * 0.24, 0, Math.PI, 0); ctx.fill()
  if (!unknown) { ctx.strokeStyle = white; ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.ellipse(0, -s * 0.3, s * 0.4, s * 0.16, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke() }
  // legs: four a side, thick, planted wide; knee up, foot down — the alert stance
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    // spread fan: pair I reaches forward-out and high, pair IV back-out and low; each foot on its own spot
    const rx = side * s * (0.28 + i * 0.03), ry = s * (-0.06 + i * 0.07)
    const kx = side * s * [0.5, 0.72, 0.9, 1.02][i], ky = -s * [0.42, 0.3, 0.16, 0.02][i]
    const fx = side * s * [0.56, 0.86, 1.12, 1.3][i], fy = s * [0.5, 0.48, 0.44, 0.38][i]
    const w = s * (i === 0 ? 0.15 : 0.12)
    const leg = new Path2D(); leg.moveTo(rx, ry); leg.quadraticCurveTo(kx, ky - s * 0.08, kx, ky); leg.lineTo(fx, fy)
    ctx.strokeStyle = unknown ? 'rgba(120,120,130,0.2)' : 'rgba(200,200,210,0.16)'; ctx.lineWidth = w + s * 0.05; ctx.stroke(leg)
    ctx.strokeStyle = black; ctx.lineWidth = w; ctx.stroke(leg)
    ctx.save(); ctx.lineCap = 'butt'; ctx.strokeStyle = unknown ? 'rgba(150,152,165,0.55)' : 'rgba(232,232,228,0.85)'; ctx.lineWidth = w * 0.98
    const u = 0.55, bx = kx + (fx - kx) * u, by = ky + (fy - ky) * u, dx = (fx - kx) * 0.05, dy = (fy - ky) * 0.05
    ctx.beginPath(); ctx.moveTo(bx - dx, by - dy); ctx.lineTo(bx + dx, by + dy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(kx - (kx - rx) * 0.05, ky); ctx.lineTo(kx + (fx - kx) * 0.05, ky + (fy - ky) * 0.05); ctx.stroke(); ctx.restore()
  }
  // head: a broad, fuzzy, shaded face
  fuzz(0, -s * 0.02, s * 0.4, s * 0.34, 44, 703, 0.06, a => Math.sin(a) > 0.35)
  const hg = ctx.createRadialGradient(-s * 0.08, -s * 0.12, s * 0.02, 0, 0, s * 0.46)
  hg.addColorStop(0, unknown ? 'rgb(70,72,82)' : 'rgb(58,60,72)'); hg.addColorStop(0.65, black); hg.addColorStop(1, 'rgb(4,4,6)')
  ctx.fillStyle = hg; ctx.beginPath(); ctx.roundRect(-s * 0.4, -s * 0.36 + breathe * s, s * 0.8, s * 0.68, s * 0.26); ctx.fill()
  if (!unknown) {
    // white "moustache" under the eyes
    ctx.fillStyle = 'rgba(236,236,230,0.9)'; ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.3, s * 0.07, 0, 0, Math.PI * 2); ctx.fill()
    fuzz(0, s * 0.12, s * 0.3, s * 0.07, 24, 705, 0.035, () => true)
    // the eyes: two huge anterior medians, two smaller laterals
    const eye = (ex: number, ey: number, r: number) => {
      ctx.fillStyle = 'rgb(2,3,5)'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(55,120,95,0.75)'; ctx.lineWidth = Math.max(0.6, r * 0.22); ctx.beginPath(); ctx.arc(ex, ey, r * 0.72, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(ex - r * 0.3, ey - r * 0.35, Math.max(0.6, r * 0.26), 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(ex + r * 0.32, ey + r * 0.3, Math.max(0.4, r * 0.11), 0, Math.PI * 2); ctx.fill()
    }
    eye(-s * 0.13, -s * 0.07, s * 0.15); eye(s * 0.13, -s * 0.07, s * 0.15)
    eye(-s * 0.33, -s * 0.12, s * 0.065); eye(s * 0.33, -s * 0.12, s * 0.065)
    // chelicerae, iridescent
    const iri = ctx.createLinearGradient(-s * 0.15, s * 0.18, s * 0.15, s * 0.36)
    iri.addColorStop(0, 'rgb(40,110,200)'); iri.addColorStop(0.5, 'rgb(60,200,175)'); iri.addColorStop(1, 'rgb(40,80,190)')
    ctx.fillStyle = iri; ctx.beginPath(); ctx.ellipse(-s * 0.08, s * 0.27, s * 0.075, s * 0.1, 0.1, 0, Math.PI * 2); ctx.ellipse(s * 0.08, s * 0.27, s * 0.075, s * 0.1, -0.1, 0, Math.PI * 2); ctx.fill()
    // palps: fuzzy, white-tipped, they twitch when it grooms
    for (const side of [-1, 1]) {
      const tw = look.groom ? Math.sin(look.gait * 2 + side) * s * 0.04 : 0
      ctx.strokeStyle = black; ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(side * s * 0.2, s * 0.2); ctx.lineTo(side * s * 0.24, s * 0.38 + tw); ctx.stroke()
      ctx.fillStyle = white; ctx.beginPath(); ctx.arc(side * s * 0.24, s * 0.4 + tw, s * 0.05, 0, Math.PI * 2); ctx.fill()
    }
  }
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
    const q = P(pose), size = 24 * k + 8
    // the dragline: silver silk behind the spider; red when it is flagged (the owner's "red thread"); faint grey when unknown
    const silk = pose.tone === 'flag' && (pose.phase === 'back' || pose.phase === 'dock') ? ([255, 80, 92] as RGB) : pose.tone === 'unknown' ? ([170, 170, 185] as RGB) : SILK
    drawSilk(ctx, pose.thread, P, k, pose.tone === 'unknown' ? 0.35 * pose.alpha : pose.phase === 'back' || pose.phase === 'dock' ? 0.9 * pose.alpha : 0.7, silk)
    if (pose.phase === 'dock') dockRing(ctx, pose, P, k)
    if (pose.phase === 'working') { // at the node: a slow patrol so it reads as occupied, not frozen
      const a = pose.progress * Math.PI * 2, orbit = 15 * k
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(TONE.work, 0.25 + 0.2 * Math.sin(a)); ctx.lineWidth = Math.max(1, 1.5 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, (16 + 4 * Math.sin(a)) * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
      drawSpider(ctx, q.x + Math.cos(a) * orbit, q.y + Math.sin(a) * orbit * 0.6, a + Math.PI / 2, size, { tone: pose.tone, gait: t / 90, alpha: pose.alpha, moving: true })
      continue
    }
    if (pose.phase === 'unknown') { // unknown: a dim spider, still, ringed by a dashed line that does not pulse
      ctx.save(); ctx.strokeStyle = rgba(TONE.unknown, 0.5 * pose.alpha); ctx.setLineDash([3, 3]); ctx.lineWidth = Math.max(1, 1.3 * k)
      ctx.beginPath(); ctx.arc(q.x, q.y, 17 * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
    }
    const travelling = pose.phase === 'out' || pose.phase === 'back'
    drawSpider(ctx, q.x, q.y, pose.phase === 'dock' ? -Math.PI / 2 : pose.heading, pose.phase === 'dock' ? size * (1 - pose.progress * 0.5) : size, {
      tone: pose.tone, gait: t / 70, alpha: pose.alpha, moving: travelling, lift: travelling ? Math.abs(Math.sin(t / 150)) * 3.5 * k : 0,
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
export function drawAmbient(ctx: CanvasRenderingContext2D, scene: AmbientScene, P: (p: Pt) => Pt, k: number, t: number): number {
  for (const s of scene.silk) drawSilk(ctx, s.pts, P, k, s.alpha)
  const size = 21 * k + 7
  for (const sp of scene.spiders) {
    const q = P(sp)
    const look = { gait: t / 80, alpha: 0.95, moving: sp.moving, lift: sp.lift * k, groom: sp.groom }
    // At rest it turns to look back at the viewer (the face is what makes it a character); travelling, it is seen from above.
    if (!sp.moving && sp.lift <= 0 && (sp.action === 'idle' || sp.action === 'groom' || sp.action === 'rest')) drawSpiderFront(ctx, q.x, q.y, size * 1.15, look)
    else drawSpider(ctx, q.x, q.y, sp.heading, sp.kind === 'climber' ? size * 1.1 : size, look)
  }
  return scene.spiders.length
}
