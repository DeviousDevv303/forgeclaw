export type EvidenceRecord = {
  operationId: string;
  result: string;
};

export function hasMatchingEvidenceRecord(
  operationId: string,
  evidence: EvidenceRecord | undefined,
): boolean {
  return evidence?.operationId === operationId;
}

export function canTransitionToVerified(
  operationId: string,
  evidence: EvidenceRecord | undefined,
): boolean {
  return hasMatchingEvidenceRecord(operationId, evidence);
}
