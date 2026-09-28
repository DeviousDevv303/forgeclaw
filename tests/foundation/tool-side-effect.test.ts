import { describe, it, expect } from 'vitest';
import {
  controlledDispatcherToken,
  mayCauseSideEffect,
} from '../../foundation/contracts/toolSideEffectBoundary';

describe('tool-side-effect', () => {
  it('A tool cannot cause a side effect outside the controlled dispatcher', () => {
    expect(mayCauseSideEffect(controlledDispatcherToken())).toBe(true);
    expect(mayCauseSideEffect(Symbol('uncontrolled-tool'))).toBe(false);
    expect(mayCauseSideEffect({})).toBe(false);
  });
});
