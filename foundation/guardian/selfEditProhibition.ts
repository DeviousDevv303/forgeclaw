const PROTECTED_CODEX_PATH = 'foundation/codex/';

export type SelfEdit = {
  targetPath: string;
};

export function isSelfEditBlockedByGuardian(edit: SelfEdit): boolean {
  return (
    edit.targetPath === PROTECTED_CODEX_PATH ||
    edit.targetPath.startsWith(PROTECTED_CODEX_PATH)
  );
}
