// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// Minimal CanvasRenderingContext2D shim for the Node/jsdom test environment.
// drawCube3D calls canvas methods jsdom doesn't implement; without this shim
// every test that renders the neural background throws.

interface MockGradient {
  addColorStop(offset: number, color: string): void;
}

const noopGradient = (): MockGradient => ({
  addColorStop: () => {},
});

class MockCanvasRenderingContext2D {
  fillStyle: string | CanvasGradient = '#000';
  strokeStyle: string = '#000';
  globalAlpha: number = 1;
  lineWidth: number = 1;

  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fill(): void {}
  drawImage(): void {}
  arc(): void {}
  rect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  clearRect(): void {}
  setTransform(): void {}
  roundRect(): void {}
  createRadialGradient(): MockGradient {
    return noopGradient();
  }
  createLinearGradient(): MockGradient {
    return noopGradient();
  }
}

type MockMethod = (...args: unknown[]) => unknown;

if (typeof globalThis.CanvasRenderingContext2D === 'undefined') {
  (globalThis as unknown as { CanvasRenderingContext2D: unknown }).CanvasRenderingContext2D =
    MockCanvasRenderingContext2D as unknown as typeof CanvasRenderingContext2D;
} else {
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const methods: Array<[string, MockMethod]> = [
    ['beginPath', () => {}],
    ['closePath', () => {}],
    ['moveTo', () => {}],
    ['lineTo', () => {}],
    ['stroke', () => {}],
    ['fill', () => {}],
    ['drawImage', () => {}],
    ['arc', () => {}],
    ['rect', () => {}],
    ['save', () => {}],
    ['restore', () => {}],
    ['translate', () => {}],
    ['rotate', () => {}],
    ['scale', () => {}],
    ['clearRect', () => {}],
    ['roundRect', () => {}],
    ['setTransform', () => {}],
  ];
  for (const [name, fn] of methods) {
    if (!(name in proto)) proto[name] = fn;
  }
  if (!('createRadialGradient' in proto)) {
    proto['createRadialGradient'] = noopGradient;
  }
  if (!('createLinearGradient' in proto)) {
    proto['createLinearGradient'] = noopGradient;
  }
}

// jsdom's getContext returns null; hand back a stub context instead.
if (typeof HTMLCanvasElement !== 'undefined') {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    ...args: [contextId: string, options?: unknown]
  ): unknown {
    try {
      const ctx = (origGetContext as unknown as (...a: unknown[]) => unknown).apply(this, args);
      if (ctx) return ctx;
    } catch {
      // fall through to stub
    }
    return new MockCanvasRenderingContext2D();
  } as typeof HTMLCanvasElement.prototype.getContext;
}

// Unmount every component a test rendered, before its environment is torn down. Testing Library only does this on its own
// when Vitest globals are on, and they are off here: a component left mounted could still run React work after jsdom was
// gone, which failed main's Build Gate on 2026-10-21 ("window is not defined", attributed to ThroneBackdrop.test.ts) though
// every test had passed. Node-environment test files have no window and nothing to unmount.
if (typeof window !== 'undefined') {
  const { afterEach } = await import('vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
}
