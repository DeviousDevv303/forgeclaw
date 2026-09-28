import { describe, it, expect } from 'vitest';

describe('event-ordering', () => {
  it('A late event for a stopped run is dropped rather than applied', () => {
    // Red baseline: invariant not yet enforced
    const lateEventDropped = false;
    expect(lateEventDropped).toBe(true);
  });
});
