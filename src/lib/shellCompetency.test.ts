import { describe, expect, it } from 'vitest'
import { assessShellExecution, getShellExercise, SHELL_COMPETENCIES, validateShellExercise } from './shellCompetency'

describe('Shell competency curriculum', () => {
  it('defines eight stable levels and stable exercise IDs', () => {
    expect(SHELL_COMPETENCIES).toHaveLength(8)
    expect(new Set(SHELL_COMPETENCIES.map(level => level.id)).size).toBe(8)
    expect(getShellExercise('shell.l1.pwd')?.level).toBe(1)
    expect(getShellExercise('shell.l8.capstone')?.difficulty).toBe('capstone')
  })

  it('validates prerequisites and mutation safety', () => {
    const exercise = getShellExercise('shell.l2.path-test')!
    expect(validateShellExercise(exercise)).toEqual([])
    expect(validateShellExercise({ ...exercise, exerciseId: 'bad', safety: 'read_only', mutation: 'repository_state' })).toEqual(expect.arrayContaining([
      'exerciseId must be a stable shell.lN.id',
      'read_only exercises cannot mutate',
    ]))
  })

  it('only awards competency from verified successful output', () => {
    const exercise = getShellExercise('shell.l1.pwd')!
    expect(assessShellExecution(exercise, 0, '/workspace/repo', true).passed).toBe(true)
    expect(assessShellExecution(exercise, 0, '/workspace/repo', false).passed).toBe(false)
    expect(assessShellExecution(exercise, 1, 'failure', true).passed).toBe(false)
  })
})
