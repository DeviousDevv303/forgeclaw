// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * cube3d — 3D Rubik's cube renderer for the neural network background.
 * Perspective-projected cubes with painter's algorithm, backface culling,
 * per-face 3x3 stickers, emotion-driven look, and deterministic scrambling.
 */

export interface Cube3DState {
  faces: {
    U: string[]; D: string[]; F: string[];
    B: string[]; L: string[]; R: string[];
  };
  rotation: { x: number; y: number; z: number };
  scramble: number;
  explode: number;
}

export interface CubeLook {
  angleOffset: number;
  glow: number;
  glowColor: { r: number; g: number; b: number };
  jitter: number;
  flash: number;
}

/**
 * Map app phase to cube emotional state.
 * scramble: 0=solved, 1=fully mixed (executing/streaming scrambles)
 * glow: 0-1 intensity; glowColor shifts by phase
 * jitter: 0-1 shake amount (blocked shakes hard)
 * flash: 0-1 white flash overlay (verifying flashes)
 */
export function cubeLook(
  phase: string,
  t: number,
  seed: number,
): { look: CubeLook; scramble: number; explode: number } {
  const wobble = Math.sin(t * 2 + seed) * 0.1;
  switch (phase) {
    case 'blocked':
      return {
        look: {
          angleOffset: wobble * 3,
          glow: 0.8,
          glowColor: { r: 255, g: 59, b: 48 },
          jitter: 0.7,
          flash: 0,
        },
        scramble: 0.3, explode: 0,
      };
    case 'executing':
    case 'streaming':
      return {
        look: {
          angleOffset: wobble,
          glow: 0.6,
          glowColor: { r: 255, g: 149, b: 0 },
          jitter: 0.3,
          flash: 0,
        },
        scramble: 0.8, explode: 0,
      };
    case 'verifying':
      return {
        look: {
          angleOffset: wobble * 0.5,
          glow: 0.5,
          glowColor: { r: 10, g: 132, b: 255 },
          jitter: 0.1,
          flash: 0.5 + 0.5 * Math.sin(t * 8),
        },
        scramble: 0.2, explode: 0,
      };
    case 'idle':
    default:
      return {
        look: {
          angleOffset: wobble * 0.3,
          glow: 0.3,
          glowColor: { r: 255, g: 149, b: 0 },
          jitter: 0,
          flash: 0,
        },
        scramble: 0, explode: 0,
      };
  }
}

/**
 * Scramble faces with cross-face swaps (realistic mixing).
 * Swaps stickers between different faces, not within one face.
 */
export function scrambleFaces(
  faces: Cube3DState['faces'],
  amount: number,
  seed: number,
): Cube3DState['faces'] {
  const result: Cube3DState['faces'] = {
    U: [...faces.U], D: [...faces.D], F: [...faces.F],
    B: [...faces.B], L: [...faces.L], R: [...faces.R],
  };
  const faceKeys = ['U', 'D', 'F', 'B', 'L', 'R'] as const;
  const swaps = Math.floor(amount * 18);
  const rand = (s: number) => {
    const x = Math.sin(s * 137.5) * 10000;
    return x - Math.floor(x);
  };
  for (let i = 0; i < swaps; i++) {
    const f1 = faceKeys[Math.floor(rand(seed + i * 2) * 6)];
    let f2 = faceKeys[Math.floor(rand(seed + i * 2 + 1) * 6)];
    if (f1 === f2) f2 = faceKeys[(faceKeys.indexOf(f1) + 1) % 6];
    const s1 = Math.floor(rand(seed + i * 3) * 9);
    const s2 = Math.floor(rand(seed + i * 3 + 1) * 9);
    const tmp = result[f1][s1];
    result[f1][s1] = result[f2][s2];
    result[f2][s2] = tmp;
  }
  return result;
}

/** Minimum 3D cube size — below this the faces aren't legible. */
export const MIN_CUBE_PX = 60;

/** Standard solved faces. */
export function solvedCubeFaces(): Cube3DState['faces'] {
  return {
    U: Array(9).fill('#ffffff'),
    D: Array(9).fill('#ffcf00'),
    F: Array(9).fill('#34c759'),
    B: Array(9).fill('#0a84ff'),
    L: Array(9).fill('#ff9500'),
    R: Array(9).fill('#ff3b30'),
  };
}

// Sticker sprite cache: pre-render each color once, drawImage per frame.
const stickerCache = new Map<string, HTMLCanvasElement>();
function getStickerSprite(color: string): HTMLCanvasElement {
  const hit = stickerCache.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(2, 2, 28, 28, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.roundRect(2, 2, 28, 14, 4);
    ctx.fill();
  }
  stickerCache.set(color, c);
  return c;
}

function lerpPt(a: { x: number; y: number; scale: number },
                b: { x: number; y: number; scale: number }, t: number) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    scale: a.scale + (b.scale - a.scale) * t,
  };
}

/**
 * Draw a 3D Rubik's cube on 2D canvas. Glow renders BEHIND the cube
 * (alpha 0.3) so celebrate/explode moments don't wash out stickers.
 */
export function drawCube3D(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  state: Cube3DState, look: CubeLook,
) {
  const s = size / 2;
  const rotX = state.rotation.x + look.angleOffset;
  const rotY = state.rotation.y + look.angleOffset * 0.7;
  const rotZ = state.rotation.z;

  // 1. Glow FIRST (behind). Guarded: jsdom and older engines may lack
  // createRadialGradient; optional chaining keeps tests and edge runtimes alive.
  if (look.glow > 0 && typeof ctx.createRadialGradient === 'function') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.5);
    const gc = look.glowColor;
    g.addColorStop(0, `rgba(${gc.r},${gc.g},${gc.b},${look.glow * 0.3})`);
    g.addColorStop(1, `rgba(${gc.r},${gc.g},${gc.b},0)`);
    ctx.beginPath?.();
    ctx.arc?.(cx, cy, size * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill?.();
  }

  const project = (x: number, y: number, z: number) => {
    const scale = 400 / (400 + z * s);
    return { x: cx + x * s * scale, y: cy + y * s * scale, scale };
  };

  const v = [
    [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
    [-1,-1,1],  [1,-1,1],  [1,1,1],  [-1,1,1],
  ];
  const rotated = v.map(([x, y, z]) => {
    const x1 = x * Math.cos(rotY) - z * Math.sin(rotY);
    const z1 = x * Math.sin(rotY) + z * Math.cos(rotY);
    const y1 = y * Math.cos(rotX) - z1 * Math.sin(rotX);
    const z2 = y * Math.sin(rotX) + z1 * Math.cos(rotX);
    const x2 = x1 * Math.cos(rotZ) - y1 * Math.sin(rotZ);
    const y2 = x1 * Math.sin(rotZ) + y1 * Math.cos(rotZ);
    return [x2, y2, z2];
  });

  const faces = [
    { idx: [4,5,6,7], normal: [0,0,1],  color: state.faces.F },
    { idx: [0,3,2,1], normal: [0,0,-1], color: state.faces.B },
    { idx: [0,1,5,4], normal: [0,-1,0], color: state.faces.D },
    { idx: [2,3,7,6], normal: [0,1,0],  color: state.faces.U },
    { idx: [0,4,7,3], normal: [-1,0,0], color: state.faces.L },
    { idx: [1,2,6,5], normal: [1,0,0],  color: state.faces.R },
  ];
  faces.sort((a, b) => {
    const za = a.idx.reduce((sum, i) => sum + rotated[i][2], 0) / 4;
    const zb = b.idx.reduce((sum, i) => sum + rotated[i][2], 0) / 4;
    return za - zb;
  });

  for (const face of faces) {
    const pts = face.idx.map(i => {
      const [x, y, z] = rotated[i];
      return project(x, y, z);
    });
    const [nx, ny, nz] = face.normal;
    const nz1 = nx * Math.sin(rotY) + nz * Math.cos(rotY);
    const nz2 = ny * Math.sin(rotX) + nz1 * Math.cos(rotX);
    if (nz2 < -0.1) continue;

    ctx.beginPath?.();
    ctx.moveTo?.(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo?.(p.x, p.y);
    ctx.closePath?.();
    ctx.fillStyle = '#1a1a1a';
    ctx.fill?.();

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const color = face.color[row * 3 + col];
        const u = (col - 1) / 3 + 0.5;
        const vv = (row - 1) / 3 + 0.5;
        const top = lerpPt(pts[0], pts[1], u);
        const bottom = lerpPt(pts[3], pts[2], u);
        const p = lerpPt(top, bottom, vv);
        const stickerSize = size * 0.28 * p.scale;
        ctx.drawImage?.(
          getStickerSprite(color),
          p.x - stickerSize / 2, p.y - stickerSize / 2,
          stickerSize, stickerSize,
        );
      }
    }
  }
}
