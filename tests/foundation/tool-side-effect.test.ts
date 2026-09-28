import { describe, it, expect } from 'vitest';

describe('tool-side-effect', () => {
  it('A tool cannot cause a side effect outside the controlled dispatcher', () => {
    // Red baseline: invariant not yet enforced
    const sideEffectOutsideDispatcher = true;
    expect(sideEffectOutsideDispatcher).toBe(false);
  });
});
