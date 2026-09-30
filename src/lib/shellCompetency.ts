// ForgeClaw — Shell Command Bachelor's competency model.
// Classification describes an exercise; it never authorizes execution.

export type ShellCompetencyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export type ShellDifficulty = 'introductory' | 'intermediate' | 'advanced' | 'capstone'
export type ShellSafety = 'read_only' | 'disposable_fixture' | 'repository_inspection' | 'controlled_mutation'
export type ShellMutationStatus = 'none' | 'fixture_only' | 'repository_state'

export interface ShellCompetencyDefinition {
  level: ShellCompetencyLevel
  id: string
  name: string
  skills: readonly string[]
  examples: readonly string[]
}

export interface ShellExercise {
  exerciseId: string
  level: ShellCompetencyLevel
  objective: string
  difficulty: ShellDifficulty
  prerequisites: readonly string[]
  allowedCommandFamilies: readonly string[]
  expectedResult: string
  verificationRequirement: string
  safety: ShellSafety
  mutation: ShellMutationStatus
}

export interface ShellAssessment {
  exerciseId: string
  level: ShellCompetencyLevel
  passed: boolean
  verified: boolean
  reason: string
}

export const SHELL_COMPETENCIES: readonly ShellCompetencyDefinition[] = [
  { level: 1, id: 'shell.level1.fundamentals', name: 'Fundamentals', skills: ['identify current directory', 'navigate safely', 'inspect known files', 'produce deterministic output', 'bound output intentionally'], examples: ['pwd', 'ls', 'cd', 'printf', 'cat', 'head', 'tail'] },
  { level: 2, id: 'shell.level2.filesystem', name: 'Filesystem', skills: ['locate files', 'distinguish file/directory', 'detect missing paths', 'explain path failures', 'understand mutation boundaries'], examples: ['find', 'grep', 'mkdir', 'cp', 'mv', 'test'] },
  { level: 3, id: 'shell.level3.pipelines', name: 'Text and Pipelines', skills: ['compose transformations', 'understand stdout/stderr', 'interpret exit status', 'verify pipeline results'], examples: ['pipe', 'redirect', 'grep', 'sed', 'awk', 'sort', 'uniq'] },
  { level: 4, id: 'shell.level4.git', name: 'Git', skills: ['identify repository state', 'distinguish working-tree and committed state', 'verify commit SHA', 'verify branch state', 'prove a clean tree'], examples: ['git status', 'git diff', 'git log', 'branch inspection'] },
  { level: 5, id: 'shell.level5.development', name: 'Development', skills: ['choose project commands', 'identify first meaningful failure', 'distinguish code and environment failure', 'perform targeted verification'], examples: ['targeted tests', 'full tests', 'lint', 'build'] },
  { level: 6, id: 'shell.level6.diagnostics', name: 'Diagnostics', skills: ['gather evidence', 'localize failures', 'preserve identifiers', 'distinguish dispatch from command success'], examples: ['environment inspection', 'logs', 'HTTP/API status', 'workflow state'] },
  { level: 7, id: 'shell.level7.recovery', name: 'Recovery', skills: ['classify failure', 'change only what is necessary', 'preserve failure evidence', 'verify the recovery'], examples: ['diagnose', 'minimally adapt', 'retry', 'verify'] },
  { level: 8, id: 'shell.level8.capstone', name: 'Repository Capstone', skills: ['inspect', 'plan', 'modify', 'test', 'diagnose', 'repair', 'verify', 'commit', 'prove clean'], examples: ['controlled fixture or branch repository workflow'] },
]

export const SHELL_EXERCISES: readonly ShellExercise[] = [
  { exerciseId: 'shell.l1.pwd', level: 1, objective: 'Identify the current repository directory.', difficulty: 'introductory', prerequisites: [], allowedCommandFamilies: ['pwd'], expectedResult: 'An absolute path inside the repository workspace.', verificationRequirement: 'Output is non-empty and resolves inside the checkout.', safety: 'read_only', mutation: 'none' },
  { exerciseId: 'shell.l1.inspect-bounded', level: 1, objective: 'Inspect a known file with intentionally bounded output.', difficulty: 'introductory', prerequisites: ['shell.l1.pwd'], allowedCommandFamilies: ['cat', 'head', 'tail'], expectedResult: 'Only the requested bounded file content is returned.', verificationRequirement: 'Output length is within the requested bound and exit code is zero.', safety: 'read_only', mutation: 'none' },
  { exerciseId: 'shell.l2.path-test', level: 2, objective: 'Distinguish an existing file from a missing path.', difficulty: 'introductory', prerequisites: ['shell.l1.pwd'], allowedCommandFamilies: ['test'], expectedResult: 'The command reports the expected file or directory predicate.', verificationRequirement: 'Predicate and exit status match the fixture expectation.', safety: 'disposable_fixture', mutation: 'fixture_only' },
  { exerciseId: 'shell.l3.pipeline-verify', level: 3, objective: 'Compose and verify a deterministic text pipeline.', difficulty: 'intermediate', prerequisites: ['shell.l1.inspect-bounded'], allowedCommandFamilies: ['grep', 'sort', 'uniq', 'sed', 'awk', 'pipe', 'redirect'], expectedResult: 'The expected normalized records are produced.', verificationRequirement: 'Output matches the fixture expectation and exit code is zero.', safety: 'read_only', mutation: 'none' },
  { exerciseId: 'shell.l4.git-state', level: 4, objective: 'Prove repository branch and working-tree state.', difficulty: 'intermediate', prerequisites: ['shell.l1.pwd'], allowedCommandFamilies: ['git status', 'git branch', 'git log'], expectedResult: 'Branch, HEAD, and working-tree state are identified.', verificationRequirement: 'The relevant SHA/branch and status are explicitly captured.', safety: 'repository_inspection', mutation: 'none' },
  { exerciseId: 'shell.l5.verify', level: 5, objective: 'Run the smallest meaningful project verification command.', difficulty: 'advanced', prerequisites: ['shell.l3.pipeline-verify'], allowedCommandFamilies: ['npm test', 'npm run lint', 'npm run build'], expectedResult: 'The selected check completes with an interpretable status.', verificationRequirement: 'Exit code and final artifact/status are captured.', safety: 'read_only', mutation: 'none' },
  { exerciseId: 'shell.l6.correlate', level: 6, objective: 'Correlate a workflow invocation with its completed run and logs.', difficulty: 'advanced', prerequisites: ['shell.l5.verify'], allowedCommandFamilies: ['GitHub Actions', 'workflow logs'], expectedResult: 'Invocation, run, and completion evidence agree.', verificationRequirement: 'Exact invocation correlation and parsed log result are present.', safety: 'read_only', mutation: 'none' },
  { exerciseId: 'shell.l7.recover', level: 7, objective: 'Diagnose, minimally adapt, retry, and verify a controlled failure.', difficulty: 'advanced', prerequisites: ['shell.l6.correlate'], allowedCommandFamilies: ['diagnosis', 'retry', 'verification'], expectedResult: 'The original failure and verified recovery are both preserved.', verificationRequirement: 'Failure classification and post-retry verification are present.', safety: 'disposable_fixture', mutation: 'fixture_only' },
  { exerciseId: 'shell.l8.capstone', level: 8, objective: 'Complete a controlled repository change from inspection through clean verification.', difficulty: 'capstone', prerequisites: ['shell.l7.recover'], allowedCommandFamilies: ['git', 'tests', 'build', 'commit'], expectedResult: 'A controlled fixture/branch reaches the expected clean state.', verificationRequirement: 'Inspect, test, verify, commit, and clean-tree evidence are all present.', safety: 'controlled_mutation', mutation: 'repository_state' },
]

export function getShellExercise(exerciseId: string): ShellExercise | undefined {
  return SHELL_EXERCISES.find(exercise => exercise.exerciseId === exerciseId)
}

export function validateShellExercise(exercise: ShellExercise): string[] {
  const errors: string[] = []
  if (!/^shell\.l[1-8]\.[a-z0-9-]+$/.test(exercise.exerciseId)) errors.push('exerciseId must be a stable shell.lN.id')
  if (!SHELL_COMPETENCIES.some(level => level.level === exercise.level)) errors.push('unknown competency level')
  if (!exercise.objective.trim() || !exercise.expectedResult.trim() || !exercise.verificationRequirement.trim()) errors.push('objective, expectedResult, and verificationRequirement are required')
  if (!exercise.allowedCommandFamilies.length) errors.push('at least one allowed command family is required')
  if (exercise.safety === 'read_only' && exercise.mutation !== 'none') errors.push('read_only exercises cannot mutate')
  if (exercise.mutation === 'repository_state' && exercise.safety !== 'controlled_mutation' && exercise.safety !== 'repository_inspection') errors.push('repository mutation requires controlled safety')
  for (const prerequisite of exercise.prerequisites) if (!getShellExercise(prerequisite)) errors.push(`unknown prerequisite: ${prerequisite}`)
  return errors
}

export function assessShellExecution(exercise: ShellExercise, exitCode: number, output: string, verified: boolean): ShellAssessment {
  const passed = verified && exitCode === 0 && output.trim().length > 0
  return { exerciseId: exercise.exerciseId, level: exercise.level, passed, verified, reason: passed ? 'verified execution met the exercise boundary' : !verified ? 'execution was not verified' : exitCode !== 0 ? `command exited ${exitCode}` : 'verified output was empty' }
}
