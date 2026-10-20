// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * cube3d — 3D Rubik's cube renderer for the neural network background.
 * Perspective projection, painter's algorithm, back-face culling, 3x3
 * stickers drawn as perspective quads on each visible face (they skew and
 * foreshorten with the face, like the big cube), cross-face scrambles, and an
 * explode effect that sends every sticker outward along its face normal.
 *
 * Emotion (spin, wobble, glow, flash, jitter, explode) comes from cubeLook()
 * in cubeMotion.ts, driven by the reactive core — this file only draws.
 * Pure canvas paths: no roundRect (missing on Chrome/WebView < 99, Safari < 16).
 */

import type { Axis, Cubie, Move, Normal } from './rubikModel'

export type FaceKey = 'U' | 'D' | 'F' | 'B' | 'L' | 'R'
export type CubeFaces = Record<FaceKey, string[]>

export interface Cube3DState {
  faces: CubeFaces
  /** Radians. */
  rotation: { x: number; y: number; z: number }
  /** 0..1 how far stickers have flown outward. */
  explode: number
}

export interface CubeAppearance {
  /** 0..1 */
  glow: number
  glowColor: { r: number; g: number; b: number }
  /** Colored flash over the cube, or null. */
  flash: { color: { r: number; g: number; b: number }; alpha: number } | null
}

/** Minimum drawn cube size in px (Muse #123 set 24; directive asked 60 — pending Cristian). */
export const MIN_CUBE_PX = 24

const FACE_ORDER: readonly FaceKey[] = ['U', 'D', 'F', 'B', 'L', 'R']
const FACE_COLORS: Record<FaceKey, string> = {
  U: '#ffffff', D: '#ffcf00', F: '#34c759', B: '#0a84ff', L: '#ff9500', R: '#ff3b30',
}

export function solvedCubeFaces(): CubeFaces {
  const f = {} as CubeFaces
  for (const k of FACE_ORDER) f[k] = Array(9).fill(FACE_COLORS[k])
  return f
}

/**
 * Scramble with cross-face swaps (realistic mixing; within-face swaps are a
 * no-op on a solved cube). Deterministic for a given seed.
 */
export function scrambleFaces(faces: CubeFaces, amount: number, seed: number): CubeFaces {
  const flat = FACE_ORDER.flatMap(k => faces[k])
  const rand = (s: number) => { const x = Math.sin(s * 137.5 + 0.5) * 10000; return x - Math.floor(x) }
  const swaps = Math.round(Math.min(1, Math.max(0, amount)) * flat.length)
  for (let i = 0; i < swaps; i++) {
    const a = Math.floor(rand(seed * 101 + i) * flat.length)
    const b = Math.floor(rand(seed * 101 + i + 1000) * flat.length)
    ;[flat[a], flat[b]] = [flat[b], flat[a]]
  }
  const out = {} as CubeFaces
  FACE_ORDER.forEach((k, i) => { out[k] = flat.slice(i * 9, i * 9 + 9) })
  return out
}

/** True when every one of the given faces is a single color. */
export function looksSolved(faces: CubeFaces, keys: readonly FaceKey[] = FACE_ORDER): boolean {
  return keys.every(k => faces[k].every(c => c === faces[k][0]))
}

const facesCache = new Map<number, CubeFaces>()
/** Cached faces: variant 0 = solved, 1..n = scrambles. No per-frame allocation. */
export function cubeFacesVariant(variant: number): CubeFaces {
  let f = facesCache.get(variant)
  if (!f) {
    f = variant === 0 ? solvedCubeFaces() : scrambleFaces(solvedCubeFaces(), 0.6, variant)
    facesCache.set(variant, f)
  }
  return f
}

type V3 = [number, number, number]
type P2 = { x: number; y: number }

function rotate([x, y, z]: V3, rx: number, ry: number, rz: number): V3 {
  const x1 = x * Math.cos(ry) - z * Math.sin(ry)
  const z1 = x * Math.sin(ry) + z * Math.cos(ry)
  const y1 = y * Math.cos(rx) - z1 * Math.sin(rx)
  const z2 = y * Math.sin(rx) + z1 * Math.cos(rx)
  return [x1 * Math.cos(rz) - y1 * Math.sin(rz), x1 * Math.sin(rz) + y1 * Math.cos(rz), z2]
}

// Faces as [origin corner, +u corner, +v corner] in cube space (-1..1), plus normal.
// Orientation chosen so u runs left→right and v top→bottom as seen from outside.
const FACE_GEOMETRY: Array<{ key: FaceKey; o: V3; u: V3; v: V3; n: V3 }> = [
  { key: 'F', o: [-1, -1, 1], u: [1, -1, 1], v: [-1, 1, 1], n: [0, 0, 1] },
  { key: 'B', o: [1, -1, -1], u: [-1, -1, -1], v: [1, 1, -1], n: [0, 0, -1] },
  { key: 'U', o: [-1, -1, -1], u: [1, -1, -1], v: [-1, -1, 1], n: [0, -1, 0] },
  { key: 'D', o: [-1, 1, 1], u: [1, 1, 1], v: [-1, 1, -1], n: [0, 1, 0] },
  { key: 'L', o: [-1, -1, -1], u: [-1, -1, 1], v: [-1, 1, -1], n: [-1, 0, 0] },
  { key: 'R', o: [1, -1, 1], u: [1, -1, -1], v: [1, 1, 1], n: [1, 0, 0] },
]

export interface ProjectedFace {
  key: FaceKey
  /** Average depth (larger = nearer the viewer). */
  depth: number
  /** Light factor 0.45..1 from the face's angle to the viewer. */
  light: number
  /** 9 sticker quads (row-major), each 4 projected points. */
  stickers: P2[][]
  /** Face outline (4 projected points). */
  outline: P2[]
}

/**
 * Project a cube: returns only the faces that point toward the viewer, sorted
 * back-to-front (painter's algorithm). Pure — no canvas.
 */
export function projectCube(cx: number, cy: number, size: number, rotation: Cube3DState['rotation'], explode = 0): ProjectedFace[] {
  const s = size / 2
  const persp = 4 // camera distance in cube units: mild perspective
  const project = ([x, y, z]: V3): P2 => {
    const k = persp / (persp - z)
    return { x: cx + x * s * k, y: cy + y * s * k }
  }
  const out: ProjectedFace[] = []
  for (const f of FACE_GEOMETRY) {
    const n = rotate(f.n, rotation.x, rotation.y, rotation.z)
    if (n[2] <= 0.02) continue // back-facing
    const o = rotate(f.o, rotation.x, rotation.y, rotation.z)
    const u = rotate(f.u, rotation.x, rotation.y, rotation.z)
    const v = rotate(f.v, rotation.x, rotation.y, rotation.z)
    const du: V3 = [u[0] - o[0], u[1] - o[1], u[2] - o[2]]
    const dv: V3 = [v[0] - o[0], v[1] - o[1], v[2] - o[2]]
    const at = (a: number, b: number, push: number): V3 => [
      o[0] + du[0] * a + dv[0] * b + n[0] * push,
      o[1] + du[1] * a + dv[1] * b + n[1] * push,
      o[2] + du[2] * a + dv[2] * b + n[2] * push,
    ]
    const stickers: P2[][] = []
    const gap = 0.06
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        // Explode: stickers fly out along the normal and away from the face center.
        const push = explode * 1.2
        const spreadA = (col - 1) * explode * 0.25
        const spreadB = (row - 1) * explode * 0.25
        const a0 = col / 3 + gap / 3 + spreadA, a1 = (col + 1) / 3 - gap / 3 + spreadA
        const b0 = row / 3 + gap / 3 + spreadB, b1 = (row + 1) / 3 - gap / 3 + spreadB
        stickers.push([at(a0, b0, push), at(a1, b0, push), at(a1, b1, push), at(a0, b1, push)].map(project))
      }
    }
    const corners = [at(0, 0, 0), at(1, 0, 0), at(1, 1, 0), at(0, 1, 0)]
    out.push({
      key: f.key,
      depth: corners.reduce((sum, c) => sum + c[2], 0) / 4,
      light: 0.45 + 0.55 * Math.min(1, n[2]),
      stickers,
      outline: corners.map(project),
    })
  }
  return out.sort((a, b) => a.depth - b.depth)
}

function quad(ctx: CanvasRenderingContext2D, p: P2[]) {
  ctx.beginPath()
  ctx.moveTo(p[0].x, p[0].y)
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y)
  ctx.closePath()
}

/** Draw one cube. Glow goes behind; stickers follow face perspective; flash on top. */
export function drawCube3D(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  state: Cube3DState, look: CubeAppearance,
): void {
  if (look.glow > 0.02 && typeof ctx.createRadialGradient === 'function') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.4)
    const c = look.glowColor
    g.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${(look.glow * 0.45).toFixed(3)})`)
    g.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`)
    ctx.beginPath()
    ctx.arc(cx, cy, size * 1.4, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
  }
  for (const face of projectCube(cx, cy, size, state.rotation, state.explode)) {
    if (state.explode < 0.05) {
      // Black plastic body behind the stickers (hidden while exploding so pieces read as flying apart).
      quad(ctx, face.outline)
      ctx.fillStyle = '#111111'
      ctx.fill()
    }
    const colors = state.faces[face.key]
    face.stickers.forEach((pts, i) => {
      quad(ctx, pts)
      ctx.fillStyle = colors[i]
      ctx.fill()
      if (face.light < 0.999) {
        ctx.fillStyle = `rgba(0, 0, 0, ${(1 - face.light).toFixed(3)})`
        ctx.fill()
      }
    })
  }
  if (look.flash && look.flash.alpha > 0.01) {
    const c = look.flash.color
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.75, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${look.flash.alpha.toFixed(3)})`
    ctx.fill()
  }
}

// ─── Real Rubik's renderer ───────────────────────────────────────────────────
// Draws the cubies from rubikModel.ts: stickers are data, layers really turn.
// Same projection, culling, shading, glow and flash as drawCube3D.

export interface RubikState {
  cubies: Cubie[]
  /** The layer turning right now and its angle in radians (0..±π/2), or null. */
  turning: { move: Move; angle: number } | null
  rotation: { x: number; y: number; z: number }
  /** 0..1 how far the cubies have flown outward. */
  explode: number
}

const RUBIK_FACE_DEFS: Array<{ key: Normal; n: V3; u: V3; v: V3 }> = [
  { key: 'pz', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { key: 'nz', n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
  { key: 'py', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { key: 'ny', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { key: 'px', n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { key: 'nx', n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
]

/** Float rotation about one axis (right-hand rule); matches rubikModel's integer turns at ±π/2. */
function rotateAxisAngle([x, y, z]: V3, axis: Axis, angle: number): V3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  switch (axis) {
    case 'x': return [x, y * cos - z * sin, y * sin + z * cos]
    case 'y': return [x * cos + z * sin, y, -x * sin + z * cos]
    case 'z': return [x * cos - y * sin, x * sin + y * cos, z]
  }
}

interface RubikFaceDraw { pts: P2[]; depth: number; light: number; color: string | null }
const rubikPool: RubikFaceDraw[] = []
const rubikVisible: RubikFaceDraw[] = []

/** Draw one real Rubik's cube. Glow goes behind; faces back-to-front; flash on top. */
export function drawRubik3D(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  state: RubikState, look: CubeAppearance,
): void {
  if (look.glow > 0.02 && typeof ctx.createRadialGradient === 'function') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.4)
    const gc = look.glowColor
    g.addColorStop(0, `rgba(${gc.r}, ${gc.g}, ${gc.b}, ${(look.glow * 0.45).toFixed(3)})`)
    g.addColorStop(1, `rgba(${gc.r}, ${gc.g}, ${gc.b}, 0)`)
    ctx.beginPath()
    ctx.arc(cx, cy, size * 1.4, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
  }

  const s = size / 2
  const persp = 4 // same camera as projectCube
  const project = (p: V3): P2 => {
    const k = persp / (persp - p[2])
    return { x: cx + p[0] * s * k, y: cy + p[1] * s * k }
  }
  const rot = state.rotation
  const turning = state.turning
  const turnAxisIdx = turning ? (turning.move.axis === 'x' ? 0 : turning.move.axis === 'y' ? 1 : 2) : 0
  const HALF = 1 / 3 // cubie side is 2/3 in -1..1 cube space

  rubikVisible.length = 0
  let cursor = 0
  for (const cubie of state.cubies) {
    const inLayer = turning !== null && cubie.pos[turnAxisIdx] === turning.move.layer
    const spread = 2 / 3 + state.explode * 0.5
    const center: V3 = [cubie.pos[0] * spread, cubie.pos[1] * spread, cubie.pos[2] * spread]
    const place = (p: V3): V3 => {
      const turned = inLayer && turning ? rotateAxisAngle(p, turning.move.axis, turning.angle) : p
      return rotate(turned, rot.x, rot.y, rot.z)
    }
    for (const def of RUBIK_FACE_DEFS) {
      const n = place(def.n)
      if (n[2] <= 0.02) continue // back-facing
      const fc: V3 = [center[0] + def.n[0] * HALF, center[1] + def.n[1] * HALF, center[2] + def.n[2] * HALF]
      const corners: V3[] = [
        [fc[0] + def.u[0] * HALF + def.v[0] * HALF, fc[1] + def.u[1] * HALF + def.v[1] * HALF, fc[2] + def.u[2] * HALF + def.v[2] * HALF],
        [fc[0] + def.u[0] * HALF - def.v[0] * HALF, fc[1] + def.u[1] * HALF - def.v[1] * HALF, fc[2] + def.u[2] * HALF - def.v[2] * HALF],
        [fc[0] - def.u[0] * HALF - def.v[0] * HALF, fc[1] - def.u[1] * HALF - def.v[1] * HALF, fc[2] - def.u[2] * HALF - def.v[2] * HALF],
        [fc[0] - def.u[0] * HALF + def.v[0] * HALF, fc[1] - def.u[1] * HALF + def.v[1] * HALF, fc[2] - def.u[2] * HALF + def.v[2] * HALF],
      ]
      const placed = corners.map(place)
      let face = rubikPool[cursor]
      if (!face) {
        face = { pts: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], depth: 0, light: 1, color: null }
        rubikPool[cursor] = face
      }
      cursor++
      for (let i = 0; i < 4; i++) {
        const p = project(placed[i])
        face.pts[i].x = p.x
        face.pts[i].y = p.y
      }
      face.depth = placed.reduce((sum, p) => sum + p[2], 0) / 4
      face.light = 0.45 + 0.55 * Math.min(1, n[2])
      face.color = cubie.stickers[def.key] ?? null
      rubikVisible.push(face)
    }
  }

  rubikVisible.sort((a, b) => a.depth - b.depth)
  const insetPts: P2[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
  for (const face of rubikVisible) {
    // Black plastic body.
    quad(ctx, face.pts)
    ctx.fillStyle = '#111111'
    ctx.fill()
    if (face.color !== null) {
      // Sticker, inset 0.06 of the face toward its centroid (like projectCube's gap).
      const mx = (face.pts[0].x + face.pts[1].x + face.pts[2].x + face.pts[3].x) / 4
      const my = (face.pts[0].y + face.pts[1].y + face.pts[2].y + face.pts[3].y) / 4
      for (let i = 0; i < 4; i++) {
        insetPts[i].x = face.pts[i].x + (mx - face.pts[i].x) * 0.06
        insetPts[i].y = face.pts[i].y + (my - face.pts[i].y) * 0.06
      }
      quad(ctx, insetPts)
      ctx.fillStyle = face.color
      ctx.fill()
      if (face.light < 0.999) {
        ctx.fillStyle = `rgba(0, 0, 0, ${(1 - face.light).toFixed(3)})`
        ctx.fill()
      }
    }
  }

  if (look.flash && look.flash.alpha > 0.01) {
    const c = look.flash.color
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.75, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${look.flash.alpha.toFixed(3)})`
    ctx.fill()
  }
}
