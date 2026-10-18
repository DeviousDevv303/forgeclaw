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
    lineTo: vi.fn(),
    drawImage: vi.fn(),
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
