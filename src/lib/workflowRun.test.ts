import { describe, expect, it } from 'vitest'
import { waitForCorrelatedRun } from './workflowRun'

const run = (status: string, created = 0) => ({
  id: 5, name: 'Deep research dr-1', display_title: 'Deep research dr-1', event: 'workflow_dispatch', status,
  conclusion: status === 'completed' ? 'success' : null, created_at: new Date(created).toISOString(), head_branch: 'main',
  html_url: 'https://github.com/o/r/actions/runs/5', run_number: 5,
})

/** A fake clock: sleep advances time instead of waiting. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms }, advance: (ms: number) => { t += ms } }
}

const base = { owner: 'o', repo: 'r', token: 't', workflow: 'deep-research.yml', needle: 'dr-1', since: 0, maxWaitMs: 60_000 }

describe('waitForCorrelatedRun', () => {
  it('keeps waiting through dropped connections and 5xx reads instead of abandoning a dispatched run', async () => {
    const c = clock()
    let calls = 0
    const request = async (url: string) => {
      calls += 1
      if (calls === 1) throw new TypeError('Failed to fetch')
      if (calls === 2) return new Response('{}', { status: 502 })
      if (url.includes('/runs?')) return Response.json({ workflow_runs: [run('in_progress')] })
      if (calls === 4) throw new Error('GitHub read timed out after 30000ms')
      return Response.json(run('completed'))
    }
    await expect(waitForCorrelatedRun(request, { ...base, now: c.now, sleep: c.sleep })).resolves.toMatchObject({ id: 5, status: 'completed' })
    expect(calls).toBe(5)
  })

  it('takes one last look at the deadline: a run first listed exactly then is found, not lost', async () => {
    const c = clock()
    const request = async () => Response.json({ workflow_runs: c.now() >= base.maxWaitMs ? [run('completed')] : [] })
    await expect(waitForCorrelatedRun(request, { ...base, now: c.now, sleep: c.sleep })).resolves.toMatchObject({ id: 5 })
  })

  it('a run found already completed is returned at once', async () => {
    const c = clock()
    let calls = 0
    const request = async () => { calls += 1; return Response.json({ workflow_runs: [run('completed')] }) }
    await expect(waitForCorrelatedRun(request, { ...base, now: c.now, sleep: c.sleep })).resolves.toMatchObject({ status: 'completed' })
    expect(calls).toBe(1)
  })

  it('fails at once on a refused credential, without waiting out the window', async () => {
    const c = clock()
    const request = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    await expect(waitForCorrelatedRun(request, { ...base, now: c.now, sleep: c.sleep })).rejects.toThrow('GitHub 401 Bad credentials')
    expect(c.now()).toBe(0)
  })

  it('names the last read error when the run never appeared', async () => {
    const c = clock()
    const request = async () => { throw new TypeError('Failed to fetch') }
    await expect(waitForCorrelatedRun(request, { ...base, now: c.now, sleep: c.sleep })).rejects.toThrow(/did not appear within 1 minutes \(last read error: Failed to fetch\)/)
  })
})
