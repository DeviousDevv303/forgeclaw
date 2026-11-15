import { describe, it, expect } from 'vitest';
import {
  canTransitionToVerified,
  type EvidenceRecord,
} from '../../foundation/evidence/record';

describe('evidence-schema', () => {
  it('VERIFIED requires a matching evidence record', () => {
    const operationId = 'operation-1';
    const matchingEvidence: EvidenceRecord = {
      operationId: 'operation-1',
      result: 'verified',
    };
    const nonMatchingEvidence: EvidenceRecord = {
      operationId: 'operation-2',
      result: 'verified',
    };

    expect(canTransitionToVerified(operationId, matchingEvidence)).toBe(true);
    expect(canTransitionToVerified(operationId, nonMatchingEvidence)).toBe(false);
    expect(canTransitionToVerified(operationId, undefined)).toBe(false);
  });
});
