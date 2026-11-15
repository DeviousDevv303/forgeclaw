import { describe, it, expect } from 'vitest';
import {
  canEvaluateGuardian,
  type GuardianEvaluationMaterial,
} from '../../foundation/guardian/corpusAdmission';

describe('corpus-admission', () => {
  it('Guardian-originated material cannot evaluate Guardian', () => {
    const guardianMaterial: GuardianEvaluationMaterial = {
      origin: 'Guardian',
    };
    const externalMaterial: GuardianEvaluationMaterial = {
      origin: 'external-source',
    };

    expect(canEvaluateGuardian(guardianMaterial)).toBe(false);
    expect(canEvaluateGuardian(externalMaterial)).toBe(true);
  });
});
