// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * rubikModel — a real 3x3 Rubik's cube as data: 26 cubies with stickers that
 * actually move when a layer turns. Pure integer math, no canvas, no floats,
 * so positions stay exact and every state is reproducible in tests.
 *
 * Screen space has +y pointing down (projectCube in cube3d.ts), so the face
 * colors follow cube3d's FACE_COLORS with py = D (bottom, yellow) and
 * ny = U (top, white).
 */

export type Axis = 'x' | 'y' | 'z'
export type Normal = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

export interface Cubie {
  /** Components in {-1, 0, 1}. */
  pos: [number, number, number]
  stickers: Partial<Record<Normal, string>>
}

export interface Move {
  axis: Axis
  /** -1 | 0 | 1; 0 is the middle slice. */
  layer: -1 | 0 | 1
  dir: 1 | -1
}

/** Sticker color per outward normal; values must match FACE_COLORS in cube3d.ts. */
export const NORMAL_COLORS: Record<Normal, string> = {
  px: '#ff3b30', // R
  nx: '#ff9500', // L
  py: '#ffcf00', // D (screen-down)
  ny: '#ffffff', // U
  pz: '#34c759', // F
  nz: '#0a84ff', // B
}

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

const NORMAL_VEC: Record<Normal, [number, number, number]> = {
  px: [1, 0, 0], nx: [-1, 0, 0],
  py: [0, 1, 0], ny: [0, -1, 0],
  pz: [0, 0, 1], nz: [0, 0, -1],
}
const NORMALS = Object.keys(NORMAL_VEC) as Normal[]

function vecToNormal(v: [number, number, number]): Normal {
  for (const n of NORMALS) {
    const nv = NORMAL_VEC[n]
    if (nv[0] === v[0] && nv[1] === v[1] && nv[2] === v[2]) return n
  }
  throw new Error(`not an axis vector: ${v}`)
}

/**
 * Integer quarter-turn of a vector about an axis (right-hand rule).
 * dir = 1 is +90°, dir = -1 is -90°. Exact: components stay in {-1, 0, 1}.
 */
function rotateVec(v: [number, number, number], axis: Axis, dir: 1 | -1): [number, number, number] {
  const [x, y, z] = v
  switch (axis) {
    case 'x': return dir === 1 ? [x, -z, y] : [x, z, -y]
    case 'y': return dir === 1 ? [z, y, -x] : [-z, y, x]
    case 'z': return dir === 1 ? [-y, x, z] : [y, -x, z]
  }
}

/** The 26 cubies of a solved cube (no hidden center), stickers facing outward. */
export function solvedCubies(): Cubie[] {
  const cubies: Cubie[] = []
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        const pos: [number, number, number] = [x, y, z]
        const stickers: Partial<Record<Normal, string>> = {}
        for (const n of NORMALS) {
          const nv = NORMAL_VEC[n]
          const axis = nv[0] !== 0 ? 0 : nv[1] !== 0 ? 1 : 2
          const sign = nv[axis]
          if (pos[axis] === sign) stickers[n] = NORMAL_COLORS[n]
        }
        cubies.push({ pos, stickers })
      }
    }
  }
  return cubies
}

/**
 * Apply one quarter-turn: cubies in the layer rotate about the axis; their
 * positions and sticker normals rotate together. Returns a new array; the
 * input is never mutated (untouched cubies are shared by reference).
 */
export function applyMove(cubies: Cubie[], move: Move): Cubie[] {
  const ai = AXIS_INDEX[move.axis]
  return cubies.map(c => {
    if (c.pos[ai] !== move.layer) return c
    const stickers: Partial<Record<Normal, string>> = {}
    for (const n of NORMALS) {
      const color = c.stickers[n]
      if (color !== undefined) stickers[vecToNormal(rotateVec(NORMAL_VEC[n], move.axis, move.dir))] = color
    }
    return { pos: rotateVec(c.pos, move.axis, move.dir), stickers }
  })
}

/** The move that undoes `m`: same axis and layer, direction flipped. */
export function inverseMove(m: Move): Move {
  return { axis: m.axis, layer: m.layer, dir: (m.dir === 1 ? -1 : 1) as 1 | -1 }
}

/**
 * A deterministic pseudo-random move sequence (same seeded sine rand style as
 * scrambleFaces in cube3d.ts — never Math.random).
 * Rules: never the exact inverse of the previous move; never the same axis
 * and layer three times in a row; coverage is forced so that over any 30
 * moves every axis and the middle layer (0) appear at least once.
 */
export function moveSequence(seed: number, count: number): Move[] {
  const axes: Axis[] = ['x', 'y', 'z']
  const layers: Array<-1 | 0 | 1> = [-1, 0, 1]
  const rand = (s: number) => { const x = Math.sin(s * 137.5 + 0.5) * 10000; return x - Math.floor(x) }
  let tick = 0
  const next = () => rand(seed * 31337 + (tick++) * 7717)

  const isLegal = (cand: Move, out: Move[]): boolean => {
    const prev = out[out.length - 1]
    const prev2 = out[out.length - 2]
    if (prev && cand.axis === prev.axis && cand.layer === prev.layer && cand.dir !== prev.dir) return false
    if (prev && prev2 && cand.axis === prev.axis && cand.layer === prev.layer
      && prev.axis === prev2.axis && prev.layer === prev2.layer) return false
    return true
  }

  const out: Move[] = []
  const lastAxisAt: Record<Axis, number> = { x: -100, y: -100, z: -100 }
  let lastMidAt = -100
  const COVERAGE_GAP = 20 // force an axis / the middle layer before any 30-move window can miss it

  while (out.length < count) {
    const i = out.length
    let forcedAxis: Axis | null = null
    for (const a of axes) if (i - lastAxisAt[a] >= COVERAGE_GAP) { forcedAxis = a; break }
    const forcedLayer: (-1 | 0 | 1) | null = i - lastMidAt >= COVERAGE_GAP ? 0 : null

    let chosen: Move | null = null
    for (let attempt = 0; attempt < 24 && !chosen; attempt++) {
      const cand: Move = {
        axis: forcedAxis ?? axes[Math.floor(next() * 3)],
        layer: forcedLayer ?? layers[Math.floor(next() * 3)],
        dir: next() < 0.5 ? 1 : -1,
      }
      if (isLegal(cand, out)) chosen = cand
    }
    if (!chosen) {
      // Deterministic fallback scan (the retry loop essentially never misses).
      scan: for (const a of axes) {
        if (forcedAxis && a !== forcedAxis) continue
        for (const l of layers) {
          if (forcedLayer !== null && l !== forcedLayer) continue
          for (const d of [1, -1] as const) {
            const cand: Move = { axis: a, layer: l, dir: d }
            if (isLegal(cand, out)) { chosen = cand; break scan }
          }
        }
      }
    }
    if (!chosen) chosen = { axis: forcedAxis ?? 'x', layer: forcedLayer ?? 1, dir: 1 }
    out.push(chosen)
    lastAxisAt[chosen.axis] = i
    if (chosen.layer === 0) lastMidAt = i
  }
  return out
}

/** True when every outer face shows a single color. */
export function isSolved(cubies: Cubie[]): boolean {
  for (const n of NORMALS) {
    let color: string | undefined
    for (const c of cubies) {
      const s = c.stickers[n]
      if (s === undefined) continue
      if (color === undefined) color = s
      else if (s !== color) return false
    }
  }
  return true
}
