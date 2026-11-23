// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// @vitest-environment node
// Family-mode full parity at the tool gates (owner decision 2026-11-22: "let her be able to do
// everything I can do"). With a family code and no GitHub token, the tools that used to refuse
// outright — shell_exec, github_write_file, github_search_code, the PR/issue readers — now run
// through the relay's family tier: the fetch stub below only answers relay URLs, so a call
// that escaped to api.github.com fails the test instead of silently passing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, loadToolContext } from './forgeTools'

const RELAY = 'https://relay.example'
const familyCtx = {
  ...loadToolContext(),
  ghToken: '',
  ghOwner: 'DeviousDevv303',
  ghRepo: 'forgeclaw',
  familyCode: 'lighthouse7',
  familyRelayUrl: RELAY,
  guardianPosture: 'autonomous' as const,
}

afterEach(() => vi.unstubAllGlobals())

function stubRelay(handler: (url: URL, init?: RequestInit) => Response | null) {
  const calls: Array<{ url: string; method: string; auth: string | null }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url: String(input), method: init?.method || 'GET', auth: new Headers(init?.headers).get('Authorization') })
    if (url.origin !== RELAY) throw new Error(`escaped the relay: ${url}`)
    const hit = handler(url, init)
    if (hit) return hit
    throw new Error(`Unexpected relay request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

describe('family parity at the tool gates', () => {
  it('shell_exec dispatches through the relay with the family code (was owner-token-only)', async () => {
    let invocationId = ''
    const calls = stubRelay((url, init) => {
      if (url.pathname.endsWith('/actions/workflows/shell-exec.yml/dispatches')) {
        invocationId = (JSON.parse(String(init?.body)) as { inputs: { invocation_id: string } }).inputs.invocation_id
        return new Response(null, { status: 204 })
      }
      if (url.pathname.endsWith('/actions/workflows/shell-exec.yml/runs')) {
        return Response.json({ workflow_runs: [{
          id: 4242, name: `Shell exec ${invocationId}`, display_title: `Shell exec ${invocationId}`,
          event: 'workflow_dispatch', status: 'queued', conclusion: null,
          created_at: new Date().toISOString(), head_branch: 'main',
          html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/4242', run_number: 99,
        }] })
      }
      return null
    })
    const output = await executeTool(
      { id: 'fam-shell', name: 'shell_exec', input: { command: 'pwd', working_directory: '.', wait: false } },
      familyCtx,
    )
    expect(output).toContain('Shell execution dispatched.')
    expect(output).toContain('id: 4242')
    const dispatch = calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.url).toBe(`${RELAY}/v1/family/repos/DeviousDevv303/forgeclaw/actions/workflows/shell-exec.yml/dispatches`)
    expect(dispatch.auth).toBe('Bearer lighthouse7')
  })

  it('github_write_file writes through the relay contents route (was owner-token-only)', async () => {
    const calls = stubRelay((url, init) => {
      if (url.pathname.endsWith('/contents/notes/hello.txt') && (init?.method || 'GET') === 'GET') {
        return Response.json({ message: 'Not Found' }, { status: 404 })
      }
      if (url.pathname.endsWith('/contents/notes/hello.txt') && init?.method === 'PUT') {
        return Response.json({ commit: { sha: 'abc1234567', html_url: 'https://github.com/DeviousDevv303/forgeclaw/commit/abc1234567' }, content: { sha: 'blob1' } })
      }
      return null
    })
    const output = await executeTool(
      { id: 'fam-write', name: 'github_write_file', input: { path: 'notes/hello.txt', content: 'hi', message: 'add hello' } },
      familyCtx,
    )
    expect(output).toContain('Created notes/hello.txt in DeviousDevv303/forgeclaw')
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.url).toBe(`${RELAY}/v1/family/repos/DeviousDevv303/forgeclaw/contents/notes/hello.txt`)
    expect(put.auth).toBe('Bearer lighthouse7')
  })

  it('github_search_code searches through the relay search route (was owner-token-only)', async () => {
    const calls = stubRelay(url => {
      if (url.pathname === '/v1/family/search/code') {
        return Response.json({ total_count: 1, items: [{ path: 'src/lib/shell.ts', html_url: 'https://github.com/DeviousDevv303/forgeclaw/blob/main/src/lib/shell.ts' }] })
      }
      return null
    })
    const output = await executeTool(
      { id: 'fam-search', name: 'github_search_code', input: { query: 'shell' } },
      familyCtx,
    )
    expect(output).toContain('Found 1 matches for "shell"')
    expect(output).toContain('src/lib/shell.ts')
    expect(calls[0].auth).toBe('Bearer lighthouse7')
  })

  it('github_list_prs and github_read_issue read through the relay (were owner-token-only)', async () => {
    stubRelay(url => {
      if (url.pathname.endsWith('/pulls')) return Response.json([])
      if (url.pathname.endsWith('/issues/235')) {
        return Response.json({ number: 235, title: 'The channel', body: 'body', state: 'open', user: { login: 'DeviousDevv303' }, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', labels: [], html_url: 'https://github.com/DeviousDevv303/forgeclaw/issues/235', comments: 0 })
      }
      if (url.pathname.endsWith('/issues/235/comments')) return Response.json([])
      return null
    })
    const prs = await executeTool({ id: 'fam-prs', name: 'github_list_prs', input: {} }, familyCtx)
    expect(prs).toContain('No open pull requests in DeviousDevv303/forgeclaw')
    const issue = await executeTool({ id: 'fam-issue', name: 'github_read_issue', input: { issue_number: 235 } }, familyCtx)
    expect(issue).toContain('235')
    expect(issue).not.toContain('No GitHub token configured')
  })

  it('the same tools still refuse cleanly with neither a token nor a family code', async () => {
    stubRelay(() => null)
    const bare = { ...familyCtx, familyCode: undefined, familyRelayUrl: undefined }
    const shell = await executeTool({ id: 'bare-shell', name: 'shell_exec', input: { command: 'pwd', working_directory: '.' } }, bare)
    expect(shell).toBe('[TOOL ERROR] No GitHub token configured. Add gh_token in memory or settings.')
    const write = await executeTool({ id: 'bare-write', name: 'github_write_file', input: { path: 'a.txt', content: 'x', message: 'm' } }, bare)
    expect(write).toContain('No GitHub token configured')
  })
})
