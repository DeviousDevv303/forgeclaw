import { describe, expect, it } from 'vitest'
import { createCuratedShellLesson, createShellRawExperience, createTrainingExample, sanitizeShellOutput, serializeTrainingExamplesJsonl } from './shellLearning'

const input = {
  exerciseId: 'shell.l1.pwd' as const,
  competencyLevel: 1 as const,
  objective: 'Identify the current repository directory.',
  difficulty: 'introductory' as const,
  repository: 'DeviousDevv303/forgeclaw',
  requestedRef: 'main',
  workingDirectory: '.',
  command: 'pwd',
  safety: 'read_only' as const,
  mutation: 'none' as const,
  invocationId: 'shell-1',
  runId: '42',
  runNumber: 7,
  branch: 'main',
  workflowStatus: 'completed',
  workflowConclusion: 'success',
  exitCode: 0,
  actualResult: 'token=sk-secret123\n/workspace/forgeclaw',
  expectedResult: 'An absolute path inside the repository workspace.',
  runtime: 'github-actions',
  dispatchTimestamp: '2026-09-30T15:00:00.000Z',
  completionTimestamp: '2026-09-30T15:00:01.000Z',
  sourceWorkflow: 'shell-exec.yml',
  sourceCommit: 'abc123',
  provenance: {
    repository: 'DeviousDevv303/forgeclaw', requestedRef: 'main', workingDirectory: '.',
    sourceWorkflow: 'shell-exec.yml', sourceCommit: 'abc123', runtime: 'github-actions',
    dispatchTimestamp: '2026-09-30T15:00:00.000Z', completionTimestamp: '2026-09-30T15:00:01.000Z',
  },
  verified: true,
}

describe('Shell learning records', () => {
  it('bounds output and redacts credential-like values', () => {
    const result = sanitizeShellOutput('Authorization: Bearer abc123 token=sk-secret')
    expect(result.redactionOccurred).toBe(true)
    expect(result.output).not.toContain('abc123')
    expect(result.output).not.toContain('sk-secret')
  })

  it('creates an integrity-protected raw record with provenance and failure class', async () => {
    const record = await createShellRawExperience(input)
    expect(record.recordId).toContain('shell-experience-sha')
    expect(record.integrity).toMatch(/^sha(256|fallback)-|^fnv1a-/)
    expect(record.boundedSanitizedOutput).toContain('/workspace/forgeclaw')
    expect(record.redactionOccurred).toBe(true)
    expect(record.failureClassification).toBe('none')
    expect(record.provenance.sourceCommit).toBe('abc123')
  })

  it('requires an approved lesson before producing a training example', async () => {
    const record = await createShellRawExperience(input)
    const pending = await createCuratedShellLesson(record, { concept: 'directory identity', correction: undefined, safetyImplications: 'read-only inspection' })
    expect(await createTrainingExample(pending, record)).toBeNull()
    const approved = await createCuratedShellLesson(record, { concept: 'directory identity', correction: 'Use pwd and verify the path.', safetyImplications: 'read-only inspection', status: 'approved' })
    const example = await createTrainingExample(approved, record)
    expect(example?.provenance.runId).toBe('42')
    expect(example?.integrity).toMatch(/^(sha256|fnv1a)-/)
    expect(serializeTrainingExamplesJsonl([example!])).toBe(serializeTrainingExamplesJsonl([example!]))
    expect(serializeTrainingExamplesJsonl([example!])).toContain('"lessonId"')
  })
})
