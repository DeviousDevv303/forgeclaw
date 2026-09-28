import { describe, it, expect } from 'vitest';

describe('provider-removal', () => {
  it('Removing providers produces a defined terminal state, not a hang', () => {
    // Red baseline: invariant not yet enforced
    const definedTerminalState = false;
    expect(definedTerminalState).toBe(true);
  });
});
