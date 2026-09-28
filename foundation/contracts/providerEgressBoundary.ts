const GUARDIAN_EGRESS_GATE = Symbol('guardian-egress-gate');

export function guardianEgressToken(): symbol {
  return GUARDIAN_EGRESS_GATE;
}

export function isProviderEgressAuthorized(authority: unknown): boolean {
  return authority === GUARDIAN_EGRESS_GATE;
}
