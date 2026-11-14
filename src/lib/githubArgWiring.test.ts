// @vitest-environment node
// Source pins for where the refusal sits in the main tool loop. The rules live in githubArgCheck.ts (githubArgCheck.test.ts);
// the behaviour (a corrected call completes the turn, prose after a refusal stays BLOCKED) is driven in appToolArgumentRefusal.test.tsx.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('wiring in App.tsx (a source pin; the behaviour itself is driven in appToolArgumentRefusal.test.tsx)', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

  it('refuses before the loop detector and before dispatch, and records the attempt as a never-run call', () => {
    const refusal = app.indexOf('checkGithubReadArgs(call.name, call.input)')
    const guardian = app.indexOf('const refusal = toolCallRefusal(')
    const loop = app.indexOf('const callKey = `${call.name}:${JSON.stringify(call.input)}`')
    const dispatch = app.indexOf('executeTool(call', loop)
    expect(guardian).toBeGreaterThan(-1)
    expect(refusal).toBeGreaterThan(guardian)
    expect(loop).toBeGreaterThan(refusal)
    expect(dispatch).toBeGreaterThan(loop)  // the first dispatch after the refusal, in the model tool loop
    const block = app.slice(refusal, loop)
    expect(block).not.toContain('executeTool')
    expect(block).toContain('isError: true')
    expect(block).toContain('toolAttempts.push({ name: call.name, input: TRUNCATED_ATTEMPT })')
    expect(block).toContain('continue')
  })

  it('leaves the completion guard\'s verdict logic as it was', () => {
    expect(app).toContain('(failedAttempt?.input === TRUNCATED_ATTEMPT || toolAttempts[laterIndex]?.input === failedAttempt?.input)')
    expect(app).toContain('const completionBlocked = repositoryEvidenceRequired && !repositoryEvidenceObserved')
  })
})
