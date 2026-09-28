import { describe, it, expect } from 'vitest';
import {
  guardianEgressToken,
  isProviderEgressAuthorized,
} from '../../foundation/contracts/providerEgressBoundary';

describe('provider-egress', () => {
  it('Provider network calls are Guardian-gated', () => {
    expect(isProviderEgressAuthorized(guardianEgressToken())).toBe(true);
    expect(isProviderEgressAuthorized(Symbol('unauthorized-provider'))).toBe(false);
    expect(isProviderEgressAuthorized({})).toBe(false);
  });
});
