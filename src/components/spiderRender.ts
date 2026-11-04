// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// The spiderlings, their look and the throne visual language are the owner's design; the visual targets are the reference
// photos in docs/spiderlings/reference/ (7511.jpg: Phidippus carneus; 7509.jpg: the red-cephalothorax morph).

/**
 * Jumping-spider renderer (v4), built to the owner's reference photos, not to an icon:
 *   - no outline anywhere: silhouettes are made of fur, and the edge on the lit side is RIM LIGHT (paler hair tips);
 *   - bodies are textured with hundreds of fine strands (abdomen red with dark speckle, a fuzzy white front band and white spots;
 *     cephalothorax black velvet with fuzzy white bands down its sides), shaded round by gradients;
 *   - legs are filled, tapered, muscular segments (femur, tibia, tarsus), short and thick, held CROUCHED: the femur rises from the
 *     body (foreshortened from above), the tibia comes down; pair I is the heaviest and is raised forward; nothing splays flat;
 *   - eyes are glossy black with a deep gleam and a sharp catchlight; chelicerae iridescent blue-green.
 * The hair pattern is a fixed hash per spider part (never Math.random), so the fur does not flicker. Static body fur is cached per
 * (morph, size) as Path2D; legs are rebuilt per frame because they move.
 */

export type Morph = 'carneus' | 'red' | 'ghost'
type RGB = [number, number, number]

interface Palette {
  abd: RGB; abdHi: RGB; abdLo: RGB; abdHair: RGB[]
  ceph: RGB; cephHi: RGB; cephLo: RGB; cephHair: RGB[]
  leg: RGB; legHi: RGB; legHair: RGB[]
  mark: RGB; rim: RGB
  stripe?: RGB
}
const PAL: Record<Morph, Palette> = {
  // 7511: black velvet body, white bands, bright red abdomen with white spots and dark speckle, black legs ringed silver
  carneus: {
    abd: [206, 38, 24], abdHi: [255, 118, 78], abdLo: [92, 8, 6], abdHair: [[236, 70, 44], [170, 24, 14], [120, 12, 8], [40, 8, 6]],
    ceph: [10, 10, 13], cephHi: [64, 66, 78], cephLo: [2, 2, 3], cephHair: [[46, 46, 54], [24, 24, 30], [86, 86, 96]],
    leg: [13, 13, 16], legHi: [70, 70, 82], legHair: [[52, 52, 60], [96, 96, 106], [214, 212, 204]],
    mark: [236, 234, 226], rim: [190, 192, 205],
  },
  // 7509: red-orange cephalothorax and abdomen (a dark median smudge), blue-black legs
  red: {
    abd: [222, 78, 32], abdHi: [255, 150, 92], abdLo: [118, 26, 10], abdHair: [[245, 110, 60], [196, 58, 22], [140, 34, 12], [34, 12, 10]],
    ceph: [214, 72, 30], cephHi: [255, 140, 88], cephLo: [110, 24, 10], cephHair: [[240, 104, 56], [182, 52, 22], [60, 18, 12]],
    leg: [14, 18, 32], legHi: [74, 92, 132], legHair: [[40, 50, 76], [86, 100, 140], [200, 204, 214]],
    mark: [235, 230, 222], rim: [255, 190, 150], stripe: [30, 10, 8],
  },
  // unknown: the same animal, greyed, so state is never read from colour alone
  ghost: {
    abd: [96, 92, 96], abdHi: [140, 138, 144], abdLo: [40, 40, 44], abdHair: [[120, 118, 124], [82, 80, 86], [54, 54, 58], [30, 30, 34]],
    ceph: [48, 50, 58], cephHi: [96, 98, 108], cephLo: [20, 20, 24], cephHair: [[70, 72, 80], [40, 42, 48], [110, 112, 120]],
    leg: [44, 46, 54], legHi: [96, 98, 108], legHair: [[70, 72, 80], [110, 112, 120], [160, 162, 170]],
    mark: [170, 172, 180], rim: [170, 172, 185],
  },
}

const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
/** Fixed hash to [0,1): the hair pattern of a part is the same every frame. */
const hh = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) }
/** Light comes from the top of the spider (its own frame), slightly forward: hairs facing it are rim-lit. */
const LIGHT = { x: 0.35, y: -0.94 }

// ---- strand fields --------------------------------------------------------------------------------------------------------------
type Buckets = Map<string, Path2D>
function strand(b: Buckets, color: string, x: number, y: number, dx: number, dy: number) {
  let p = b.get(color); if (!p) { p = new Path2D(); b.set(color, p) }
  p.moveTo(x, y); p.lineTo(x + dx, y + dy)
}
function strokeBuckets(ctx: CanvasRenderingContext2D, b: Buckets, width: number) {
  ctx.lineWidth = width; ctx.lineCap = 'round'
  for (const [color, p] of b) { ctx.strokeStyle = color; ctx.stroke(p) }
}

/** Fur over an ellipse: interior strands flowing backward (−x), and a rim of strands standing out from the edge. */
function furEllipse(b: Buckets, seed: number, cx: number, cy: number, rx: number, ry: number, s: number, interiorBase: number, rimBase: number, tones: RGB[], rimLight: RGB, alpha = 0.9, flow = Math.PI) {
  const dense = Math.min(5, Math.max(1, s / 40)), interior = Math.round(interiorBase * dense), rim = Math.round(rimBase * dense)
  for (let j = 0; j < interior; j++) {
    const r = Math.sqrt(hh(seed, j)) * 0.95, a = hh(seed + 1, j) * Math.PI * 2
    const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r
    const dir = flow + (hh(seed + 2, j) - 0.5) * 0.9, len = s * (0.018 + hh(seed + 3, j) * 0.028)
    strand(b, css(tones[Math.floor(hh(seed + 4, j) * tones.length)], alpha), x, y, Math.cos(dir) * len, Math.sin(dir) * len)
  }
  for (let j = 0; j < rim; j++) {
    const a = (j / rim) * Math.PI * 2 + (hh(seed + 5, j) - 0.5) * 0.12
    const nx = Math.cos(a), ny = Math.sin(a), x = cx + nx * rx * 0.96, y = cy + ny * ry * 0.96
    const lit = nx * LIGHT.x + ny * LIGHT.y, len = s * (0.02 + hh(seed + 6, j) * 0.035)
    const sweep = 0.35 * (hh(seed + 7, j) - 0.5)
    const color = lit > 0.25 ? css(rimLight, 0.55 + lit * 0.4) : css(tones[tones.length - 1], 0.85)
    strand(b, color, x, y, (nx + sweep * ny) * len, (ny - sweep * nx) * len)
  }
}

// ---- static body (cached) -------------------------------------------------------------------------------------------------------
interface BodyCache { draw: (ctx: CanvasRenderingContext2D) => void }
const bodyCache = new Map<string, BodyCache>()

/** Abdomen behind (−x), cephalothorax in front; both centred on the spider's own axis, size s = body length. */
function body(morph: Morph, s: number): BodyCache {
  const key = `${morph}:${Math.round(s * 4) / 4}`
  const hit = bodyCache.get(key); if (hit) return hit
  const P = PAL[morph]
  const AX = -s * 0.5, ARX = s * 0.44, ARY = s * 0.34 // abdomen
  const CX = s * 0.16, CRX = s * 0.34, CRY = s * 0.3 // cephalothorax
  const abdFur: Buckets = new Map(), cephFur: Buckets = new Map(), marks: Buckets = new Map(), rimFur: Buckets = new Map()
  furEllipse(abdFur, 11, AX, 0, ARX, ARY, s, 170, 0, P.abdHair, P.rim)
  furEllipse(rimFur, 13, AX, 0, ARX, ARY, s, 0, 70, P.abdHair, P.rim)
  furEllipse(cephFur, 21, CX, 0, CRX, CRY, s, 130, 0, P.cephHair, P.rim)
  furEllipse(rimFur, 23, CX, 0, CRX, CRY, s, 0, 56, P.cephHair, P.rim)
  const dense = Math.min(5, Math.max(1, s / 40))
  if (morph !== 'red') {
    // the fuzzy white band across the abdomen's front, and the white spots (each a tuft of strands)
    const nb = Math.round(46 * dense)
    for (let j = 0; j < nb; j++) {
      const a = -0.85 + (j / (nb - 1)) * 1.7, x = AX + Math.cos(a) * ARX * 0.86, y = Math.sin(a) * ARY * 0.86
      const len = s * (0.03 + hh(31, j) * 0.03), d = Math.PI + (hh(32, j) - 0.5) * 0.8
      strand(marks, css(P.mark, 0.9), x, y, Math.cos(d) * len, Math.sin(d) * len)
    }
    for (const [sx, sy] of [[-0.56, -0.08], [-0.56, 0.08], [-0.72, -0.13], [-0.72, 0.13], [-0.85, -0.05], [-0.85, 0.05]] as const) {
      for (let j = 0; j < Math.round(9 * dense); j++) {
        const a = hh(41 + sx * 10, j) * Math.PI * 2, len = s * (0.012 + hh(42, j) * 0.02)
        strand(marks, css(P.mark, 0.85), s * sx, s * sy, Math.cos(a) * len, Math.sin(a) * len)
      }
    }
    // fuzzy white bands down the sides of the cephalothorax (rear half)
    for (let j = 0; j < Math.round(60 * dense); j++) {
      const side = j % 2 ? 1 : -1, u = hh(51, j), a = side * (Math.PI * 0.55 + u * Math.PI * 0.35)
      const x = CX + Math.cos(a) * CRX * 0.9, y = Math.sin(a) * CRY * 0.9, len = s * (0.03 + hh(52, j) * 0.03)
      const d = a + Math.PI + (hh(53, j) - 0.5) * 0.7
      strand(marks, css(P.mark, 0.88), x, y, Math.cos(d) * len, Math.sin(d) * len)
    }
  }
  const draw = (ctx: CanvasRenderingContext2D) => {
    // abdomen: shaded round
    const ag = ctx.createRadialGradient(AX + s * 0.08, -s * 0.12, s * 0.03, AX, 0, ARX * 1.05)
    ag.addColorStop(0, css(P.abdHi)); ag.addColorStop(0.45, css(P.abd)); ag.addColorStop(1, css(P.abdLo))
    ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(AX, 0, ARX, ARY, 0, 0, Math.PI * 2); ctx.fill()
    if (P.stripe) { ctx.fillStyle = css(P.stripe, 0.55); ctx.beginPath(); ctx.ellipse(AX - s * 0.06, 0, ARX * 0.55, ARY * 0.2, 0, 0, Math.PI * 2); ctx.fill() }
    if (morph !== 'red') { // the white band across the abdomen's front and the spots: a soft base, the hair goes over it
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = css(P.mark, 0.8); ctx.lineWidth = s * 0.075
      ctx.beginPath(); ctx.ellipse(AX, 0, ARX * 0.86, ARY * 0.86, 0, -0.8, 0.8); ctx.stroke(); ctx.restore()
      ctx.fillStyle = css(P.mark, 0.75)
      for (const [sx, sy] of [[-0.56, -0.08], [-0.56, 0.08], [-0.72, -0.13], [-0.72, 0.13], [-0.85, -0.05], [-0.85, 0.05]] as const) { ctx.beginPath(); ctx.ellipse(s * sx, s * sy, s * 0.03, s * 0.022, 0, 0, Math.PI * 2); ctx.fill() }
    }
    strokeBuckets(ctx, abdFur, Math.max(0.35, s * 0.0045))
    // cephalothorax: velvet, shaded
    const cg = ctx.createRadialGradient(CX + s * 0.05, -s * 0.1, s * 0.02, CX, 0, CRX * 1.05)
    cg.addColorStop(0, css(P.cephHi)); cg.addColorStop(0.5, css(P.ceph)); cg.addColorStop(1, css(P.cephLo))
    ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(CX, 0, CRX, CRY, 0, 0, Math.PI * 2); ctx.fill()
    if (morph === 'red') { ctx.fillStyle = 'rgba(12,8,8,0.85)'; ctx.beginPath(); ctx.ellipse(CX + s * 0.18, 0, s * 0.13, s * 0.2, 0, 0, Math.PI * 2); ctx.fill() } // dark eye region
    else { // the broad white bands down the sides of the cephalothorax (rear half): soft base under the hair
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = css(P.mark, 0.78); ctx.lineWidth = s * 0.07
      ctx.beginPath(); ctx.ellipse(CX, 0, CRX * 0.86, CRY * 0.86, 0, Math.PI * 0.55, Math.PI * 1.45); ctx.stroke(); ctx.restore()
    }
    strokeBuckets(ctx, cephFur, Math.max(0.35, s * 0.0045))
    strokeBuckets(ctx, marks, Math.max(0.4, s * 0.0055))
    strokeBuckets(ctx, rimFur, Math.max(0.35, s * 0.0045))
    // eyes along the front edge, seen from above: two big anterior medians, laterals at the corners, posteriors behind
    const eye = (ex: number, ey: number, r: number) => {
      const g = ctx.createRadialGradient(ex + r * 0.25, ey - r * 0.25, r * 0.05, ex, ey, r)
      g.addColorStop(0, morph === 'ghost' ? 'rgb(90,90,96)' : 'rgb(46,40,30)'); g.addColorStop(0.55, 'rgb(6,6,8)'); g.addColorStop(1, 'rgb(1,1,2)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill()
      if (morph !== 'ghost') { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(ex + r * 0.3, ey - r * 0.32, Math.max(0.4, r * 0.24), 0, Math.PI * 2); ctx.fill() }
    }
    eye(CX + s * 0.27, -s * 0.085, s * 0.075); eye(CX + s * 0.27, s * 0.085, s * 0.075)
    eye(CX + s * 0.22, -s * 0.2, s * 0.04); eye(CX + s * 0.22, s * 0.2, s * 0.04)
    eye(CX + s * 0.02, -s * 0.23, s * 0.03); eye(CX + s * 0.02, s * 0.23, s * 0.03)
    // chelicerae, iridescent, just showing past the front edge
    if (morph !== 'ghost') {
      const ig = ctx.createLinearGradient(CX + s * 0.3, -s * 0.08, CX + s * 0.38, s * 0.08)
      ig.addColorStop(0, 'rgb(34,96,170)'); ig.addColorStop(0.5, 'rgb(52,170,150)'); ig.addColorStop(1, 'rgb(36,74,170)')
      ctx.fillStyle = ig; ctx.globalAlpha *= 0.55; ctx.beginPath(); ctx.ellipse(CX + s * 0.33, -s * 0.045, s * 0.028, s * 0.024, 0, 0, Math.PI * 2); ctx.ellipse(CX + s * 0.33, s * 0.045, s * 0.028, s * 0.024, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha /= 0.55
    }
  }
  const out = { draw }
  if (bodyCache.size > 64) bodyCache.clear()
  bodyCache.set(key, out)
  return out
}

// ---- legs -----------------------------------------------------------------------------------------------------------------------
/** A filled, tapered, shaded limb segment from a (width w0) to b (width w1): muscle, not a stroked tube. */
function limb(ctx: CanvasRenderingContext2D, P: Palette, ax: number, ay: number, bx: number, by: number, w0: number, w1: number) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  const bulge = 1.12 // a touch fuller in the middle
  const mx = ax + dx * 0.45, my = ay + dy * 0.45, wm = ((w0 + w1) / 2) * bulge
  const lit = nx * LIGHT.x + ny * LIGHT.y >= 0 ? 1 : -1
  const g = ctx.createLinearGradient(mx + nx * lit * wm / 2, my + ny * lit * wm / 2, mx - nx * lit * wm / 2, my - ny * lit * wm / 2)
  g.addColorStop(0, css(P.legHi)); g.addColorStop(0.35, css(P.leg)); g.addColorStop(1, css(P.leg))
  ctx.fillStyle = g
  // the side outline as one closed shape, then round joints as separate discs (an arc inside the path can wind the wrong way and punch a hole)
  ctx.beginPath()
  ctx.moveTo(ax + nx * w0 / 2, ay + ny * w0 / 2)
  ctx.quadraticCurveTo(mx + nx * wm / 2, my + ny * wm / 2, bx + nx * w1 / 2, by + ny * w1 / 2)
  ctx.lineTo(bx - nx * w1 / 2, by - ny * w1 / 2)
  ctx.quadraticCurveTo(mx - nx * wm / 2, my - ny * wm / 2, ax - nx * w0 / 2, ay - ny * w0 / 2)
  ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.arc(ax, ay, w0 / 2, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(bx, by, w1 / 2, 0, Math.PI * 2); ctx.fill()
}
/** A ring of pale hair across a limb between fractions u0..u1 (the joint bands of the reference). */
function limbBand(ctx: CanvasRenderingContext2D, color: string, ax: number, ay: number, bx: number, by: number, w0: number, w1: number, u0: number, u1: number) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  const at = (u: number, sd: number) => { const w = (w0 + (w1 - w0) * u) / 2 * 1.02; return [ax + dx * u + nx * sd * w, ay + dy * u + ny * sd * w] as const }
  const [p1, p2, p3, p4] = [at(u0, 1), at(u1, 1), at(u1, -1), at(u0, -1)]
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(...p2); ctx.lineTo(...p3); ctx.lineTo(...p4); ctx.closePath(); ctx.fill()
}
/** Hair on a segment: strands along both edges, swept toward the tip; silver ones in the joint band. */
function limbHair(b: Buckets, P: Palette, seed: number, ax: number, ay: number, bx: number, by: number, w0: number, w1: number, s: number, nBase: number, band: [number, number] | null) {
  const n = Math.round(nBase * 1.6 * Math.min(4, Math.max(1, s / 50)))
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, tx = dx / len, ty = dy / len
  for (let j = 0; j < n; j++) for (const sd of [-1, 1]) {
    const u = (j + hh(seed, j * 2 + sd)) / n, w = (w0 + (w1 - w0) * u) / 2
    const x = ax + dx * u + nx * sd * w * 0.8, y = ay + dy * u + ny * sd * w * 0.8
    const l = s * (0.022 + hh(seed + 1, j * 3 + sd) * 0.036), sweep = 0.55 + hh(seed + 2, j + sd) * 0.4
    const lit = nx * sd * LIGHT.x + ny * sd * LIGHT.y
    const inBand = band && u > band[0] && u < band[1]
    const c = inBand && P !== PAL.red ? css(P.mark, 0.95) : lit > 0.3 ? css(P.legHair[1], 0.8) : css(P.legHair[0], 0.9)
    strand(b, c, x, y, (nx * sd + tx * sweep) * l, (ny * sd + ty * sweep) * l)
  }
}

export interface RenderLook { gait: number; moving: boolean; groom?: boolean; morph?: Morph }

/**
 * Seen from above, local frame +x = forward. Crouched: each leg's femur rises from the body (short from above, because it points
 * up), the tibia comes back down to the ground further out; pair I is raised forward, heaviest; pair IV reaches back.
 */
export function renderJumperTop(ctx: CanvasRenderingContext2D, s: number, look: RenderLook) {
  const morph = look.morph ?? 'carneus', P = PAL[morph]
  // soft contact shadow
  const sg = ctx.createRadialGradient(-s * 0.15, s * 0.05, s * 0.1, -s * 0.15, s * 0.05, s * 0.95)
  sg.addColorStop(0, 'rgba(0,0,0,0.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(-s * 0.15, s * 0.05, s * 0.95, s * 0.7, 0, 0, Math.PI * 2); ctx.fill()
  const hair: Buckets = new Map()
  // legs, rear pair first so the front pair sits on top
  for (const i of [3, 2, 1, 0]) for (const side of [-1, 1]) {
    const phase = look.moving ? Math.sin(look.gait * 1.6 + (i % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0)) : 0
    const rootX = s * [0.28, 0.17, 0.06, -0.04][i], rootY = side * s * 0.2
    const ang = ([0.62, 1.05, 1.95, 2.45][i] + phase * 0.1) // from forward, radians (crouched: 35–60° front, 110–140° back)
    const femur = s * [0.3, 0.24, 0.24, 0.3][i] // short from above: it points up out of the body
    const tibia = s * [0.36, 0.28, 0.3, 0.38][i], tarsus = s * [0.16, 0.12, 0.13, 0.16][i]
    const kx = rootX + Math.cos(ang) * femur, ky = rootY + side * Math.sin(ang) * femur
    const a2 = ang + (i < 2 ? -0.22 : 0.18) - (i === 0 ? 0.18 : 0)
    const tx = kx + Math.cos(a2) * tibia, ty = ky + side * Math.sin(a2) * tibia
    const a3 = a2 + (i < 2 ? -0.15 : 0.12)
    const fx = tx + Math.cos(a3) * tarsus, fy = ty + side * Math.sin(a3) * tarsus
    const w = s * [0.2, 0.15, 0.15, 0.16][i]
    limb(ctx, P, rootX, rootY, kx, ky, w * 0.95, w * 1.05) // femur: thick, the bulge is the knee seen from above
    limb(ctx, P, kx, ky, tx, ty, w * 0.92, w * 0.62)
    limb(ctx, P, tx, ty, fx, fy, w * 0.55, w * 0.4)
    const band = morph === 'red' ? 'rgba(0,0,0,0)' : css(P.mark, 0.34)
    limbBand(ctx, band, rootX, rootY, kx, ky, w * 0.95, w * 1.05, 0.78, 0.98); limbBand(ctx, band, kx, ky, tx, ty, w * 0.92, w * 0.62, 0.6, 0.76)
    const seed = (side + 2) * 13 + i * 3
    limbHair(hair, P, seed, rootX, rootY, kx, ky, w * 0.95, w * 1.05, s, 6, [0.75, 1.01])
    limbHair(hair, P, seed + 40, kx, ky, tx, ty, w * 0.92, w * 0.62, s, 8, [0.62, 0.8])
    limbHair(hair, P, seed + 80, tx, ty, fx, fy, w * 0.55, w * 0.4, s, 4, null)
    // the dark claw tuft at the tip
    ctx.fillStyle = morph === 'red' ? css(P.legHair[2], 0.85) : css(P.leg); ctx.beginPath(); ctx.arc(fx, fy, w * 0.24, 0, Math.PI * 2); ctx.fill()
  }
  strokeBuckets(ctx, hair, Math.max(0.35, s * 0.0045))
  // palps: short, furry, pale-tipped; they twitch when it grooms
  const tw = look.groom ? Math.sin(look.gait * 2) * s * 0.03 : 0
  for (const side of [-1, 1]) {
    limb(ctx, P, s * 0.42, side * s * 0.1, s * 0.56, side * s * 0.12 + tw * side, s * 0.07, s * 0.08)
    ctx.fillStyle = css(P.legHair[2], 0.9); ctx.beginPath(); ctx.arc(s * 0.57, side * s * 0.12 + tw * side, s * 0.035, 0, Math.PI * 2); ctx.fill()
  }
  body(morph, s).draw(ctx)
}

/**
 * The same animal turned to look back at the viewer: crouched low, knees high (legs rise 45–65° from the ground before they come
 * down), pair I raised up in front; the huge anterior median eyes dominate the face; a fringe of pale hairs under them; iridescent
 * chelicerae; the red abdomen rising behind the head. Origin = the ground under the face.
 */
export function renderJumperFront(ctx: CanvasRenderingContext2D, s: number, look: RenderLook) {
  const morph = look.morph ?? 'carneus', P = PAL[morph]
  const breathe = look.groom ? Math.sin(look.gait * 2) * s * 0.015 : Math.sin(look.gait * 0.25) * s * 0.008
  const sg = ctx.createRadialGradient(0, 0, s * 0.1, 0, 0, s * 1.1)
  sg.addColorStop(0, 'rgba(0,0,0,0.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.1, s * 0.2, 0, 0, Math.PI * 2); ctx.fill()
  const headY = -s * 0.36 + breathe
  // abdomen behind, rising over the head
  const ab: Buckets = new Map()
  furEllipse(ab, 61, 0, headY - s * 0.3, s * 0.4, s * 0.24, s, 90, 40, P.abdHair, P.rim, 0.9, -Math.PI / 2)
  const ag = ctx.createRadialGradient(-s * 0.1, headY - s * 0.42, s * 0.02, 0, headY - s * 0.3, s * 0.42)
  ag.addColorStop(0, css(P.abdHi)); ag.addColorStop(0.5, css(P.abd)); ag.addColorStop(1, css(P.abdLo))
  ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(0, headY - s * 0.3, s * 0.4, s * 0.24, 0, 0, Math.PI * 2); ctx.fill()
  strokeBuckets(ctx, ab, Math.max(0.35, s * 0.0045))
  // legs: knee high, foot on the ground further out; pair I raised in front
  const hair: Buckets = new Map()
  for (const i of [3, 2, 1, 0]) for (const side of [-1, 1]) {
    const root = { x: side * s * (0.24 + i * 0.03), y: headY + s * (-0.02 + i * 0.07) }
    const rise = [65, 58, 52, 46][i] * Math.PI / 180 // the femur's angle above the ground
    const femur = s * [0.4, 0.42, 0.46, 0.5][i]
    const knee = { x: root.x + side * Math.cos(rise) * femur, y: root.y - Math.sin(rise) * femur }
    const foot = i === 0
      ? { x: knee.x + side * s * 0.08, y: knee.y - s * 0.12 } // pair I held up and forward
      : { x: knee.x + side * s * (0.1 + i * 0.1), y: -s * 0.02 }
    const tip = i === 0 ? { x: foot.x + side * s * 0.04, y: foot.y - s * 0.06 } : { x: foot.x + side * s * 0.05, y: 0 }
    const w = s * [0.2, 0.16, 0.16, 0.16][i]
    limb(ctx, P, root.x, root.y, knee.x, knee.y, w, w * 1.04)
    limb(ctx, P, knee.x, knee.y, foot.x, foot.y, w * 0.95, w * 0.6)
    limb(ctx, P, foot.x, foot.y, tip.x, tip.y, w * 0.55, w * 0.42)
    const band = morph === 'red' ? 'rgba(0,0,0,0)' : css(P.mark, 0.32)
    limbBand(ctx, band, root.x, root.y, knee.x, knee.y, w, w * 1.04, 0.8, 0.98); limbBand(ctx, band, knee.x, knee.y, foot.x, foot.y, w * 0.95, w * 0.6, 0.55, 0.7)
    const seed = (side + 2) * 17 + i * 5
    limbHair(hair, P, seed, root.x, root.y, knee.x, knee.y, w, w * 1.04, s, 7, [0.78, 1.01])
    limbHair(hair, P, seed + 40, knee.x, knee.y, foot.x, foot.y, w * 0.95, w * 0.6, s, 7, [0.55, 0.72])
  }
  strokeBuckets(ctx, hair, Math.max(0.35, s * 0.0045))
  // the face
  const face: Buckets = new Map()
  furEllipse(face, 71, 0, headY, s * 0.36, s * 0.3, s, 120, 60, P.cephHair, P.rim, 0.9, Math.PI / 2)
  const hg = ctx.createRadialGradient(-s * 0.08, headY - s * 0.12, s * 0.02, 0, headY, s * 0.4)
  hg.addColorStop(0, css(P.cephHi)); hg.addColorStop(0.55, css(P.ceph)); hg.addColorStop(1, css(P.cephLo))
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(0, headY, s * 0.36, s * 0.3, 0, 0, Math.PI * 2); ctx.fill()
  strokeBuckets(ctx, face, Math.max(0.35, s * 0.0045))
  if (morph !== 'ghost') {
    // pale fringe under the eyes and at the cheeks: strands, not a shape
    const fr: Buckets = new Map()
    for (let j = 0; j < 70; j++) {
      const u = hh(81, j) * 2 - 1, x = u * s * 0.3, y = headY + s * (0.07 + Math.abs(u) * 0.05) + hh(82, j) * s * 0.04
      const d = Math.PI / 2 + (hh(83, j) - 0.5) * 0.8, l = s * (0.03 + hh(84, j) * 0.04)
      strand(fr, css(P.mark, 0.85), x, y, Math.cos(d) * l, Math.sin(d) * l)
    }
    strokeBuckets(ctx, fr, Math.max(0.35, s * 0.005))
  }
  // eyes: the anterior medians dominate the face; glossy black, a deep gleam, a sharp catchlight
  const eye = (ex: number, ey: number, r: number) => {
    const g = ctx.createRadialGradient(ex - r * 0.2, ey - r * 0.2, r * 0.05, ex, ey, r)
    g.addColorStop(0, morph === 'ghost' ? 'rgb(90,90,96)' : 'rgb(58,48,30)'); g.addColorStop(0.5, 'rgb(8,8,10)'); g.addColorStop(1, 'rgb(1,1,2)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill()
    if (morph !== 'ghost') {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(ex - r * 0.32, ey - r * 0.34, Math.max(0.5, r * 0.22), 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(ex + r * 0.34, ey + r * 0.3, Math.max(0.3, r * 0.09), 0, Math.PI * 2); ctx.fill()
    }
  }
  eye(-s * 0.12, headY - s * 0.03, s * 0.13); eye(s * 0.12, headY - s * 0.03, s * 0.13)
  eye(-s * 0.29, headY - s * 0.08, s * 0.055); eye(s * 0.29, headY - s * 0.08, s * 0.055)
  if (morph !== 'ghost') {
    const ig = ctx.createLinearGradient(-s * 0.12, headY + s * 0.14, s * 0.12, headY + s * 0.3)
    ig.addColorStop(0, 'rgb(30,92,176)'); ig.addColorStop(0.5, 'rgb(48,170,152)'); ig.addColorStop(1, 'rgb(34,70,170)')
    ctx.fillStyle = ig
    ctx.beginPath(); ctx.ellipse(-s * 0.07, headY + s * 0.22, s * 0.065, s * 0.09, 0.12, 0, Math.PI * 2); ctx.ellipse(s * 0.07, headY + s * 0.22, s * 0.065, s * 0.09, -0.12, 0, Math.PI * 2); ctx.fill()
    // palps
    const tw = look.groom ? Math.sin(look.gait * 2) * s * 0.03 : 0
    for (const side of [-1, 1]) {
      limb(ctx, P, side * s * 0.17, headY + s * 0.18, side * s * 0.2, headY + s * 0.34 + tw * side, s * 0.07, s * 0.08)
      ctx.fillStyle = css(P.legHair[2], 0.9); ctx.beginPath(); ctx.arc(side * s * 0.2, headY + s * 0.35 + tw * side, s * 0.035, 0, Math.PI * 2); ctx.fill()
    }
  }
}
