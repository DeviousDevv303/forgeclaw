import { describe, expect, it } from 'vitest'
import type { LearningCandidate } from './corpus'
import { buildLearningEvent } from './learningEvents'
import { failurePattern, lessonsForPrompt, llmReadiness, NEXUS_MOTTO, summarizeLearning } from './nexusLearning'
import { visitorCandidate } from './visitorLearning'

let n = 0
function candidate(tool: string | undefined, outcome: string, result: string, timestamp = `2026-10-20T0${n % 10}:00:00Z`): LearningCandidate {
  n += 1
  const event = buildLearningEvent({ channel: tool ? 'tool' : 'chat', input: `call ${n}`, result, outcome: outcome as never, runtime: 'moonshot', model: 'kimi-k2.6', toolName: tool, actor: 'agent', lineage: 'none' })
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

  it('summarizes 1,200 candidates in under 50 ms', () => {
    const candidates = Array.from({ length: 1_200 }, (_, i) =>
      candidate('web_search', 'completed', `verified search result ${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
    )

    const started = performance.now()
    const summary = summarizeLearning(candidates)
    const elapsedMs = performance.now() - started

    expect(summary.total).toBe(1_200)
    expect(summary.tools).toMatchObject([{ tool: 'web_search', total: 1_200, completed: 1_200 }])
    expect(elapsedMs).toBeLessThan(50)
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

describe('visitor evidence cannot steer NEXUS', () => {
  function visitorCand(visitor: string, i: number): LearningCandidate {
    const input = visitorCandidate({ v: 2, id: `public-a-${i}`, kind: 'answer', tool: 'deepseek_reason', task: `q${i}`, result: '[TOOL ERROR] model run concluded failure', outcome: 'failed', model: '', seconds: 3, visitor, flags: [], ts: '2026-10-20T10:00:00Z', sig: 'x' })
    return { id: `v${i}`, corpusId: 'nexus-local', source: input.source!, content: input.result, timestamp: '2026-10-20T10:00:00Z', version: i, recordType: 'learning_candidate', integrity: `vi${i}`, admissionStatus: 'candidate', metadata: input.metadata!, sourceInteractionId: `vx${i}`, runtime: input.runtime, model: input.model, input: input.input, context: input.context, generatedResult: input.result }
  }

  it('one visitor counts once, however many runs it sends', () => {
    const flood = Array.from({ length: 50 }, (_, i) => visitorCand('aaaaaaaaaaaa', i))
    const [lesson] = summarizeLearning([...flood, visitorCand('bbbbbbbbbbbb', 99)]).lessons
    expect(lesson).toMatchObject({ tool: 'deepseek_reason', visitors: 2, ownerCount: 0, count: 2 })
  })

  it("never puts visitor-only lessons into the model's prompt; the owner's own failures still go in", () => {
    const visitorsOnly = summarizeLearning(Array.from({ length: 10 }, (_, i) => visitorCand(`visitor${i}`.padEnd(12, '0'), i)))
    expect(visitorsOnly.lessons).toHaveLength(1)
    expect(lessonsForPrompt(visitorsOnly, ['deepseek_reason'])).toBe('')
    const owner = summarizeLearning([
      ...Array.from({ length: 10 }, (_, i) => visitorCand(`visitor${i}`.padEnd(12, '0'), i)),
      candidate('deepseek_reason', 'failed', '[TOOL ERROR] model run concluded failure'),
      candidate('deepseek_reason', 'failed', '[TOOL ERROR] model run concluded failure'),
    ])
    expect(lessonsForPrompt(owner, ['deepseek_reason'])).toContain('deepseek_reason failed 2x')
  })
})

describe('road to the NEXUS LLM', () => {
  it('counts only approved records toward the milestones, and is honest about the step', () => {
    const r0 = llmReadiness(0, [candidate('shell_exec', 'completed', 'ok'), candidate('github_read_file', 'completed', 'ok')])
    expect(r0).toMatchObject({ approved: 0, awaitingReview: 2, step: 0, next: { approved: 100 }, progress: 0, toolCoverage: 2 })
    expect(llmReadiness(550, [])).toMatchObject({ step: 1, next: { approved: 1_000, label: 'Narrow fine-tune ready' }, progress: 0.5 })
    expect(llmReadiness(1_000, [])).toMatchObject({ step: 2, next: { approved: 10_000 }, progress: 0 })
    expect(llmReadiness(12_000, [])).toMatchObject({ next: null, progress: 1 })
  })
})

describe('a failed shell command is learned by its cause, not by "Shell execution failed"', () => {
  const shellFailure = (command: string, output: string) => [
    '[TOOL ERROR] Shell execution failed.', 'Run #162 (id: 39663438839)', 'Invocation: shell-1792611522184-5797db2a',
    `Command: ${command}`, 'Exit code: 4', 'Conclusion: failure', '', output,
  ].join('\n')
  const gh = 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:\n  env:\n    GH_TOKEN: ${{ github.token }}'

  it('names the program and the line that says why', () => {
    expect(failurePattern(shellFailure('gh pr list --repo o/r --state open', gh)))
      .toBe('gh: gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:')
  })
  it('groups the same mistake made with different arguments or an env prefix (runs 157, 158, 162, 163)', () => {
    const a = failurePattern(shellFailure('gh pr list --repo o/r --state open --json number,title', gh))
    expect(failurePattern(shellFailure('env GH_TOKEN="$GITHUB_TOKEN" gh pr list --repo o/r', gh))).toBe(a)
    expect(failurePattern(shellFailure('GH_TOKEN=$GITHUB_TOKEN gh pr list', gh))).toBe(a)
  })
  it('keeps different causes apart', () => {
    const jq = failurePattern(shellFailure('curl -sL https://api.github.com/x | jq -r .', 'jq: error (at <stdin>:1): Cannot index string with string "base"'))
    expect(jq).toMatch(/^curl: jq: error/)
    expect(jq).not.toBe(failurePattern(shellFailure('gh pr list', gh)))
    expect(failurePattern(shellFailure('npm test', ''))).toBe('npm: no output')
  })
  it('turns the repeated gh mistake into a lesson the next prompt shows', () => {
    const at = (i: number) => `2026-10-21T19:2${i}:00Z`
    const candidates = [0, 1, 2, 3].map(i => ({
      id: `c${i}`, source: 'learning:tool', content: 'shell_exec {"command":"gh pr list"}', generatedResult: shellFailure(`gh pr list --state open ${i}`, gh),
      timestamp: at(i), context: 'channel=shell; outcome=failed; tool=shell_exec; actor=agent',
    }))
    const lessons = lessonsForPrompt(summarizeLearning(candidates as never), ['shell_exec'])
    expect(lessons).toContain('shell_exec failed 4x with: gh: gh: To use GitHub CLI')
    expect(lessons).toContain('set the GH_TOKEN environment variable')
  })
})
