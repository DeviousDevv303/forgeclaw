import { describe, expect, it } from 'vitest'
import { buildAndPublishSite, validateBuildInput, type BuildSiteInput } from './siteBuild'
import type { GithubRequest } from './githubPublish'

const WF = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'
const SITE = 'https://api.github.com/repos/me/app'
type Call = { method: string; url: string; body?: Record<string, unknown> }

function fake(opts: { conclusion?: string; mirrorFiles?: Array<{ path: string; b64: string }>; treeTruncated?: boolean } = {}) {
  const calls: Call[] = []
  let clock = 1_000_000
  let polls = 0
  const run = (status: string) => ({
    id: 77, run_number: 12, name: 'Site Build', display_title: 'Site build inv-1', event: 'workflow_dispatch', head_branch: 'main',
    status, conclusion: status === 'completed' ? (opts.conclusion ?? 'success') : null,
    created_at: new Date(clock).toISOString(), html_url: 'https://github.com/DeviousDevv303/forgeclaw/actions/runs/77',
  })
  const mirror = opts.mirrorFiles ?? [{ path: 'index.html', b64: btoa('<h1>app</h1>') }, { path: 'assets/logo.png', b64: 'iVBORw0KGgo=' }]
  const request: GithubRequest = async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ method, url, body })
    if (url === `${WF}/actions/workflows/site-build.yml/dispatches`) return new Response(null, { status: 204 })
    if (url.startsWith(`${WF}/actions/workflows/site-build.yml/runs`)) return Response.json({ workflow_runs: [run('in_progress')] })
    if (url === `${WF}/actions/runs/77`) { polls += 1; return Response.json(run(polls >= 2 ? 'completed' : 'in_progress')) }
    if (url === `${WF}/git/trees/site-builds?recursive=1`) {
      return Response.json({ tree: [
        { path: 'builds/other-run/index.html', type: 'blob', sha: 'x' },
        { path: 'builds/inv-1', type: 'tree', sha: 't' },
        ...mirror.map((f, i) => ({ path: `builds/inv-1/${f.path}`, type: 'blob', sha: `b${i}` })),
      ], truncated: opts.treeTruncated ?? false })
    }
    const blob = /\/git\/blobs\/b(\d+)$/.exec(url)
    if (blob && url.startsWith(WF)) return Response.json({ content: `${mirror[Number(blob[1])].b64}\n`, encoding: 'base64' })
    // Site repository (publishSite).
    if (url === SITE) return Response.json({ default_branch: 'main' })
    if (url === `${SITE}/git/ref/heads/gh-pages`) return new Response('{}', { status: 404 })
    if (url === `${SITE}/git/blobs` && method === 'POST') return Response.json({ sha: `blob-${calls.length}` })
    if (url === `${SITE}/git/trees` && method === 'POST') return Response.json({ sha: 'tree' })
    if (url === `${SITE}/git/commits` && method === 'POST') return Response.json({ sha: 'commit1' })
    if (url === `${SITE}/git/refs` && method === 'POST') return Response.json({})
    if (url === `${SITE}/pages` && method === 'GET') return new Response('{}', { status: 404 })
    if (url === `${SITE}/pages` && method === 'POST') return Response.json({ html_url: 'https://me.github.io/app/' })
    return new Response(JSON.stringify({ message: `unmocked ${method} ${url}` }), { status: 500 })
  }
  const input: BuildSiteInput = {
    workflowOwner: 'DeviousDevv303', workflowRepo: 'forgeclaw', owner: 'me', repo: 'app', token: 't', invocationId: 'inv-1',
    sleep: async ms => { clock += ms }, now: () => clock,
  }
  return { request, calls, input }
}

describe('buildAndPublishSite', () => {
  it('dispatches the build, waits for the correlated run, and publishes only this build\'s output, binary-safe', async () => {
    const f = fake()
    const result = await buildAndPublishSite(f.request, f.input)
    expect(result.files).toBe(2)
    expect(result.publish).toMatchObject({ commitSha: 'commit1', branch: 'gh-pages', pages: 'enabled' })
    const dispatch = f.calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.body).toEqual({ ref: 'main', inputs: { source_repo: 'me/app', source_ref: 'source', build_command: 'npm ci && npm run build', output_dir: 'dist', invocation_id: 'inv-1' } })
    // Every mirrored file becomes a base64 blob in the site repo; nothing from another build is read.
    expect(f.calls.filter(c => c.url === `${SITE}/git/blobs`).map(c => c.body)).toEqual([
      { content: btoa('<h1>app</h1>'), encoding: 'base64' },
      { content: 'iVBORw0KGgo=', encoding: 'base64' },
    ])
    expect(f.calls.some(c => c.url.endsWith('/git/blobs/x'))).toBe(false)
    const tree = f.calls.find(c => c.url === `${SITE}/git/trees`)!.body!.tree as Array<{ path: string; sha?: string }>
    expect(tree.map(t => t.path)).toEqual(['index.html', 'assets/logo.png', '.nojekyll'])
  })

  it('publishes nothing when the build failed, and points at the logs', async () => {
    const f = fake({ conclusion: 'failure' })
    await expect(buildAndPublishSite(f.request, f.input)).rejects.toThrow(/build run #12 concluded "failure"; nothing was published\. Logs: https:\/\/github\.com\/DeviousDevv303\/forgeclaw\/actions\/runs\/77/)
    expect(f.calls.some(c => c.url.startsWith(SITE))).toBe(false)
  })

  it('reports an empty output when the mirror tree listing is truncated', async () => {
    const f = fake({ mirrorFiles: [], treeTruncated: true })
    await expect(buildAndPublishSite(f.request, f.input)).rejects.toThrow(/site-builds is empty \(tree listing truncated\)/)
    expect(f.calls.some(c => c.url.startsWith(SITE))).toBe(false)
  })

  it('refuses to publish a build into the ForgeClaw repository', async () => {
    const f = fake()
    await expect(buildAndPublishSite(f.request, { ...f.input, owner: 'DeviousDevv303', repo: 'forgeclaw' })).rejects.toThrow(/deployed ForgeClaw app/)
    expect(f.calls).toEqual([])  // refused before any dispatch
  })
})

describe('validateBuildInput', () => {
  const base = { workflowOwner: 'o', workflowRepo: 'r', owner: 'me', repo: 'app', token: 't' }
  it.each([
    [{ outputDir: '../etc' }, /output_dir/],
    [{ outputDir: '/abs' }, /output_dir/],
    [{ sourceBranch: 'a..b' }, /source branch/],
    [{ repo: 'a b' }, /invalid repository/],
    [{ buildCommand: 'x'.repeat(501) }, /1-500/],
  ])('rejects %o', (patch, error) => {
    expect(() => validateBuildInput({ ...base, ...patch })).toThrow(error)
  })
  it('defaults to a Vite build of the source branch', () => {
    expect(validateBuildInput(base)).toEqual({ sourceBranch: 'source', buildCommand: 'npm ci && npm run build', outputDir: 'dist' })
  })
})
