// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.
import { describe, expect, it } from 'vitest'
import { applyMove, inverseMove, isSolved, moveSequence, solvedCubies, type Axis, type Move } from './rubikModel'

const AXES: Axis[] = ['x', 'y', 'z']
const LAYERS: Array<-1 | 0 | 1> = [-1, 0, 1]

describe('rubikModel', () => {
  it('solved cube: 26 cubies, 54 stickers, 9 of each color, solved', () => {
    const cubies = solvedCubies()
    expect(cubies).toHaveLength(26)
    const colors = cubies.flatMap(c => Object.values(c.stickers))
    expect(colors).toHaveLength(54)
    for (const color of ['#ff3b30', '#ff9500', '#ffcf00', '#ffffff', '#34c759', '#0a84ff']) {
      expect(colors.filter(c => c === color)).toHaveLength(9)
    }
    expect(isSolved(cubies)).toBe(true)
  })

  it('four identical quarter-turns return the original state, for every axis and layer', () => {
    for (const axis of AXES) {
      for (const layer of LAYERS) {
        for (const dir of [1, -1] as const) {
          const move: Move = { axis, layer, dir }
          let cubies = solvedCubies()
          for (let i = 0; i < 4; i++) cubies = applyMove(cubies, move)
          expect(cubies).toEqual(solvedCubies())
          expect(isSolved(cubies)).toBe(true)
        }
      }
    }
  })

  it('any move followed by its inverse returns the original state, without mutating the input', () => {
    for (const axis of AXES) {
      for (const layer of LAYERS) {
        const move: Move = { axis, layer, dir: 1 }
        const start = solvedCubies()
        const snapshot = JSON.parse(JSON.stringify(start)) as typeof start
        const back = applyMove(applyMove(start, move), inverseMove(move))
        expect(back).toEqual(start)
        expect(start).toEqual(snapshot) // applyMove never mutates
      }
    }
  })

  it('after 50 sequence moves: still 26 cubies, 54 stickers, 9 per color, positions in {-1,0,1}', () => {
    let cubies = solvedCubies()
    for (const m of moveSequence(11, 50)) cubies = applyMove(cubies, m)
    expect(cubies).toHaveLength(26)
    const colors = cubies.flatMap(c => Object.values(c.stickers))
    expect(colors).toHaveLength(54)
    for (const color of ['#ff3b30', '#ff9500', '#ffcf00', '#ffffff', '#34c759', '#0a84ff']) {
      expect(colors.filter(c => c === color)).toHaveLength(9)
    }
    for (const c of cubies) for (const v of c.pos) expect([-1, 0, 1]).toContain(v)
    // No two cubies share a position.
    expect(new Set(cubies.map(c => c.pos.join(','))).size).toBe(26)
  })

  it('moveSequence is deterministic, never inverts the previous move, covers all axes and the middle layer', () => {
    const a = moveSequence(7, 30)
    expect(a).toEqual(moveSequence(7, 30))
    expect(a).toHaveLength(30)
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]
      const cur = a[i]
      expect(cur.axis === prev.axis && cur.layer === prev.layer && cur.dir !== prev.dir).toBe(false)
    }
    for (let i = 2; i < a.length; i++) {
      const same = (m: Move) => m.axis === a[i].axis && m.layer === a[i].layer
      expect(same(a[i - 1]) && same(a[i - 2])).toBe(false) // never same axis+layer three in a row
    }
    expect(new Set(a.map(m => m.axis))).toEqual(new Set(['x', 'y', 'z']))
    expect(a.some(m => m.layer === 0)).toBe(true)
  })

  it('a 20-move sequence undone by its inverses in reverse order solves the cube', () => {
    const seq = moveSequence(3, 20)
    let cubies = solvedCubies()
    for (const m of seq) cubies = applyMove(cubies, m)
    expect(isSolved(cubies)).toBe(false)
    for (const m of [...seq].reverse().map(inverseMove)) cubies = applyMove(cubies, m)
    expect(isSolved(cubies)).toBe(true)
    expect(cubies).toEqual(solvedCubies())
  })

  it('a single quarter-turn of a face is not solved', () => {
    const cubies = applyMove(solvedCubies(), { axis: 'z', layer: 1, dir: 1 })
    expect(isSolved(cubies)).toBe(false)
  })

  it("R turn: the +x face stays all red while the x=1 column stickers move to other faces", () => {
    const cubies = applyMove(solvedCubies(), { axis: 'x', layer: 1, dir: 1 })
    const px = cubies.flatMap(c => (c.stickers.px ? [c.stickers.px] : []))
    expect(px).toHaveLength(9)
    expect(px.every(c => c === '#ff3b30')).toBe(true)
    expect(isSolved(cubies)).toBe(false)
    // The front (+z) stickers in the x=1 column now hold the old bottom (py) color:
    // a +90° turn about x sends +y (down, yellow) to +z (front, green).
    const frontColumn = cubies.filter(c => c.pos[0] === 1 && c.stickers.pz)
    expect(frontColumn).toHaveLength(3)
    expect(frontColumn.every(c => c.stickers.pz === '#ffcf00')).toBe(true)
  })
})
