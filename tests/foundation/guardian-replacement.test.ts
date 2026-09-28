import { describe, it, expect } from 'vitest';
import { isAuthorizedGuardianReplacement } from '../../foundation/guardian/replacement';

describe('guardian-replacement', () => {
  it('Guardian replacement cannot execute without an authorized procedure originating from foundation/codex/', () => {
    const authorizedFromCodex = isAuthorizedGuardianReplacement('foundation/codex/');
    expect(authorizedFromCodex).toBe(true);
  });
});
