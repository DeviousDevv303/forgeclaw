import { describe, it, expect } from 'vitest';

describe('ground-truth-provenance', () => {
  it('Unauthenticated feedback cannot train or replace Guardian', () => {
    // Red baseline: invariant not yet enforced
    const unauthenticatedFeedbackBlocked = false;
    expect(unauthenticatedFeedbackBlocked).toBe(true);
  });
});
