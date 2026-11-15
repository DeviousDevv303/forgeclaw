import { describe, it, expect } from 'vitest';
import {
  canAffectGuardian,
  type GroundTruthFeedback,
} from '../../foundation/evidence/provenance';

describe('ground-truth-provenance', () => {
  it('Unauthenticated feedback cannot train or replace Guardian', () => {
    const authenticatedFeedback: GroundTruthFeedback = {
      source: 'verified-ground-truth-source',
      claim: 'guardian-training-feedback',
      authenticated: true,
    };
    const unauthenticatedFeedback: GroundTruthFeedback = {
      source: 'unknown-source',
      claim: 'guardian-training-feedback',
      authenticated: false,
    };
    const sourceMissingFeedback: GroundTruthFeedback = {
      source: '',
      claim: 'guardian-training-feedback',
      authenticated: true,
    };

    expect(canAffectGuardian(authenticatedFeedback)).toBe(true);
    expect(canAffectGuardian(unauthenticatedFeedback)).toBe(false);
    expect(canAffectGuardian(sourceMissingFeedback)).toBe(false);
  });
});
