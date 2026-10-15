import { describe, expect, it } from 'vitest'
import { formatDdgResults, parseDdgLog, runDdgWorkflowSearch, sanitizeDdgQuery, DDG_RESULT_MARKER } from './ddgWorkflowSearch'

const hits = [{ title: 'Blade erosion', href: 'https://example.com/a', body: 'Leading edge erosion.\nSecond line' }]
const resultLine = `${DDG_RESULT_MARKER} ${JSON.stringify([{ query: 'q', results: hits }])}`

describe('parseDdgLog', () => {
  it('reads the result line through a timestamp prefix and CRLF', () => {
    const raw = `2026-10-14T10:00:00.1Z noise\r\n2026-10-14T10:00:01.2Z ${resultLine}\r\n2026-10-14T10:00:02Z done`
    expect(parseDdgLog(raw)).toEqual([{ query: 'q', results: hits }])
  })
  it('does not match the echoed script source', () => {
    expect(parseDdgLog(`print("${DDG_RESULT_MARKER} " + json.dumps(results))`)).toBeNull()
  })
  it('uses the last result line and rejects malformed JSON', () => {
    expect(parseDdgLog(`${DDG_RESULT_MARKER} [{bad\n${resultLine}`)).toHaveLength(1)
    expect(parseDdgLog(`${DDG_RESULT_MARKER} [{bad`)).toBeNull()
  })
})

describe('formatDdgResults / sanitizeDdgQuery', () => {
  it('labels results as untrusted and flattens snippets', () => {
    const out = formatDdgResults('q', 5, [{ query: 'q', results: hits }])
    expect(out).toContain('untrusted web content')
    expect(out).toContain('https://example.com/a')
    expect(out).toContain('Leading edge erosion. Second line')
  })
  it('reports a per-query error instead of empty success', () => {
    expect(() => formatDdgResults('q', 5, [{ query: 'q', error: 'RatelimitException' }])).toThrow('RatelimitException')
  })
  it('collapses newlines so one query stays one line', () => {
    expect(sanitizeDdgQuery('a\nb\r\n  c')).toBe('a b c')
  })
})

describe('runDdgWorkflowSearch', () => {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' }) as unknown as Response
  function fakeGithub(opts: { logText?: string; dispatchOk?: boolean; neverFindRun?: boolean }) {
    let name = ''
    const calls: string[] = []
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/dispatches')) {
        name = JSON.parse(String(init!.body)).inputs.invocation_id
        return opts.dispatchOk === false ? json({}, false) : ({ ok: true, status: 204 }) as Response
      }
      if (url.includes('/runs?event')) {
        return json({ workflow_runs: opts.neverFindRun ? [] : [{ id: 9, name: `DuckDuckGo search ${name}`, display_title: '', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'u', run_number: 1 }] })
      }
      if (url.endsWith('/runs/9')) return json({ id: 9, status: 'completed', conclusion: 'success', html_url: 'u' })
      if (url.includes('/jobs?')) return json({ jobs: [{ id: 5 }] })
      if (url.endsWith('/jobs/5/logs')) return ({ ok: true, status: 200, text: async () => opts.logText ?? '' }) as unknown as Response
      return json({}, false)
    }
    return { fetcher, calls }
  }
  const base = { owner: 'o', repo: 'r', token: 't', sleep: async () => {}, pollMs: 0, runDiscoveryTimeoutMs: 50, runCompletionTimeoutMs: 50, logTimeoutMs: 50 }

  it('dispatches with a correlation id, finds the run and returns parsed results', async () => {
    const gh = fakeGithub({ logText: resultLine })
    const out = await runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher })
    expect(out).toContain('Blade erosion')
    expect(gh.calls[0]).toMatch(/POST .*ddg_search\.yml\/dispatches/)
  })
  it('fails loudly when dispatch is refused', async () => {
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher: fakeGithub({ dispatchOk: false }).fetcher })).rejects.toThrow('dispatch failed')
  })
  it('fails loudly when the run is never found', async () => {
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher: fakeGithub({ neverFindRun: true }).fetcher })).rejects.toThrow('was not found')
  })
  it('fails loudly when the log has no result line', async () => {
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher: fakeGithub({ logText: 'nothing here' }).fetcher })).rejects.toThrow('no results were readable')
  })
})
