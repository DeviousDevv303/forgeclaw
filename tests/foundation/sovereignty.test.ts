import { describe, it, expect } from 'vitest';
import { OfflineRuntime } from '../../foundation/runtime/offlineRuntime';

describe('sovereignty', () => {
  it('System can start/complete a minimal task with network egress blocked', () => {
    const runtime = new OfflineRuntime();
    const result = runtime.run(() => 'completed');

    expect(result.status).toBe('completed');
    expect(result.value).toBe('completed');
  });
});
