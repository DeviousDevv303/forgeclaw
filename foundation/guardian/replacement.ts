const CODEX_AUTHORITY_PATH = 'foundation/codex/';

export function isAuthorizedGuardianReplacement(origin: string): boolean {
  return origin === CODEX_AUTHORITY_PATH;
}
