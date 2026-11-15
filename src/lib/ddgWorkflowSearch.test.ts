import { describe, expect, it } from 'vitest'
import { formatDdgResults, parseDdgLog, runDdgWorkflowSearch, sanitizeDdgQuery, DDG_RESULT_MARKER, DDG_MAX_SNIPPET_CHARS } from './ddgWorkflowSearch'

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
  it('caps very long snippets at the snippet limit', () => {
    const long = [{ title: 'Long', href: 'https://example.com/l', body: 'word '.repeat(300) }]
    const out = formatDdgResults('q', 1, [{ query: 'q', results: long }])
    const snippetLine = out.split('\n').find(line => line.startsWith('   word'))!
    expect(snippetLine.trim().length).toBeLessThanOrEqual(DDG_MAX_SNIPPET_CHARS + 1)
    expect(snippetLine.endsWith('…')).toBe(true)
  })

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
  it('keeps looking for the run through dropped connections and non-OK reads', async () => {
    const gh = fakeGithub({ logText: resultLine })
    let listReads = 0
    const flaky = async (url: string, init?: RequestInit) => {
      if (url.includes('/runs?event') && ++listReads <= 2) {
        if (listReads === 1) throw new TypeError('Failed to fetch')
        return json({}, false)
      }
      if (url.includes('/jobs?') && listReads === 3) { listReads++; throw new TypeError('Failed to fetch') }
      return gh.fetcher(url, init)
    }
    const out = await runDdgWorkflowSearch('q', 5, { ...base, runDiscoveryTimeoutMs: 10_000, logTimeoutMs: 10_000, fetcher: flaky })
    expect(out).toContain('Blade erosion')
    expect(listReads).toBe(4)
  })
  it('still reads once more when a suspended sleep overran the discovery deadline', async () => {
    let t = Date.now()
    const gh = fakeGithub({ logText: resultLine })
    let listReads = 0
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.includes('/runs?event') && ++listReads === 1) return json({ workflow_runs: [] })
      return gh.fetcher(url, init)
    }
    // The app was backgrounded: the first sleep returns long after the deadline.
    const out = await runDdgWorkflowSearch('q', 5, { ...base, now: () => t, sleep: async () => { t += 600_000 }, runDiscoveryTimeoutMs: 60_000, logTimeoutMs: 10_000, fetcher })
    expect(out).toContain('Blade erosion')
    expect(listReads).toBe(2)
  })
  it('names the last read failure when the run is never found', async () => {
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.includes('/runs?event')) throw new TypeError('Failed to fetch')
      return fakeGithub({}).fetcher(url, init)
    }
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher })).rejects.toThrow('last read: network error: Failed to fetch')
  })
  it('labels a dispatch network failure instead of a bare "Failed to fetch"', async () => {
    const fetcher = async () => { throw new TypeError('Failed to fetch') }
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher })).rejects.toThrow('dispatch failed (network error: Failed to fetch)')
  })
  it('fails loudly when the log has no result line', async () => {
    await expect(runDdgWorkflowSearch('q', 5, { ...base, fetcher: fakeGithub({ logText: 'nothing here' }).fetcher })).rejects.toThrow('no results were readable')
  })

  // The 2026-10-31 incident: the run completed in 13s while every status read wedged, so
  // the poll budget exhausted without a single successful status read. That is a READ
  // failure, not an unfinished run — the completed run's log must still be attempted.
  function wedgedStatusGithub(logText: string) {
    let name = ''
    const calls: string[] = []
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/dispatches')) {
        name = JSON.parse(String(init!.body)).inputs.invocation_id
        return ({ ok: true, status: 204 }) as Response
      }
      if (url.includes('/runs?event')) {
        return json({ workflow_runs: [{ id: 9, name: `DuckDuckGo search ${name}`, display_title: '', event: 'workflow_dispatch', status: 'in_progress', conclusion: null, created_at: new Date().toISOString(), head_branch: 'main', html_url: 'u', run_number: 1 }] })
      }
      if (url.endsWith('/runs/9')) throw new TypeError('Failed to fetch')
      if (url.includes('/jobs?')) return json({ jobs: [{ id: 5 }] })
      if (url.endsWith('/jobs/5/logs')) return ({ ok: true, status: 200, text: async () => logText }) as unknown as Response
      return json({}, false)
    }
    return { fetcher, calls }
  }

  it('attempts the log read and returns its results when the poll budget exhausts on failed reads', async () => {
    const gh = wedgedStatusGithub(resultLine)
    const out = await runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher })
    expect(out).toContain('Blade erosion')
    expect(gh.calls.some(c => c.includes('/jobs?'))).toBe(true)
    expect(gh.calls.some(c => c.includes('/jobs/5/logs'))).toBe(true)
  })

  it('reports a read-back failure, not "did not finish", when wedged polls are followed by an unreadable log', async () => {
    const gh = wedgedStatusGithub('nothing here')
    const pending = runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher })
    await expect(pending).rejects.toThrow('finished state could not be read back')
    await expect(pending).rejects.not.toThrow('did not finish in time')
  })
})

describe('runDdgWorkflowSearch timelimit dispatch', () => {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response
  function recordingGithub() {
    let name = ''
    let dispatched: Record<string, string> | null = null
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dispatches')) {
        dispatched = JSON.parse(String(init!.body)).inputs as Record<string, string>
        name = dispatched.invocation_id
        return ({ ok: true, status: 204 }) as Response
      }
      if (url.includes('/runs?event')) {
        return json({ workflow_runs: [{ id: 9, name: `DuckDuckGo search ${name}`, display_title: '', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: new Date().toISOString(), head_branch: 'main', html_url: 'u', run_number: 1 }] })
      }
      if (url.endsWith('/runs/9')) return json({ id: 9, status: 'completed', conclusion: 'success', html_url: 'u' })
      if (url.includes('/jobs?')) return json({ jobs: [{ id: 5 }] })
      if (url.endsWith('/jobs/5/logs')) return ({ ok: true, status: 200, text: async () => resultLine }) as unknown as Response
      return json({})
    }
    return { fetcher, inputs: () => dispatched }
  }
  const base = { owner: 'o', repo: 'r', token: 't', sleep: async () => {}, pollMs: 0, runDiscoveryTimeoutMs: 50, runCompletionTimeoutMs: 50, logTimeoutMs: 50 }

  it('passes a valid timelimit to the workflow dispatch', async () => {
    const gh = recordingGithub()
    await runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher }, 'w')
    expect(gh.inputs()?.timelimit).toBe('w')
  })
  it('omits the input when no timelimit is given', async () => {
    const gh = recordingGithub()
    await runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher })
    expect(gh.inputs()).not.toHaveProperty('timelimit')
  })
  it('omits a timelimit the workflow does not declare', async () => {
    const gh = recordingGithub()
    await runDdgWorkflowSearch('q', 5, { ...base, fetcher: gh.fetcher }, 'fortnight')
    expect(gh.inputs()).not.toHaveProperty('timelimit')
  })
})
