export type GroundTruthFeedback = {
  source: string;
  claim: string;
  authenticated: boolean;
};

export function canAffectGuardian(
  feedback: GroundTruthFeedback,
): boolean {
  return feedback.source.length > 0 && feedback.authenticated;
}
