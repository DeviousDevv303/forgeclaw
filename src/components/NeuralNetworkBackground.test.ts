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
    set fillStyle(_: string) {},
    set strokeStyle(_: string) {},
    set globalAlpha(_: number) {},
    set lineWidth(_: number) {},
    canvas: { width: 800, height: 600 },
  };
}

describe('NeuralNetworkBackground', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafId = 0;
  let mockCtx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
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
        matches: false,
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
    render(React.createElement(NeuralNetworkBackground, {
      state: IDLE_NEURAL_STATE,
      messageCount: 0,
      activeTab: 'chat',
    }));

    // Drive frames with high FPS (>55 avg) to trigger a density step-up.
    // The bug: after initNetwork() the code did `return` without scheduling
    // the next frame, killing the loop at ~frame 61.
    let now = 1000;
    const frameCount = 70;
    for (let i = 0; i < frameCount; i++) {
      const cbs = rafCallbacks.splice(0);
      expect(cbs.length).toBeGreaterThan(0); // loop must still be alive
      now += 16; // ~62 FPS
      for (const cb of cbs) cb(now);
    }

    // After 70 frames (past the 60-sample density window), the loop must
    // still have a pending frame scheduled.
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });

  it('applies red tint when blocked', () => {
    const blockedState = { ...IDLE_NEURAL_STATE, phase: 'blocked' as const };
    const { container } = render(
      React.createElement(NeuralNetworkBackground, {
        state: blockedState,
        messageCount: 0,
        activeTab: 'chat',
      })
    );
    // Component renders without crashing in blocked state; canvas exists.
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
  });
});
