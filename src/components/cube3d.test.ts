// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { describe, expect, it } from 'vitest'
import { drawRubik3D, type CubeAppearance } from './cube3d'
import { solvedCubies, type Move } from './rubikModel'

/** Mock 2D context that records every fill with the fillStyle active at the time. */
function mockCtx() {
  const fills: Array<{ style: unknown }> = []
  const ctx = {
    fillStyle: '' as unknown,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    fill() { fills.push({ style: ctx.fillStyle }) },
    // Deliberately no createRadialGradient: glow is 0 in these tests anyway.
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

const LOOK: CubeAppearance = { glow: 0, glowColor: { r: 6, g: 182, b: 212 }, flash: null }
const NO_ROTATION = { x: 0, y: 0, z: 0 }
const FACE_COLORS = ['#ffffff', '#ffcf00', '#34c759', '#0a84ff', '#ff9500', '#ff3b30']

describe('drawRubik3D', () => {
  it('solved cube, no turn: fills use only the six face colors plus the black body, front face fully stickered', () => {
    const { ctx, fills } = mockCtx()
    drawRubik3D(ctx, 100, 100, 48, { cubies: solvedCubies(), turning: null, rotation: NO_ROTATION, explode: 0 }, LOOK)
    const styles = fills.map(f => f.style as string)
    for (const s of styles) {
      expect(s === '#111111' || FACE_COLORS.includes(s) || s.startsWith('rgba(0, 0, 0,')).toBe(true)
    }
    expect(styles).toContain('#111111')
    // Facing the viewer dead-on, exactly the 9 front (pz, green) stickers show.
    expect(styles.filter(s => s === '#34c759')).toHaveLength(9)
  })

  it('mid-turn draws more black quads than at rest (inner faces become visible)', () => {
    const move: Move = { axis: 'x', layer: 1, dir: 1 }
    const rest = mockCtx()
    drawRubik3D(rest.ctx, 100, 100, 48, { cubies: solvedCubies(), turning: null, rotation: NO_ROTATION, explode: 0 }, LOOK)
    const mid = mockCtx()
    drawRubik3D(mid.ctx, 100, 100, 48, { cubies: solvedCubies(), turning: { move, angle: Math.PI / 4 }, rotation: NO_ROTATION, explode: 0 }, LOOK)
    const black = (fills: Array<{ style: unknown }>) => fills.filter(f => f.style === '#111111').length
    expect(black(mid.fills)).toBeGreaterThan(black(rest.fills))
  })

  it('never throws for explode across 0..1, with or without a turn in flight', () => {
    const move: Move = { axis: 'y', layer: 0, dir: -1 }
    for (const explode of [0, 0.25, 0.5, 0.75, 1]) {
      const { ctx } = mockCtx()
      expect(() => drawRubik3D(ctx, 50, 50, 24, { cubies: solvedCubies(), turning: null, rotation: { x: -0.55, y: 0.7, z: 0 }, explode }, LOOK)).not.toThrow()
      expect(() => drawRubik3D(ctx, 50, 50, 24, { cubies: solvedCubies(), turning: { move, angle: 0.4 }, rotation: { x: -0.55, y: 0.7, z: 0 }, explode }, LOOK)).not.toThrow()
    }
  })
})
