// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * 3D Rubik's cube renderer (cube3d.ts): real geometry, not sprites.
 * Originally Muse's drawImage sprite test; rewritten for the perspective-quad renderer.
 */
import { describe, it, expect, vi } from 'vitest';
import { cubeFacesVariant, drawCube3D, looksSolved, projectCube, scrambleFaces, solvedCubeFaces } from './cube3d';

// Same camera as the renderer (CUBE_TILT = -0.55): above the cube.
const TILT = { x: -0.55, y: 0.7, z: 0 };
const bbox = (pts: { x: number; y: number }[]) => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

describe('3D cube geometry', () => {
  it('shows exactly three faces (top + two sides) at the standard tilt, back faces culled', () => {
    const faces = projectCube(100, 100, 60, TILT);
    expect(faces.map(f => f.key).sort()).toEqual(['F', 'R', 'U'].sort());
    for (const f of faces) expect(f.stickers).toHaveLength(9);
  });

  it('sorts faces back to front (painter\'s algorithm)', () => {
    const faces = projectCube(0, 0, 60, { x: 0.3, y: 2.1, z: 0.2 });
    for (let i = 1; i < faces.length; i++) expect(faces[i].depth).toBeGreaterThanOrEqual(faces[i - 1].depth);
  });

  it('draws stickers as perspective quads that follow the face, not upright squares', () => {
    const top = projectCube(0, 0, 60, TILT).find(f => f.key === 'U')!;
    const s = top.stickers[4];
    // An upright square would have two horizontal edges; a foreshortened face sticker does not.
    const edgeSlope = Math.abs((s[1].y - s[0].y) / (s[1].x - s[0].x));
    expect(edgeSlope).toBeGreaterThan(0.1);
  });

  it('keeps the cube about the requested size', () => {
    const all = projectCube(200, 200, 60, TILT).flatMap(f => f.outline);
    const { w, h } = bbox(all);
    expect(w).toBeGreaterThan(55);
    expect(w).toBeLessThan(110);
    expect(h).toBeGreaterThan(55);
  });

  it('explode sends the stickers outward, then they come back with explode = 0', () => {
    const spread = (e: number) => bbox(projectCube(0, 0, 60, TILT, e).flatMap(f => f.stickers.flat())).w;
    expect(spread(1)).toBeGreaterThan(spread(0) * 1.3);
    // The center sticker has no sideways spread: it must still move, along the face normal.
    const center = (e: number) => { const st = projectCube(0, 0, 60, TILT, e).find(f => f.key === 'U')!.stickers[4]; return { x: st.reduce((a, p) => a + p.x, 0) / 4, y: st.reduce((a, p) => a + p.y, 0) / 4 } };
    const c0 = center(0), c1 = center(1);
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeGreaterThan(10);
  });
});

describe('cube faces', () => {
  it('scrambles across faces (within-face swaps would be invisible on a solved cube)', () => {
    expect(looksSolved(solvedCubeFaces())).toBe(true);
    const mixed = scrambleFaces(solvedCubeFaces(), 0.6, 3);
    expect(looksSolved(mixed, ['U', 'F', 'R'])).toBe(false);
    const all = Object.values(mixed).flat();
    for (const c of ['#ffffff', '#ffcf00', '#34c759', '#0a84ff', '#ff9500', '#ff3b30']) expect(all.filter(x => x === c)).toHaveLength(9);
  });

  it('caches face variants (no per-frame allocation)', () => {
    expect(cubeFacesVariant(2)).toBe(cubeFacesVariant(2));
    expect(looksSolved(cubeFacesVariant(0))).toBe(true);
  });
});

describe('drawCube3D', () => {
  const ctx = () => {
    const fills: string[] = [];
    let style = '';
    const c = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(),
      fill: vi.fn(() => { fills.push(style) }),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      set fillStyle(v: string) { style = String(v) }, get fillStyle() { return style },
    };
    return { c: c as unknown as CanvasRenderingContext2D, fills };
  };

  it('fills 27 colored stickers for the 3 visible faces, with no roundRect needed', () => {
    const { c, fills } = ctx();
    drawCube3D(c, 50, 50, 60, { faces: solvedCubeFaces(), rotation: TILT, explode: 0 }, { glow: 0, glowColor: { r: 0, g: 0, b: 0 }, flash: null });
    const stickers = fills.filter(f => /^#[0-9a-f]{6}$/i.test(f) && f !== '#111111');
    expect(stickers).toHaveLength(27);
    expect(new Set(stickers)).toEqual(new Set(['#ffffff', '#34c759', '#ff3b30']));
  });

  it('draws glow behind and flash on top', () => {
    const { c, fills } = ctx();
    drawCube3D(c, 50, 50, 60, { faces: solvedCubeFaces(), rotation: TILT, explode: 0 }, { glow: 1, glowColor: { r: 255, g: 0, b: 68 }, flash: { color: { r: 0, g: 255, b: 136 }, alpha: 0.4 } });
    expect(fills[fills.length - 1]).toMatch(/^rgba\(0, 255, 136/);
  });
});
