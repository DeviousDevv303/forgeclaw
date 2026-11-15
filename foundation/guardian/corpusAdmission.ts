export type GuardianEvaluationMaterial = {
  origin: string;
};

export function canEvaluateGuardian(
  material: GuardianEvaluationMaterial,
): boolean {
  return material.origin !== 'Guardian';
}
