import { describe, expect, it } from 'vitest'
import { failureExcerpt, jobFailureEvidence } from './runDiagnosis'

// The real tail of shell-repair run 39539687445 (2026-10-21), the one the model could not explain.
const REAL_LOG = [
  '2026-10-21T03:39:44.8627832Z ##[group]Run set -euo pipefail',
  '2026-10-21T03:39:44.8628106Z \u001b[36;1mlabel=\'autonomous-repair\'\u001b[0m',
  '2026-10-21T03:39:44.8683863Z ##[endgroup]',
  '2026-10-21T03:39:44.8571210Z No repair changes to publish.',
  "2026-10-21T03:39:48.8015033Z pull request create failed: GraphQL: Head sha can't be blank, No commits between main and forge/repair/x (createPullRequest)",
  '2026-10-21T03:39:48.8059945Z ##[error]Process completed with exit code 1.',
  '2026-10-21T03:39:48.8185461Z Post job cleanup.',
].join('\n')

describe('failureExcerpt', () => {
  it('keeps the lines that explain the failure, without timestamps, colors or group markers', () => {
    const out = failureExcerpt(REAL_LOG)
    expect(out).toContain('No repair changes to publish.')
    expect(out).toContain("pull request create failed: GraphQL: Head sha can't be blank")
    expect(out).toContain('ERROR: Process completed with exit code 1.')
    expect(out).not.toMatch(/2026-10-21T|##\[group\]|##\[endgroup\]/)
    expect(out.includes('\u001b')).toBe(false)
  })
  it('falls back to the last lines when no error is marked, and never leaks a token', () => {
    const token = 'ghp_' + 'z'.repeat(30)
    const out = failureExcerpt(`line one\nlast line with ${token}`)
    expect(out).toContain('last line')
    expect(out).not.toContain(token)
  })
})

describe('jobFailureEvidence', () => {
  const input = { owner: 'o', repo: 'r', token: 't', jobId: 9 }
  it('returns the log excerpt when the log file can be fetched', async () => {
    const out = await jobFailureEvidence(async url => url.endsWith('/logs') ? new Response(REAL_LOG) : new Response('{}', { status: 404 }), input)
    expect(out).toMatch(/^Log excerpt/)
    expect(out).toContain('Head sha can')
  })
  it('falls back to annotations when the browser is refused the log file, and says so', async () => {
    const out = await jobFailureEvidence(async url => {
      if (url.endsWith('/logs')) throw new TypeError('Failed to fetch')
      return Response.json([{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }, { annotation_level: 'warning', message: 'Node.js 20 is deprecated' }])
    }, input)
    expect(out).toContain('log file could not be fetched from the browser')
    expect(out).toContain('Process completed with exit code 1.')
    expect(out).not.toContain('Node.js 20')
  })
  it('says plainly when nothing could be read, instead of returning nothing', async () => {
    const out = await jobFailureEvidence(async () => new Response('{}', { status: 403 }), input)
    expect(out).toContain('could not be read from here')
  })
})

describe('github_get_run_logs returns the error text of a failed job', () => {
  it('adds log evidence under the failed job, not just step names', async () => {
    const { vi, afterEach: after } = await import('vitest')
    const { executeTool } = await import('./forgeTools')
    after(() => vi.unstubAllGlobals())
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/actions/runs/5/jobs')) return Response.json({ jobs: [{ id: 77, name: 'repair', status: 'completed', conclusion: 'failure', steps: [{ number: 15, name: 'Create labeled pull request', status: 'completed', conclusion: 'failure' }] }] })
      if (String(url).endsWith('/actions/jobs/77/logs')) return new Response('2026-10-21T03:39:48Z pull request create failed: No commits between main and the branch\n2026-10-21T03:39:48Z ##[error]Process completed with exit code 1.')
      return new Response('{}', { status: 404 })
    }))
    const out = await executeTool({ id: '1', name: 'github_get_run_logs', input: { run_id: '5' } }, { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator' } as never)
    expect(out).toContain('❌ Step 15: Create labeled pull request')
    expect(out).toContain('pull request create failed: No commits between main and the branch')
  })
})
