// @vitest-environment jsdom
// Run ids on learning events: the foundation for quarantine (recurrence across independent runs) and purge-by-run.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildLearningEvent, learningRunId } from './learningEvents'
import { corpusRepository } from './corpus'

const event = (runId?: string, outcome: 'verified' | 'completed' = 'verified') =>
  buildLearningEvent({ channel: 'chat', input: 'how many open PRs', result: 'Two (github_list_prs).', outcome, runtime: 'kimi', model: 'k2', actor: 'user', runId })

describe('run ids on learning events', () => {
  beforeEach(() => localStorage.clear())

  it('a new run gets an id; a retry inherits its parent\'s', () => {
    const a = learningRunId()
    expect(a).toMatch(/^run-[a-z0-9]+-[a-z0-9]{1,4}$/)
    expect(learningRunId()).not.toBe(a)
    expect(learningRunId(a)).toBe(a)
  })

  it('is stored in metadata but not in the hashed context, so one fact stays one record', () => {
    expect(event('run-a').metadata?.run).toBe('run-a')
    expect(event('run-a').context).toBe(event('run-b').context)
    expect(event().metadata?.run).toBeUndefined()
  })

  it('the same fact from two runs is one record that remembers both runs; a retry adds nothing', async () => {
    await corpusRepository.appendInteraction(event('run-a'))
    await corpusRepository.appendInteraction(event('run-b'))
    await corpusRepository.appendInteraction(event('run-b'))
    const candidates = corpusRepository.listCandidates(10)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].metadata).toMatchObject({ run: 'run-b', runs: 'run-a,run-b' })
    const [known] = corpusRepository.retrieve('how many open PRs', 3)
    expect(known.metadata).toMatchObject({ admittedBy: 'nexus-convergence', runs: 'run-a,run-b' })
  })

  it('keeps only the newest 20 runs of a fact', async () => {
    for (let i = 0; i < 25; i++) await corpusRepository.appendInteraction(event(`run-${i}`))
    const runs = corpusRepository.listCandidates(10)[0].metadata.runs.split(',')
    expect(runs).toHaveLength(20)
    expect(runs[0]).toBe('run-5')
    expect(runs[19]).toBe('run-24')
  })

  it('an event with no run id is recorded exactly as before', async () => {
    await corpusRepository.appendInteraction(event())
    const [candidate] = corpusRepository.listCandidates(10)
    expect(candidate.metadata.run).toBeUndefined()
    expect(candidate.metadata.runs).toBeUndefined()
  })
})
