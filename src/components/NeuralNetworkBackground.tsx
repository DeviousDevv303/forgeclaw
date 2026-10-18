// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import React, { useEffect, useRef, useCallback } from 'react';
import type { NeuralState, NeuralPhase } from '../hooks/useNeuralState';

interface NeuralNetworkBackgroundProps {
  messageCount: number;
  /** Preferred: drive the background from useNeuralState(). */
  state?: NeuralState;
  /**
   * @deprecated Use `state` instead. Kept for backward compat; maps to
   * phase 'executing' (true) / 'idle' (false). Logs one dev-mode warning.
   */
  isProcessing?: boolean;
  activeTab: string;
  /** 'low' = 38 nodes (recommended for 8GB), 'medium' = 56, 'high' = 72. Treated as a maximum; auto-density may step down. */
  density?: 'low' | 'medium' | 'high';
  /** Override the default orange accent. Takes priority over palettes. */
  baseColor?: string;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulsePhase: number;
  layer: number;
  id: number;
  /** Lit while representing an in-flight tool (layer 2 only). */
  toolLit?: boolean;
}

interface Connection {
  from: number;
  to: number;
  strength: number;
  active: boolean;
  pulseOffset: number;
  /** Timestamp until which this connection flashes red (error feedback). */
  redFlashUntil?: number;
}

const DENSITY_MAP: Record<string, number[]> = {
  low:    [6, 8, 10, 8, 6],   // 38 nodes
  medium: [8, 12, 16, 12, 8], // 56 nodes
  high:   [10, 16, 20, 16, 10] // 72 nodes
};

/**
 * 3D Rubik's cube state per node. (Claude to move to cubeMotion.ts;
 * defined here until that lands.)
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
}

/** Minimum 3D cube size — below this the faces aren't legible. */
const MIN_CUBE_PX = 60;

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

  // 1. Glow FIRST (behind)
  if (look.glow > 0) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.5);
    const c = look.glowColor;
    g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${look.glow * 0.3})`);
    g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
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

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const color = face.color[row * 3 + col];
        const u = (col - 1) / 3 + 0.5;
        const vv = (row - 1) / 3 + 0.5;
        const top = lerpPt(pts[0], pts[1], u);
        const bottom = lerpPt(pts[3], pts[2], u);
        const p = lerpPt(top, bottom, vv);
        const stickerSize = size * 0.28 * p.scale;
        ctx.drawImage(
          getStickerSprite(color),
          p.x - stickerSize / 2, p.y - stickerSize / 2,
          stickerSize, stickerSize,
        );
      }
    }
  }
}
const DENSITY_ORDER = ['low', 'medium', 'high'] as const;

const TAB_PALETTE: Record<string, { primary: string; accent: string }> = {
  forgemind:    { primary: '#06b6d4', accent: '#22d3ee' }, // cyan + electric blue
  repoagent:    { primary: '#22c55e', accent: '#10b981' }, // greens
  orchestrator: { primary: '#a855f7', accent: '#c084fc' }, // purples
  failures:     { primary: '#ef4444', accent: '#f87171' }, // reds
  default:      { primary: '#06b6d4', accent: '#22d3ee' }
};

/** Provider accent colors. Merged with tab palette: tab sets hue family, provider sets accent. */
const PROVIDER_PALETTE: Record<string, string> = {
  corpus:    '#f97316', // orange
  local:     '#22c55e', // green
  moonshot:  '#a855f7', // purple
  anthropic: '#d4a017', // gold
};

/** Phase → pulse speed multiplier and connection strength ramp per frame. */
function phaseMotion(phase: NeuralPhase, tokenVelocity: number): { pulseSpeed: number; ramp: number } {
  switch (phase) {
    case 'planning':   return { pulseSpeed: 0.5, ramp: 0.01 };
    case 'executing':  return { pulseSpeed: 1.5, ramp: 0.02 };
    case 'verifying':  return { pulseSpeed: 1.0, ramp: 0.015 };
    case 'blocked':    return { pulseSpeed: 0,   ramp: 0 };     // frozen
    case 'streaming':  return { pulseSpeed: Math.min(3, Math.max(1, 1 + tokenVelocity / 50)), ramp: 0.02 };
    case 'idle':
    default:          return { pulseSpeed: 0.7, ramp: 0.008 };
  }
}

const devWarnedRef = { current: false };

export const NeuralNetworkBackground: React.FC<NeuralNetworkBackgroundProps> = ({
  messageCount,
  state,
  isProcessing,
  activeTab,
  density = 'low',
  baseColor
}) => {
  // Backward compat: isProcessing maps to a synthetic state
  if (isProcessing !== undefined && state === undefined) {
    if (process.env.NODE_ENV === 'development' && !devWarnedRef.current) {
      devWarnedRef.current = true;
      console.warn('[ForgeClaw] NeuralNetworkBackground: isProcessing is deprecated, use `state` from useNeuralState().');
    }
    state = {
      phase: isProcessing ? 'executing' : 'idle',
      provider: 'corpus',
      activeToolCount: 0,
      tokenVelocity: 0,
      errorLevel: 0,
    };
  }
  const neural: NeuralState = state || {
    phase: 'idle', provider: 'corpus', activeToolCount: 0, tokenVelocity: 0, errorLevel: 0,
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<number, Node>>(new Map());
  const connectionsRef = useRef<Connection[]>([]);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const lastMessageCountRef = useRef(messageCount);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const dprRef = useRef(1);
  const isVisibleRef = useRef(true);
  const rafPendingRef = useRef(false);
  // Live refs so the animation closure always sees current state without re-subscribing
  const neuralRef = useRef(neural);
  neuralRef.current = neural;
  const densityRef = useRef(density);
  densityRef.current = density;
  // Auto-density
  const effectiveDensityRef = useRef<'low' | 'medium' | 'high'>(density);
  const fpsSamplesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(0);
  // Verifying sweep
  const sweepStartRef = useRef<number>(0);
  // Tool node assignment (layer 2 node ids lit per in-flight tool)
  const toolNodesRef = useRef<number[]>([]);
  const prevToolCountRef = useRef(0);
  const prevErrorLevelRef = useRef<0 | 1 | 2>(0);
  // Red vignette expiry for errorLevel 2
  const vignetteUntilRef = useRef(0);

  const tabPalette = TAB_PALETTE[activeTab] || TAB_PALETTE.default;
  const providerAccent = PROVIDER_PALETTE[neural.provider] || tabPalette.accent;
  // baseColor takes priority over palettes
  const primaryColor = baseColor || tabPalette.primary;
  const accentColor = baseColor || providerAccent;

  const initNetwork = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;

    // Reset transform before scaling to prevent compounding
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    const nodes = new Map<number, Node>();
    const connections: Connection[] = [];

    const layers = 5;
    const effDensity = effectiveDensityRef.current;
    const nodesPerLayer = DENSITY_MAP[effDensity] || DENSITY_MAP.low;
    const width = rect.width;
    const height = rect.height;

    let nodeId = 0;
    for (let layer = 0; layer < layers; layer++) {
      const count = nodesPerLayer[layer];
      const layerX = (width / (layers + 1)) * (layer + 1);

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + (layer * Math.PI / 4);
        const radius = Math.min(width, height) * 0.15;
        const y = height / 2 + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5);

        nodes.set(nodeId, {
          x: layerX + (Math.random() - 0.5) * 50,
          y: y,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          radius: 3 + Math.random() * 4,
          pulsePhase: Math.random() * Math.PI * 2,
          layer: layer,
          id: nodeId
        });
        nodeId++;
      }
    }

    // Create connections between adjacent layers
    for (let layer = 0; layer < layers - 1; layer++) {
      const currentLayerNodes = Array.from(nodes.values()).filter(n => n.layer === layer);
      const nextLayerNodes = Array.from(nodes.values()).filter(n => n.layer === layer + 1);

      currentLayerNodes.forEach(fromNode => {
        nextLayerNodes.forEach(toNode => {
          if (Math.random() > 0.3) {
            connections.push({
              from: fromNode.id,
              to: toNode.id,
              strength: Math.random(),
              active: false,
              pulseOffset: Math.random() * Math.PI * 2
            });
          }
        });
      });
    }

    nodesRef.current = nodes;
    connectionsRef.current = connections;
    toolNodesRef.current = [];
    prevToolCountRef.current = 0;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const timeouts = timeoutsRef.current;

    const resize = () => initNetwork();

    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
      timeouts.forEach(t => clearTimeout(t));
      timeouts.clear();
    };
  }, [initNetwork]);

  // React to new messages
  useEffect(() => {
    if (messageCount > lastMessageCountRef.current) {
      const connections = connectionsRef.current;
      const shuffled = [...connections].sort(() => Math.random() - 0.5);
      const randomConnections = shuffled.slice(0, 5);

      randomConnections.forEach(conn => {
        conn.active = true;
        const t = setTimeout(() => {
          conn.active = false;
          timeoutsRef.current.delete(t);
        }, 1000);
        timeoutsRef.current.add(t);
      });

      lastMessageCountRef.current = messageCount;
    }
  }, [messageCount]);

  // React to tool count changes: light layer-2 nodes per in-flight tool
  useEffect(() => {
    const count = neural.activeToolCount;
    const prev = prevToolCountRef.current;
    if (count === prev) return;
    prevToolCountRef.current = count;

    const nodes = nodesRef.current;
    const layer2 = Array.from(nodes.values()).filter(n => n.layer === 2);
    if (count > prev) {
      // Light the next free center nodes
      const free = layer2.filter(n => !n.toolLit);
      for (let i = 0; i < count - prev && i < free.length; i++) {
        free[i].toolLit = true;
        toolNodesRef.current.push(free[i].id);
      }
    } else {
      // Release nodes
      const release = toolNodesRef.current.splice(0, prev - count);
      release.forEach(id => {
        const n = nodes.get(id);
        if (n) n.toolLit = false;
      });
    }
  }, [neural.activeToolCount]);

  // React to error level changes: red flashes + vignette
  useEffect(() => {
    const level = neural.errorLevel;
    const prev = prevErrorLevelRef.current;
    prevErrorLevelRef.current = level;
    if (level <= prev) return;

    const connections = connectionsRef.current;
    const now = Date.now();
    const flashes = level >= 2 ? 3 : 1;
    const shuffled = [...connections].sort(() => Math.random() - 0.5);
    shuffled.slice(0, flashes).forEach(conn => {
      conn.redFlashUntil = now + 1200;
    });
    if (level >= 2) {
      vignetteUntilRef.current = now + 3000;
    }
  }, [neural.errorLevel]);

  useEffect(() => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const timeouts = timeoutsRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('[ForgeClaw] Canvas 2D context unavailable — skipping neural background');
        return;
      }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    // Page Visibility API — pause RAF when tab hidden
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      isVisibleRef.current = isVisible;
      if (isVisible && !rafPendingRef.current) {
        rafPendingRef.current = true;
        animationRef.current = requestAnimationFrame(animate);
      } else if (!isVisible) {
        cancelAnimationFrame(animationRef.current);
        rafPendingRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const MAX_VELOCITY = 3;
    const MOUSE_RADIUS = 150;
    const MOUSE_FORCE = 0.5;

    // Pre-calculate RGB from hex (moved outside hot loop)
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 249, g: 115, b: 22 };
    };
    const rgb = hexToRgb(primaryColor);
    const accentRgb = hexToRgb(accentColor);
    const redRgb = { r: 239, g: 68, b: 68 }; // #ef4444

    const drawStatic = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const st = neuralRef.current;

      ctx.clearRect(0, 0, width, height);

      // Background with current palette (red vignette if errorLevel 2 recent)
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 2
      );
      const vignette = Date.now() < vignetteUntilRef.current;
      gradient.addColorStop(0, vignette
        ? `rgba(${redRgb.r}, ${redRgb.g}, ${redRgb.b}, 0.08)`
        : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`);
      gradient.addColorStop(1, 'rgba(10, 10, 10, 0.95)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw nodes in fixed positions (no animation), phase-aware alpha
      const nodes = nodesRef.current;
      const nodeAlpha = st.phase === 'idle' ? 0.5 : 0.9;
      nodes.forEach(node => {
        const radius = node.radius;
        const tint = st.phase === 'blocked' && node.toolLit ? redRgb : rgb;

        // Glow
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, radius * 3
        );
        glowGradient.addColorStop(0, `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${nodeAlpha * 0.25})`);
        glowGradient.addColorStop(1, `rgba(${tint.r}, ${tint.g}, ${tint.b}, 0)`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();

        // Core: center-layer nodes render as 3D Rubik's cubes (min 60px);
        // others keep the arc.
        if (node.layer === 2) {
          const size = Math.max(radius * 2, MIN_CUBE_PX);
          const cubeState: Cube3DState = {
            faces: solvedCubeFaces(),
            rotation: { x: 0.4, y: 0.6, z: 0 },
            scramble: 0, explode: 0,
          };
          const look: CubeLook = {
            angleOffset: 0,
            glow: st.phase === 'blocked' ? 0.8 : 0.4,
            glowColor: st.phase === 'blocked'
              ? { r: 255, g: 59, b: 48 }
              : { r: 255, g: 149, b: 0 },
          };
          drawCube3D(ctx, node.x, node.y, size, cubeState, look);
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();
        }
      });

      // Draw connections at rest strength — red when blocked, matching the
      // animated frame's frozen-red treatment so reduced-motion users get
      // the same phase signal.
      const connections = connectionsRef.current;
      const blockedStatic = st.phase === 'blocked';
      connections.forEach(conn => {
        const fromNode = nodes.get(conn.from);
        const toNode = nodes.get(conn.to);
        if (!fromNode || !toNode) return;

        const tint = blockedStatic ? redRgb : rgb;
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${blockedStatic ? 0.35 : 0.2})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });
    };

    const animate = () => {
      // Skip frame if tab hidden
      if (!isVisibleRef.current) {
        rafPendingRef.current = false;
        return;
      }

      // FPS tracking for auto-density (rolling 2s window)
      const nowMs = performance.now();
      if (lastFrameTimeRef.current > 0) {
        const dt = nowMs - lastFrameTimeRef.current;
        if (dt > 0 && dt < 500) {
          fpsSamplesRef.current.push(1000 / dt);
          if (fpsSamplesRef.current.length > 120) fpsSamplesRef.current.shift();
        }
      }
      lastFrameTimeRef.current = nowMs;
      if (fpsSamplesRef.current.length >= 60) {
        const avg = fpsSamplesRef.current.reduce((a, b) => a + b, 0) / fpsSamplesRef.current.length;
        const maxIdx = DENSITY_ORDER.indexOf(densityRef.current);
        const curIdx = DENSITY_ORDER.indexOf(effectiveDensityRef.current);
        if (avg > 55 && curIdx < maxIdx) {
          effectiveDensityRef.current = DENSITY_ORDER[curIdx + 1];
          fpsSamplesRef.current = [];
          initNetwork();
        } else if (avg < 30 && curIdx > 0) {
          effectiveDensityRef.current = DENSITY_ORDER[curIdx - 1];
          fpsSamplesRef.current = [];
          initNetwork();
        }
        // initNetwork() rebuilds node/connection refs; the loop must continue
        // regardless of whether density changed this frame.
      }

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      const st = neuralRef.current;
      const { pulseSpeed, ramp } = phaseMotion(st.phase, st.tokenVelocity);
      const frozen = st.phase === 'blocked';

      // Draw background gradient (red vignette while errorLevel 2 recent)
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 2
      );
      const vignette = Date.now() < vignetteUntilRef.current;
      if (vignette) {
        gradient.addColorStop(0, `rgba(${redRgb.r}, ${redRgb.g}, ${redRgb.b}, 0.06)`);
      } else {
        gradient.addColorStop(0, 'rgba(15, 15, 15, 0.0)');
      }
      gradient.addColorStop(1, 'rgba(10, 10, 10, 0.4)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const nodes = nodesRef.current;
      const connections = connectionsRef.current;
      const time = Date.now() * 0.001;
      const nowTs = Date.now();

      // Verifying sweep: excite layers 0→4 sequentially over 1.5s
      let sweepLayer = -1;
      if (st.phase === 'verifying') {
        if (sweepStartRef.current === 0) sweepStartRef.current = nowTs;
        const elapsed = (nowTs - sweepStartRef.current) / 1500;
        sweepLayer = Math.floor((elapsed % 1) * 5);
      } else {
        sweepStartRef.current = 0;
      }

      // Update and draw connections
      connections.forEach(conn => {
        const fromNode = nodes.get(conn.from);
        const toNode = nodes.get(conn.to);
        if (!fromNode || !toNode) return;

        if (frozen) {
          // blocked: freeze strength where it is
        } else if (conn.active || st.phase === 'executing' || st.phase === 'streaming') {
          conn.strength = Math.min(1, conn.strength + ramp);
        } else {
          conn.strength = Math.max(0.1, conn.strength - 0.01);
        }

        const flashing = conn.redFlashUntil !== undefined && nowTs < conn.redFlashUntil;
        const tint = flashing || (frozen && conn.active) ? redRgb : rgb;
        const alpha = conn.strength * (0.6 + Math.sin(time * 2 + conn.pulseOffset) * 0.15);

        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${alpha})`;
        ctx.lineWidth = conn.strength * 1.5;
        ctx.stroke();

        // Pulses travel unless frozen
        const showPulse = !frozen && (conn.active || ((st.phase === 'executing' || st.phase === 'streaming') && conn.strength > 0.5));
        if (showPulse) {
          const progress = (time * 2 * pulseSpeed + conn.pulseOffset) % 1;
          const pulseX = fromNode.x + (toNode.x - fromNode.x) * progress;
          const pulseY = fromNode.y + (toNode.y - fromNode.y) * progress;

          ctx.beginPath();
          ctx.arc(pulseX, pulseY, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${0.8 * conn.strength})`;
          ctx.fill();
        }
      });

      // Update and draw nodes
      nodes.forEach(node => {
        if (!frozen) {
          node.x += node.vx;
          node.y += node.vy;

          // Boundary check with bounce
          if (node.x < 50) { node.x = 50; node.vx *= -0.8; }
          if (node.x > width - 50) { node.x = width - 50; node.vx *= -0.8; }
          if (node.y < 50) { node.y = 50; node.vy *= -0.8; }
          if (node.y > height - 50) { node.y = height - 50; node.vy *= -0.8; }

          // Mouse interaction — guard against exact-zero only
          const dx = mouseRef.current.x - node.x;
          const dy = mouseRef.current.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_RADIUS && dist > 0) {
            const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
            node.vx -= (dx / dist) * force * MOUSE_FORCE;
            node.vy -= (dy / dist) * force * MOUSE_FORCE;
          }

          // Velocity cap
          const velocity = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
          if (velocity > MAX_VELOCITY) {
            node.vx = (node.vx / velocity) * MAX_VELOCITY;
            node.vy = (node.vy / velocity) * MAX_VELOCITY;
          }

          // Damping
          node.vx *= 0.99;
          node.vy *= 0.99;
        }

        // Pulse animation (frozen mid-travel when blocked: use fixed time)
        const effTime = frozen ? 0 : time;
        const pulse = Math.sin(effTime * 3 * pulseSpeed + node.pulsePhase) * 0.3 + 1;
        const sweeping = sweepLayer === node.layer;
        const radius = node.radius * pulse * (st.phase === 'executing' || st.phase === 'streaming' ? 1.2 : 1) * (sweeping ? 1.6 : 1);
        const toolBoost = node.toolLit ? 1.5 : 1;

        // Glow effect — fixed: idle dims to 0.5, active phases 0.9
        const glowRadius = radius * 3 * toolBoost;
        const glowGradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, glowRadius
        );

        const alpha = st.phase === 'idle' ? 0.5 : 0.9;
        const nodeTint = (frozen && node.toolLit) || (node.toolLit && st.errorLevel > 0) ? redRgb : rgb;
        const glowTint = sweeping ? accentRgb : nodeTint;
        glowGradient.addColorStop(0, `rgba(${glowTint.r}, ${glowTint.g}, ${glowTint.b}, ${alpha})`);
        glowGradient.addColorStop(0.5, `rgba(${glowTint.r}, ${glowTint.g}, ${glowTint.b}, ${alpha * 0.5})`);
        glowGradient.addColorStop(1, `rgba(${glowTint.r}, ${glowTint.g}, ${glowTint.b}, 0)`);

        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();

        // Core: center-layer nodes render as 3D Rubik's cubes (min 60px,
        // scaled by toolBoost); others keep the arc.
        if (node.layer === 2) {
          const size = Math.max(radius * toolBoost * 2, MIN_CUBE_PX);
          const t = performance.now() / 1000;
          const cubeState: Cube3DState = {
            faces: solvedCubeFaces(),
            rotation: {
              x: 0.4 + Math.sin(t * 0.5 + node.x * 0.01) * 0.2,
              y: 0.6 + t * 0.3 + node.y * 0.01,
              z: 0,
            },
            scramble: 0, explode: 0,
          };
          const look: CubeLook = {
            angleOffset: 0,
            glow: st.phase === 'blocked' ? 0.8 : 0.4,
            glowColor: st.phase === 'blocked'
              ? { r: 255, g: 59, b: 48 }
              : { r: 255, g: 149, b: 0 },
          };
          drawCube3D(ctx, node.x, node.y, size, cubeState, look);
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius * toolBoost, 0, Math.PI * 2);
          ctx.fillStyle = primaryColor;
          ctx.fill();
        }

        // Highlight
        ctx.beginPath();
        ctx.arc(node.x - radius * 0.3, node.y - radius * 0.3, radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
      });

      // Tab-specific accent particles
      if (activeTab === 'forgemind' || activeTab === 'orchestrator') {
        nodes.forEach(node => {
          if (node.layer === 2 && Math.random() > 0.98) {
            ctx.beginPath();
            ctx.arc(node.x, node.y - 30, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.6)`;
            ctx.fill();
          }
        });
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    // Check reduced-motion preference — subscribe to changes mid-session
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isRunning = !motionQuery.matches;

    const handleMotionChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const matches = 'matches' in e ? e.matches : (e as MediaQueryList).matches;
      if (matches) {
        cancelAnimationFrame(animationRef.current);
        rafPendingRef.current = false;
        isRunning = false;
        drawStatic();
      } else {
        if (!rafPendingRef.current) {
          rafPendingRef.current = true;
          isRunning = true;
          animationRef.current = requestAnimationFrame(animate);
        }
      }
    };

    // Modern API + fallback for older Safari
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', handleMotionChange);
    } else if ((motionQuery as MediaQueryList).addListener) {
      (motionQuery as MediaQueryList).addListener(handleMotionChange);
    }

    // Initial state
    if (isRunning) {
      rafPendingRef.current = true;
      animationRef.current = requestAnimationFrame(animate);
    } else {
      drawStatic();
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (motionQuery.removeEventListener) {
        motionQuery.removeEventListener('change', handleMotionChange);
      } else if ((motionQuery as MediaQueryList).removeListener) {
        (motionQuery as MediaQueryList).removeListener(handleMotionChange);
      }
      cancelAnimationFrame(animationRef.current);
      timeouts.forEach(t => clearTimeout(t));
      timeouts.clear();
    };
  } catch (err) {
    console.warn('[ForgeClaw] NeuralNetworkBackground init failed:', err);
  }
  // Re-init animation when tab palette changes; phase/provider flow via neuralRef (no re-subscribe)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, primaryColor, accentColor]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.6 }}
      />
    </div>
  );
};

export default NeuralNetworkBackground;
