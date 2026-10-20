// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * NeuralNetworkBackground tests.
 * - Animation loop must survive automatic density changes (regression: a
 *   `return` after initNetwork() killed the loop at ~frame 61).
 * - Blocked state: red tint applies in both animated and static paths.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { NeuralNetworkBackground } from './NeuralNetworkBackground';
import { drawRubik3D } from './cube3d';

// Watch what the renderer hands to the 3D cube drawer (rotation, explode, flash)
// while still drawing for real.
vi.mock('./cube3d', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./cube3d')>();
  return { ...mod, drawCube3D: vi.fn(mod.drawCube3D), drawRubik3D: vi.fn(mod.drawRubik3D) };
});
// The animated cubes are drawn by drawRubik3D since the real-turns change;
// its (state, look) arguments sit in the same positions the tests assert on.
const cubeCalls = () => vi.mocked(drawRubik3D).mock.calls;
import { IDLE_NEURAL_STATE } from '../hooks/useNeuralState';

// ---- Canvas + RAF mocks ----------------------------------------------------

function makeCtx() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    closePath: vi.fn(),
    lineTo: vi.fn(),
    drawImage: vi.fn(),
    roundRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    rect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    styles: [] as string[],
    set fillStyle(v: string) { this.styles.push(String(v)) },
    set strokeStyle(v: string) { this.styles.push(String(v)) },
    set globalAlpha(_: number) {},
    set lineWidth(_: number) {},
    canvas: { width: 800, height: 600 },
  };
}

describe('NeuralNetworkBackground', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafId = 0;
  let mockCtx: ReturnType<typeof makeCtx>;
  let reducedMotion = false;
  let clock = 0;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    reducedMotion = false;
    clock = 1000;
    // The component measures FPS with performance.now(), not the RAF timestamp.
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    mockCtx = makeCtx();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    }));

    // matchMedia for reduced-motion check
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: reducedMotion && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the animation loop running after an automatic density change', () => {
    // Start at 'high' so a slow device can step DOWN (step-up is impossible at the cap).
    render(React.createElement(NeuralNetworkBackground, {
      state: IDLE_NEURAL_STATE,
      messageCount: 0,
      activeTab: 'chat',
      density: 'high',
    }));

    // ~20 FPS (50 ms/frame) for 150 frames: the 60-sample window fills and the
    // average (<30) forces a step-down and initNetwork(). Regression guarded: a
    // `return` after initNetwork() skipped requestAnimationFrame and killed the loop.
    // Then ~62 FPS (16 ms/frame): the average climbs past 55 and density steps
    // back UP, exercising the other initNetwork() branch.
    for (let i = 0; i < 300; i++) {
      const cbs = rafCallbacks.splice(0);
      expect(cbs.length, `loop died at frame ${i}`).toBeGreaterThan(0);
      clock += i < 150 ? 50 : 16;
      for (const cb of cbs) cb(clock);
    }
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });

  it('still starts on engines without ctx.roundRect (older Chrome/WebView/Safari)', async () => {
    const legacy = mockCtx as unknown as { roundRect?: unknown };
    delete legacy.roundRect;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Fresh module: the cube sprite is cached at module scope by earlier tests.
    vi.resetModules();
    const fresh = await import('./NeuralNetworkBackground');
    render(React.createElement(fresh.NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }));
    expect(warn.mock.calls.some(args => String(args[0]).includes('init failed'))).toBe(false);
    for (let i = 0; i < 5; i++) {
      const cbs = rafCallbacks.splice(0);
      expect(cbs.length, `loop died at frame ${i}`).toBeGreaterThan(0);
      clock += 16;
      for (const cb of cbs) cb(clock);
    }
  });

  it('spins the cubes while executing and freezes them when blocked', () => {
    const angles = (phase: 'executing' | 'blocked') => {
      rafCallbacks.length = 0
      const { unmount } = render(React.createElement(NeuralNetworkBackground, { state: { ...IDLE_NEURAL_STATE, phase }, messageCount: 0, activeTab: 'chat' }))
      const seen: number[] = []
      for (let i = 0; i < 6; i++) {
        vi.mocked(drawRubik3D).mockClear()
        const cbs = rafCallbacks.splice(0)
        clock += 50
        for (const cb of cbs) cb(clock)
        if (cubeCalls().length) seen.push(cubeCalls()[0][4].rotation.y)
      }
      unmount()
      return seen
    }
    const spinning = angles('executing')
    expect(spinning.length).toBeGreaterThan(2)
    expect(new Set(spinning.map(a => a.toFixed(4))).size).toBeGreaterThan(2)
    const frozen = angles('blocked')
    expect(frozen.length).toBeGreaterThan(2)
    expect(new Set(frozen.slice(1).map(a => a.toFixed(4))).size).toBe(1)
  })

  it('keeps a blocked cube frozen even while the wall clock is inside its calm idle turn', () => {
    // The calm idle quarter turn is timed off Date.now(). Pin the clock at 7.7 s, where one of the ten
    // cubes is mid-turn, and let it move 5 ms per read, as it does on a loaded CI runner.
    let wall = 7_700
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => (wall += 5))
    try {
      rafCallbacks.length = 0
      const { unmount } = render(React.createElement(NeuralNetworkBackground, { state: { ...IDLE_NEURAL_STATE, phase: 'blocked' }, messageCount: 0, activeTab: 'chat' }))
      // Every cube's angle per frame. Which cube is mid-turn depends on its node id, so check them all.
      const frames: string[][] = []
      for (let i = 0; i < 6; i++) {
        vi.mocked(drawRubik3D).mockClear()
        const cbs = rafCallbacks.splice(0)
        clock += 50
        for (const cb of cbs) cb(clock)
        frames.push(cubeCalls().map(call => call[4].rotation.y.toFixed(4)))
      }
      unmount()
      expect(frames.length).toBe(6)
      expect(frames[1].length).toBeGreaterThan(0)
      for (const frame of frames.slice(2)) expect(frame).toEqual(frames[1])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('flashes the cubes green when the core reports success', () => {
    render(React.createElement(NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }))
    window.dispatchEvent(new CustomEvent('forgeclaw:state', { detail: { state: 'success', activity: 0.3, intensity: 6, source: 'agent', timestamp: Date.now(), emotion: 'satisfied', energy: 20 } }))
    vi.mocked(drawRubik3D).mockClear()
    for (let i = 0; i < 3; i++) { const cbs = rafCallbacks.splice(0); clock += 16; for (const cb of cbs) cb(clock) }
    expect(cubeCalls().some(c => c[5].flash?.color.g === 255 && c[5].flash.color.r === 0)).toBe(true)
  })

  it('cubes follow the reactive core: pieces explode on an error event from window', () => {
    render(React.createElement(NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }))
    const frame = () => { const cbs = rafCallbacks.splice(0); clock += 16; for (const cb of cbs) cb(clock) }
    frame(); vi.mocked(drawRubik3D).mockClear(); frame()
    expect(cubeCalls().length).toBeGreaterThan(0)
    expect(cubeCalls().every(c => c[4].explode === 0)).toBe(true)
    window.dispatchEvent(new CustomEvent('forgeclaw:state', { detail: { state: 'error', activity: 1, intensity: 7, source: 'shell', timestamp: Date.now(), emotion: 'angry', energy: 90 } }))
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 300) // mid-explosion
    vi.mocked(drawRubik3D).mockClear(); frame()
    expect(cubeCalls().some(c => c[4].explode > 0.5)).toBe(true)
    expect(cubeCalls().some(c => c[5].glowColor.r === 255 && c[5].glowColor.b === 68)).toBe(true)
    vi.mocked(Date.now).mockRestore()
  })

  it('views the cubes from above (white top showing), like the big cube', () => {
    render(React.createElement(NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }))
    vi.mocked(drawRubik3D).mockClear()
    const cbs = rafCallbacks.splice(0); clock += 16; for (const cb of cbs) cb(clock)
    expect(cubeCalls().length).toBeGreaterThan(0)
    expect(cubeCalls().every(c => c[4].rotation.x < 0)).toBe(true)
  })

  it('plays the git-fetch wave left to right across the cubes', () => {
    render(React.createElement(NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }))
    const t0 = Date.now()
    window.dispatchEvent(new CustomEvent('forgeclaw:state', { detail: { state: 'running', activity: 0.8, intensity: 4, source: 'git', timestamp: t0, emotion: 'excited', energy: 40, gesture: 'wave' } }))
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 250)
    vi.mocked(drawRubik3D).mockClear()
    const cbs = rafCallbacks.splice(0); clock += 16; for (const cb of cbs) cb(clock)
    const flashes = cubeCalls().filter(c => c[5].flash?.color.b === 255).length
    expect(flashes).toBeGreaterThan(0)
    expect(flashes).toBeLessThan(cubeCalls().length) // not all at once: it travels
    vi.mocked(Date.now).mockRestore()
  })

  it('draws the reduced-motion static frame in red when blocked, and not when idle', () => {
    reducedMotion = true;
    const RED = 'rgba(239, 68, 68';
    render(React.createElement(NeuralNetworkBackground, { state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat' }));
    expect(mockCtx.styles.length).toBeGreaterThan(0);
    expect(mockCtx.styles.some(c => c.startsWith(RED))).toBe(false);

    mockCtx.styles.length = 0;
    const blocked = { ...IDLE_NEURAL_STATE, phase: 'blocked' as const };
    render(React.createElement(NeuralNetworkBackground, { state: blocked, messageCount: 0, activeTab: 'chat' }));
    expect(mockCtx.styles.some(c => c.startsWith(RED))).toBe(true);
  });
});
