// ForgeClaw — verified Shell evidence and NEXUS dataset boundary.
// This module observes completed, parsed Shell results; it never authorizes execution.

import { integrityHash, type ShellCorpusExperienceInput } from './corpus'
import type { ShellCompetencyLevel, ShellExercise } from './shellCompetency'

export type ShellFailureClass = 'none' | 'guardian_block' | 'dispatch' | 'correlation' | 'timeout' | 'workflow' | 'command' | 'log_retrieval' | 'validation'

export interface ShellProvenance {
  repository: string
  requestedRef: string
  workingDirectory: string
  sourceWorkflow: string
  sourceCommit?: string
  runtime: string
  model?: string
  dispatchTimestamp: string
  completionTimestamp: string
}

export interface ShellRawExperience {
  recordId: string
  recordVersion: 1
  exerciseId: string
  competencyLevel: ShellCompetencyLevel
  objective: string
  difficulty: ShellExercise['difficulty']
  repository: string
  requestedRef: string
  workingDirectory: string
  command: string
  safety: ShellExercise['safety']
  mutation: ShellExercise['mutation']
  guardianDecision: 'authorized'
  invocationId: string
  runId: string
  runNumber: number
  branch: string
  workflowStatus: string
  workflowConclusion: string | null
  exitCode: number
  boundedSanitizedOutput: string
  redactionOccurred: boolean
  expectedResult: string
  actualResult: string
  failureClassification: ShellFailureClass
  runtime: string
  model?: string
  dispatchTimestamp: string
  completionTimestamp: string
  sourceWorkflow: string
  sourceCommit?: string
  integrity: string
  provenance: ShellProvenance
}

export interface CuratedShellLesson {
  lessonId: string
  lessonVersion: 1
  status: 'pending' | 'approved' | 'rejected'
  objective: string
  concept: string
  action: string
  observation: string
  failure?: string
  correction?: string
  verification: string
  safetyImplications: string
  rawExperienceId: string
  rawExperienceIntegrity: string
  provenance: ShellProvenance
}

export interface ShellTrainingExample {
  exampleId: string
  exampleVersion: 1
  input: string
  context: string
  constraints: string[]
  action: string
  observation: string
  verification: string
  correction?: string
  finalSolution: string
  expectedState: string
  provenance: {
    lessonId: string
    rawExperienceId: string
    invocationId: string
    runId: string
    runNumber: number
    sourceCommit?: string
  }
  integrity: string
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /bearer\s+[a-z0-9._~+/-]+=*/gi,
  /authorization\s*:\s*[^\s,;]+/gi,
  /(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
  /\b(?:gh[pousr]_[a-z0-9_]+|sk-[a-z0-9_-]+|AKIA[0-9A-Z]{16})\b/gi,
]

export const MAX_LEARNING_OUTPUT_CHARS = 6_000

export function sanitizeShellOutput(output: string): { output: string; redactionOccurred: boolean } {
  let sanitized = output.slice(0, MAX_LEARNING_OUTPUT_CHARS)
  let redactionOccurred = sanitized.length !== output.length
  for (const pattern of SECRET_PATTERNS) {
    const next = sanitized.replace(pattern, match => {
      redactionOccurred = true
      const label = match.toLowerCase().startsWith('authorization') ? 'authorization' : 'secret'
      return `[REDACTED ${label}]`
    })
    sanitized = next
  }
  return { output: sanitized, redactionOccurred }
}

export function classifyShellFailure(exitCode: number, workflowConclusion: string | null, verified: boolean): ShellFailureClass {
  if (!verified) return 'validation'
  if (workflowConclusion && workflowConclusion !== 'success') return 'workflow'
  return exitCode === 0 ? 'none' : 'command'
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function createShellRawExperience(input: Omit<ShellRawExperience, 'recordId' | 'recordVersion' | 'boundedSanitizedOutput' | 'redactionOccurred' | 'integrity' | 'failureClassification' | 'guardianDecision'> & { verified: boolean }): Promise<ShellRawExperience> {
  const sanitized = sanitizeShellOutput(input.actualResult)
  const withoutDerived = { ...input, actualResult: sanitized.output }
  const integrity = await integrityHash(stable(withoutDerived))
  const record: ShellRawExperience = {
    ...input,
    recordId: `shell-experience-${integrity}`,
    recordVersion: 1,
    guardianDecision: 'authorized',
    boundedSanitizedOutput: sanitized.output,
    redactionOccurred: sanitized.redactionOccurred,
    failureClassification: classifyShellFailure(input.exitCode, input.workflowConclusion, input.verified),
    integrity,
  }
  delete (record as ShellRawExperience & { verified?: boolean }).verified
  return record
}

export function shellExperienceAsCorpusInput(record: ShellRawExperience): ShellCorpusExperienceInput {
  return {
    input: record.objective,
    context: stable({ exerciseId: record.exerciseId, provenance: record.provenance, command: record.command }),
    result: stable(record),
    runtime: record.runtime,
    model: record.model || 'unknown',
    source: `shell:${record.repository}:${record.runId}`,
    provenance: {
      repository: record.repository,
      requestedRef: record.requestedRef,
      workingDirectory: record.workingDirectory,
      sourceWorkflow: record.sourceWorkflow,
      ...(record.sourceCommit ? { sourceCommit: record.sourceCommit } : {}),
      invocationId: record.invocationId,
      runId: record.runId,
      runNumber: String(record.runNumber),
    },
  }
}

export async function createCuratedShellLesson(record: ShellRawExperience, fields: Pick<CuratedShellLesson, 'concept' | 'correction' | 'safetyImplications'> & { status?: CuratedShellLesson['status'] }): Promise<CuratedShellLesson> {
  const lesson: CuratedShellLesson = {
    lessonId: `shell-lesson-${record.recordId}`,
    lessonVersion: 1,
    status: fields.status || 'pending',
    objective: record.objective,
    concept: fields.concept,
    action: record.command,
    observation: record.actualResult,
    ...(record.failureClassification !== 'none' ? { failure: record.failureClassification } : {}),
    ...(fields.correction ? { correction: fields.correction } : {}),
    verification: record.expectedResult,
    safetyImplications: fields.safetyImplications,
    rawExperienceId: record.recordId,
    rawExperienceIntegrity: record.integrity,
    provenance: record.provenance,
  }
  return lesson
}

export async function createTrainingExample(lesson: CuratedShellLesson, record: ShellRawExperience): Promise<ShellTrainingExample | null> {
  if (lesson.status !== 'approved' || lesson.rawExperienceId !== record.recordId || lesson.rawExperienceIntegrity !== record.integrity) return null
  const base = {
    exampleId: `shell-example-${lesson.lessonId}`,
    exampleVersion: 1 as const,
    input: lesson.objective,
    context: JSON.stringify({ exerciseId: record.exerciseId, repository: record.repository, workingDirectory: record.workingDirectory }),
    constraints: [record.safety, `allowed-ref:${record.requestedRef}`, 'preserve Guardian authorization and bounded output'],
    action: lesson.action,
    observation: lesson.observation,
    verification: lesson.verification,
    ...(lesson.correction ? { correction: lesson.correction } : {}),
    finalSolution: lesson.correction || lesson.observation,
    expectedState: lesson.verification,
    provenance: { lessonId: lesson.lessonId, rawExperienceId: record.recordId, invocationId: record.invocationId, runId: record.runId, runNumber: record.runNumber, ...(record.sourceCommit ? { sourceCommit: record.sourceCommit } : {}) },
  }
  return { ...base, integrity: await integrityHash(stable(base)) }
}

export function serializeTrainingExamplesJsonl(examples: readonly ShellTrainingExample[]): string {
  return examples.filter(example => example.exampleId && example.integrity).map(example => stable(example)).join('\n') + (examples.length ? '\n' : '')
}
