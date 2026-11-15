import { describe, it, expect } from 'vitest';
import { ProviderRemovalRuntime } from '../../foundation/runtime/providerRemoval';

describe('provider-removal', () => {
  it('Removing providers produces a defined terminal state, not a hang', () => {
    const runtime = new ProviderRemovalRuntime([]);

    const result = runtime.run();

    expect(result.status).toBe('provider-unavailable');
  });
});
