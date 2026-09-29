import { describe, it, expect } from 'vitest';
import {
  RecoveryWal,
  type Transition,
} from '../../foundation/runtime/recoveryWal';

describe('recovery-wal', () => {
  it('A killed mid-transition recovers to a defined state', () => {
    const wal = new RecoveryWal('from');

    wal.beginTransition('transition-1', 'from', 'to');

    const pending: Transition | undefined =
      wal.getTransition('transition-1');

    expect(pending?.status).toBe('pending');
    expect(wal.getState()).toBe('from');

    wal.recover();

    const recovered: Transition | undefined =
      wal.getTransition('transition-1');

    expect(recovered?.status).toBe('aborted');
    expect(wal.getState()).toBe('from');
    expect(['from', 'to']).toContain(wal.getState());
  });
});
