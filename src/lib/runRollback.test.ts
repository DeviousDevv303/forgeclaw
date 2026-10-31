import { describe, expect, it } from 'vitest'
import { createRunJournal, formatRollbackReport, journalRecord, rollbackRun, setActiveRunJournal, type JournalEntry } from './runRollback'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
function fakeGitHub(routes: Array<[RegExp, Handler]>) {
  const calls: string[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace('https://api.github.com/repos/o/r', '')}`
    calls.push(key)
    for (const [pattern, handler] of routes) if (pattern.test(key)) return handler(url, init)
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const deps = (fetchImpl: typeof fetch) => ({ owner: 'o', repo: 'r', token: 't', fetchImpl, sleep: async () => {}, forceCancelAfterMs: 0, settleTimeoutMs: 4_000 })
const repoInfo: [RegExp, Handler] = [/^GET $/, () => json({ default_branch: 'main' })]

describe('run journal', () => {
  it('records entries and a failing journal never throws into a tool', () => {
    const journal = createRunJournal()
    journalRecord(journal, { kind: 'irreversible', label: 'x' })
    expect(journal.entries()).toHaveLength(1)
    setActiveRunJournal({ record: () => { throw new Error('boom') }, entries: () => [], clear: () => {} })
    expect(() => journalRecord(undefined, { kind: 'irreversible', label: 'y' })).not.toThrow()
    setActiveRunJournal(null)
  })
})

describe('rollbackRun', () => {
  it('cancels a matching active run and ignores unrelated runs', async () => {
    const { fetchImpl, calls } = fakeGitHub([
      repoInfo,
      [/^GET \/actions\/workflows\/deepseek-16b\.yml\/runs/, () => json({ workflow_runs: [
        { id: 1, run_number: 7, status: 'in_progress', display_title: 'Qwen/Qwen3-8B deepseek-111-abc' },
        { id: 2, run_number: 8, status: 'in_progress', display_title: 'Qwen/Qwen3-8B deepseek-OTHER' },
      ] })],
      [/^POST \/actions\/runs\/1\/cancel/, () => json({}, 202)],
      [/^GET \/actions\/runs\/1$/, () => json({ status: 'completed' })],
    ])
    const entries: JournalEntry[] = [{ kind: 'workflow_dispatch', workflow: 'deepseek-16b.yml', needle: 'deepseek-111-abc', since: 0, label: 'deepseek_reason' }]
    const report = await rollbackRun(entries, deps(fetchImpl))
    expect(report.reverted).toEqual(['deepseek_reason: cancelled run 1'])
    expect(calls).not.toContain('POST /actions/runs/2/cancel')
    expect(report.failed).toEqual([])
  })

  it('escalates to force-cancel when a cancelled run lingers, and reports failure if it never ends', async () => {
    const { fetchImpl, calls } = fakeGitHub([
      repoInfo,
      [/^GET \/actions\/workflows\/shell-exec\.yml\/runs/, () => json({ workflow_runs: [{ id: 5, status: 'in_progress', display_title: 'Shell exec shell-9' }] })],
      [/^POST \/actions\/runs\/5\/cancel/, () => json({}, 202)],
      [/^POST \/actions\/runs\/5\/force-cancel/, () => json({}, 202)],
      [/^GET \/actions\/runs\/5$/, () => json({ status: 'in_progress' })],
    ])
    const entries: JournalEntry[] = [
      { kind: 'workflow_dispatch', workflow: 'shell-exec.yml', needle: 'shell-9', since: 0, label: 'shell_exec' },
      { kind: 'branch_created', branch: 'sculpt/x', label: 'sculpt_self' },
    ]
    const report = await rollbackRun(entries, deps(fetchImpl))
    expect(calls).toContain('POST /actions/runs/5/force-cancel')
    expect(report.failed.join()).toContain('still active after force-cancel')
    expect(report.skipped.join()).toContain('branch cleanup skipped for safety')
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false)
  })

  it('tolerates a slow GitHub cancel: a run that ends after ~60 polls is reported as cancelled, not failed', async () => {
    let polls = 0
    const { fetchImpl } = fakeGitHub([
      repoInfo,
      [/^GET \/actions\/workflows\/deepseek-16b\.yml\/runs/, () => json({ workflow_runs: [{ id: 9, status: 'in_progress', display_title: 'Qwen/Qwen3-8B deepseek-slow' }] })],
      [/^POST \/actions\/runs\/9\/(?:force-)?cancel/, () => json({}, 202)],
      [/^GET \/actions\/runs\/9$/, () => json({ status: (polls += 1) > 60 ? 'completed' : 'in_progress' })],
    ])
    const entries: JournalEntry[] = [{ kind: 'workflow_dispatch', workflow: 'deepseek-16b.yml', needle: 'deepseek-slow', since: 0, label: 'deepseek_reason' }]
    const report = await rollbackRun(entries, { owner: 'o', repo: 'r', token: 't', fetchImpl, sleep: async () => {}, forceCancelAfterMs: 0 })
    expect(report.failed).toEqual([])
    expect(report.reverted).toEqual(['deepseek_reason: cancelled run 9'])
  })

  it('deletes a branch this run created and closes its open PR', async () => {
    const { fetchImpl, calls } = fakeGitHub([
      repoInfo,
      [/^GET \/pulls\?state=open&head=o%3Asculpt%2Fx/, () => json([{ number: 42 }])],
      [/^PATCH \/pulls\/42/, () => json({})],
      [/^DELETE \/git\/refs\/heads\/sculpt\/x/, () => new Response(null, { status: 204 })],
    ])
    const report = await rollbackRun([{ kind: 'branch_created', branch: 'sculpt/x', label: 'sculpt_self' }], deps(fetchImpl))
    expect(report.reverted).toEqual(['sculpt_self: closed PR #42', 'sculpt_self: deleted branch sculpt/x'])
    expect(calls.indexOf('PATCH /pulls/42')).toBeLessThan(calls.findIndex(c => c.startsWith('DELETE')))
  })

  it('resets an advanced branch only when its head is still the commit this run wrote', async () => {
    const entry: JournalEntry = { kind: 'branch_advanced', branch: 'feat/a', beforeSha: 'b'.repeat(40), afterSha: 'a'.repeat(40), label: 'github_write_file' }
    const ok = fakeGitHub([repoInfo, [/^GET \/git\/ref\/heads\/feat\/a/, () => json({ object: { sha: 'a'.repeat(40) } })], [/^PATCH \/git\/refs\/heads\/feat\/a/, () => json({})]])
    const done = await rollbackRun([entry], deps(ok.fetchImpl))
    expect(done.reverted[0]).toContain('reset aaaaaaa -> bbbbbbb')

    const moved = fakeGitHub([repoInfo, [/^GET \/git\/ref\/heads\/feat\/a/, () => json({ object: { sha: 'c'.repeat(40) } })]])
    const skipped = await rollbackRun([entry], deps(moved.fetchImpl))
    expect(skipped.skipped[0]).toContain('moved since this run')
    expect(moved.calls.some(c => c.startsWith('PATCH'))).toBe(false)
  })

  it('never touches main, master, the default branch, or unsafe names', async () => {
    const { fetchImpl, calls } = fakeGitHub([[/^GET $/, () => json({ default_branch: 'trunk' })]])
    const entries: JournalEntry[] = ['main', 'master', 'trunk', '../evil', 'a b'].map(branch => ({ kind: 'branch_created' as const, branch, label: 'x' }))
    const report = await rollbackRun(entries, deps(fetchImpl))
    expect(report.skipped).toHaveLength(5)
    expect(report.reverted).toEqual([])
    expect(calls.filter(c => c.startsWith('DELETE') || c.startsWith('PATCH'))).toEqual([])
  })

  it('lists irreversible side effects instead of claiming they were undone', async () => {
    const { fetchImpl } = fakeGitHub([repoInfo])
    const report = await rollbackRun([{ kind: 'irreversible', label: 'gmail_send' }], deps(fetchImpl))
    expect(report.irreversible).toEqual(['gmail_send'])
    expect(report.reverted).toEqual([])
  })

  it('formats an honest report, including the empty case', () => {
    expect(formatRollbackReport({ reverted: [], skipped: [], failed: [], irreversible: [] })).toContain('Nothing to roll back')
    const text = formatRollbackReport({ reverted: ['a'], skipped: ['b'], failed: ['c'], irreversible: ['d'] })
    expect(text).toContain('NOT reverted (needs attention):')
    expect(text).toContain('Cannot be undone automatically:')
  })
})
