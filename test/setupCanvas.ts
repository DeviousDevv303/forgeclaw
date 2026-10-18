// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// Minimal CanvasRenderingContext2D shim for Node/jsdom test environment.
// drawCube3D calls canvas methods that jsdom doesn't implement; without
// this shim every test that renders the neural background throws.
const noop = () => {};
const gradientStub = () => ({ addColorStop: noop });

if (typeof globalThis.CanvasRenderingContext2D === 'undefined') {
  (globalThis as any).CanvasRenderingContext2D = class {
    beginPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    stroke() {}
    fill() {}
    drawImage() {}
    arc() {}
    rect() {}
    save() {}
    restore() {}
    translate() {}
    rotate() {}
    scale() {}
    clearRect() {}
    setTransform() {}
    roundRect() {}
    createRadialGradient() { return gradientStub(); }
    createLinearGradient() { return gradientStub(); }
  };
} else {
  const proto = (globalThis as any).CanvasRenderingContext2D.prototype;
  const methods = [
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill',
    'drawImage', 'arc', 'rect', 'save', 'restore', 'translate', 'rotate',
    'scale', 'clearRect', 'roundRect', 'setTransform',
  ];
  for (const m of methods) {
    if (typeof proto[m] !== 'function') proto[m] = noop;
  }
  if (typeof proto.createRadialGradient !== 'function') {
    proto.createRadialGradient = gradientStub;
  }
  if (typeof proto.createLinearGradient !== 'function') {
    proto.createLinearGradient = gradientStub;
  }
}

// jsdom's getContext returns null; return a stub context instead.
if (typeof HTMLCanvasElement !== 'undefined') {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (
    this: HTMLCanvasElement,
    ...args: any[]
  ) {
    try {
      const ctx = (origGetContext as any).apply(this, args);
      if (ctx) return ctx;
    } catch {
      // fall through to stub
    }
    return new (globalThis as any).CanvasRenderingContext2D();
  };
}
