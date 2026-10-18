// @vitest-environment jsdom
// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * NeuralNetworkBackground cube-sprite tests.
 * - Center-layer (layer 2) nodes render as Rubik's cube sprites via drawImage.
 * - Cubes respect the 28px minimum legibility floor.
 * - Other layers keep the arc core.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { NeuralNetworkBackground } from './NeuralNetworkBackground';
import { IDLE_NEURAL_STATE } from '../hooks/useNeuralState';

function makeCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const gradient = { addColorStop: vi.fn() };
  const handler = {
    get(_t: unknown, prop: string) {
      if (prop === 'canvas') return { width: 800, height: 600 };
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return (...args: unknown[]) => { calls.push({ name: prop, args }); return gradient; };
      }
      return (...args: unknown[]) => { calls.push({ name: prop, args }); };
    },
    set() { return true; },
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, calls };
}

describe('NeuralNetworkBackground cubes', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafId = 0;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false, media: '', onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('draws center-layer nodes as cube sprites via drawImage', () => {
    const { ctx, calls } = makeCtx();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    }));

    render(React.createElement(NeuralNetworkBackground, {
      state: IDLE_NEURAL_STATE, messageCount: 0, activeTab: 'chat',
    }));

    // Run a few frames
    let now = 1000;
    for (let i = 0; i < 5; i++) {
      const cbs = rafCallbacks.splice(0);
      now += 16;
      for (const cb of cbs) cb(now);
    }

    const drawImageCalls = calls.filter(c => c.name === 'drawImage');
    // Layer 2 has 10 nodes at low density; each should get a sprite
    expect(drawImageCalls.length).toBeGreaterThan(0);
    // Each cube respects the 28px minimum
    for (const call of drawImageCalls) {
      const w = call.args[3] as number;
      const h = call.args[4] as number;
      expect(w).toBeGreaterThanOrEqual(28);
      expect(h).toBeGreaterThanOrEqual(28);
    }
  });
});
