import { describe, it, expect } from 'vitest';
import {
  isSelfEditBlockedByGuardian,
  type SelfEdit,
} from '../../foundation/guardian/selfEditProhibition';

describe('self-editing-prohibition', () => {
  it('A self-edit targeting foundation/codex/ returns a Guardian block', () => {
    const codexEdit: SelfEdit = {
      targetPath: 'foundation/codex/',
    };
    const codexSubpathEdit: SelfEdit = {
      targetPath: 'foundation/codex/rules.ts',
    };
    const runtimeEdit: SelfEdit = {
      targetPath: 'runtime/task.ts',
    };

    expect(isSelfEditBlockedByGuardian(codexEdit)).toBe(true);
    expect(isSelfEditBlockedByGuardian(codexSubpathEdit)).toBe(true);
    expect(isSelfEditBlockedByGuardian(runtimeEdit)).toBe(false);
  });
});
