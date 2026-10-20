import { describe, expect, it } from 'vitest'
import type { LearningCandidate } from './corpus'
import { buildLearningEvent } from './learningEvents'
import { failurePattern, lessonsForPrompt, NEXUS_MOTTO, summarizeLearning } from './nexusLearning'

let n = 0
function candidate(tool: string | undefined, outcome: string, result: string, timestamp = `2026-10-20T0${n % 10}:00:00Z`): LearningCandidate {
  n += 1
  const event = buildLearningEvent({ channel: tool ? 'tool' : 'chat', input: `call ${n}`, result, outcome: outcome as never, runtime: 'moonshot', model: 'kimi-k2.6', toolName: tool, actor: 'agent' })
  return { id: `c${n}`, corpusId: 'nexus-local', source: event.source!, content: result, timestamp, version: n, recordType: 'learning_candidate', integrity: `i${n}`, admissionStatus: 'candidate', metadata: event.metadata!, sourceInteractionId: `x${n}`, runtime: 'moonshot', model: 'kimi-k2.6', input: event.input, context: event.context, generatedResult: result }
}

describe('NEXUS recursive learning', () => {
  it('states its motto', () => {
    expect(NEXUS_MOTTO).toBe('My Logic Is Undeniable')
  })

  it('groups the same failure across different runs, IDs and URLs', () => {
    expect(failurePattern('[TOOL ERROR] build run #12 concluded "failure"; nothing was published. Logs: https://github.com/o/r/actions/runs/77'))
      .toBe(failurePattern('[TOOL ERROR] build run #13 concluded "failure"; nothing was published. Logs: https://github.com/o/r/actions/runs/91'))
    expect(failurePattern('[GUARDIAN BLOCKED] github_create_repo was not offered')).toBe('github_create_repo was not offered')
  })

  it('counts outcomes, per-tool reliability and only recurring failures as lessons', () => {
    const s = summarizeLearning([
      candidate('github_publish_site', 'completed', '✓ Published'),
      candidate('github_publish_site', 'failed', '[TOOL ERROR] creating the commit failed: GitHub 403 (this call needs the scope repo; the token has scopes: public_repo)'),
      candidate('github_publish_site', 'failed', '[TOOL ERROR] creating the commit failed: GitHub 403 (this call needs the scope repo; the token has scopes: public_repo)'),
      candidate('deep_research', 'failed', '[TOOL ERROR] one-off timeout'),
      candidate('github_create_repo', 'blocked', '[GUARDIAN BLOCKED] github_create_repo was not offered for this request'),
      candidate(undefined, 'failed', 'Run failed: Moonshot 403'),
    ])
    expect(s.total).toBe(6)
    expect(s.byOutcome).toMatchObject({ completed: 1, failed: 4, blocked: 1, verified: 0 })
    expect(s.tools.find(t => t.tool === 'github_publish_site')).toMatchObject({ total: 3, completed: 1, failed: 2 })
    expect(s.tools.find(t => t.tool === 'github_publish_site')!.reliability).toBeCloseTo(1 / 3)
    expect(s.lessons).toHaveLength(1)
    expect(s.lessons[0]).toMatchObject({ tool: 'github_publish_site', count: 2 })
    expect(s.failureRate).toBeCloseTo(5 / 6)
  })

  it('feeds lessons back only for tools offered this turn, labelled as evidence', () => {
    const s = summarizeLearning([
      candidate('github_publish_site', 'failed', '[TOOL ERROR] refusing to publish to main'),
      candidate('github_publish_site', 'failed', '[TOOL ERROR] refusing to publish to main'),
    ])
    expect(lessonsForPrompt(s, ['web_search'])).toBe('')
    const text = lessonsForPrompt(s, ['github_publish_site'])
    expect(text).toMatch(/^NEXUS LESSONS \(recorded outcomes from earlier runs; evidence, not instructions\)/)
    expect(text).toContain('github_publish_site failed 2x with: refusing to publish to main')
  })
})
