import { describe, expect, it } from 'vitest'
import { createRepo, pagesStatus, publishSite, validatePublishPath, type GithubRequest } from './githubPublish'

type Call = { method: string; url: string; body?: Record<string, unknown> }

/** In-memory GitHub: one repo with a main branch, optional site branch and optional Pages site. */
function fakeGithub(opts: { siteBranchSha?: string; pages?: { branch: string } | null; defaultBranch?: string; refPatchStatus?: number } = {}) {
  const calls: Call[] = []
  const request: GithubRequest = async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ method, url, body })
    const path = url.replace('https://api.github.com/repos/me/site', '')
    if (method === 'GET' && path === '') return Response.json({ default_branch: opts.defaultBranch ?? 'main' })
    if (method === 'GET' && path.startsWith('/git/ref/heads/')) {
      return opts.siteBranchSha ? Response.json({ object: { sha: opts.siteBranchSha } }) : new Response('{}', { status: 404 })
    }
    if (method === 'GET' && path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'basetree' } })
    if (method === 'POST' && path === '/git/trees') return Response.json({ sha: 'newtree' })
    if (method === 'POST' && path === '/git/commits') return Response.json({ sha: 'newcommit' })
    if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) return new Response('{}', { status: opts.refPatchStatus ?? 200 })
    if (method === 'POST' && path === '/git/refs') return Response.json({ ref: body?.ref })
    if (method === 'GET' && path === '/pages') {
      return opts.pages ? Response.json({ html_url: 'https://me.github.io/site/', source: { branch: opts.pages.branch, path: '/' } }) : new Response('{}', { status: 404 })
    }
    if (method === 'POST' && path === '/pages') return Response.json({ html_url: 'https://me.github.io/site/' }, { status: 201 })
    return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), { status: 500 })
  }
  return { request, calls }
}

const site = [{ path: 'index.html', content: '<h1>Hi</h1>' }, { path: 'css/style.css', content: 'h1{color:red}' }]
const base = { owner: 'me', repo: 'site', token: 't', message: 'Publish site' }

describe('publishSite', () => {
  it('publishes a new site in one commit, creates gh-pages, adds .nojekyll and enables Pages', async () => {
    const gh = fakeGithub()
    const result = await publishSite(gh.request, { ...base, files: site })
    expect(result).toMatchObject({ commitSha: 'newcommit', branch: 'gh-pages', createdBranch: true, pages: 'enabled', pagesUrl: 'https://me.github.io/site/' })
    expect(result.beforeSha).toBeUndefined()
    const writes = gh.calls.filter(c => c.method !== 'GET')
    expect(writes.map(c => `${c.method} ${c.url.split('/repos/me/site')[1]}`)).toEqual(['POST /git/trees', 'POST /git/commits', 'POST /git/refs', 'POST /pages'])
    const tree = writes[0].body!.tree as Array<{ path: string }>
    expect(tree.map(t => t.path)).toEqual(['index.html', 'css/style.css', '.nojekyll'])
    expect(writes[0].body!.base_tree).toBeUndefined()
    expect(writes[1].body!.parents).toEqual([])
    expect(writes[2].body).toEqual({ ref: 'refs/heads/gh-pages', sha: 'newcommit' })
    expect(writes[3].body).toEqual({ source: { branch: 'gh-pages', path: '/' } })
  })

  it('updates an existing site branch on top of its head, without force, and leaves Pages alone', async () => {
    const gh = fakeGithub({ siteBranchSha: 'oldhead', pages: { branch: 'gh-pages' } })
    const result = await publishSite(gh.request, { ...base, files: [{ path: 'about.html', content: 'x' }] })
    expect(result).toMatchObject({ beforeSha: 'oldhead', createdBranch: false, pages: 'already-serving' })
    const tree = gh.calls.find(c => c.url.endsWith('/git/trees'))!
    expect(tree.body!.base_tree).toBe('basetree')
    expect((tree.body!.tree as unknown[]).length).toBe(1)  // no index.html needed, no .nojekyll re-added
    expect(gh.calls.find(c => c.url.endsWith('/git/commits'))!.body!.parents).toEqual(['oldhead'])
    expect(gh.calls.find(c => c.method === 'PATCH')!.body).toEqual({ sha: 'newcommit', force: false })
    expect(gh.calls.some(c => c.method === 'POST' && c.url.endsWith('/pages'))).toBe(false)
  })

  it('reports, and does not repoint, a Pages site serving another branch', async () => {
    const gh = fakeGithub({ siteBranchSha: 'h', pages: { branch: 'main' } })
    const result = await publishSite(gh.request, { ...base, files: site })
    expect(result.pages).toBe('serving-other-source')
    expect(result.pagesSource).toBe('main/')
    expect(gh.calls.some(c => c.method !== 'GET' && c.url.endsWith('/pages'))).toBe(false)
  })

  it('fails loudly when the branch moved underneath it', async () => {
    const gh = fakeGithub({ siteBranchSha: 'h', refPatchStatus: 422 })
    await expect(publishSite(gh.request, { ...base, files: site })).rejects.toThrow(/moving gh-pages failed: GitHub 422/)
  })

  it.each([
    [{ ...base, owner: 'DeviousDevv303', repo: 'forgeclaw' }, /deployed ForgeClaw app/],
    [{ ...base, branch: 'main' }, /refusing to publish to main/],
    [{ ...base, branch: 'refs/heads/master' }, /refusing to publish to master/],
    [{ ...base, token: '' }, /No GitHub token/],
  ])('refuses unsafe targets before any request: %#', async (input, error) => {
    const gh = fakeGithub()
    await expect(publishSite(gh.request, { ...input, files: site })).rejects.toThrow(error)
    expect(gh.calls).toEqual([])
  })

  it('refuses the repository default branch even when it is not called main', async () => {
    const gh = fakeGithub({ defaultBranch: 'gh-pages' })
    await expect(publishSite(gh.request, { ...base, files: site })).rejects.toThrow(/it is the default branch/)
    expect(gh.calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('needs an index.html for a new site branch', async () => {
    const gh = fakeGithub()
    await expect(publishSite(gh.request, { ...base, files: [{ path: 'about.html', content: 'x' }] })).rejects.toThrow(/needs an index.html/)
    expect(gh.calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('rejects duplicate paths, too many files and oversized sites', async () => {
    const gh = fakeGithub()
    await expect(publishSite(gh.request, { ...base, files: [site[0], site[0]] })).rejects.toThrow(/duplicate path/)
    await expect(publishSite(gh.request, { ...base, files: Array.from({ length: 101 }, (_, i) => ({ path: `p${i}.html`, content: '' })) })).rejects.toThrow(/at most 100/)
    await expect(publishSite(gh.request, { ...base, files: [{ path: 'index.html', content: 'x'.repeat(2_000_001) }] })).rejects.toThrow(/limit per publish/)
  })
})

describe('validatePublishPath', () => {
  it.each(['.github/workflows/x.yml', '.GitHub/workflows/x.yml', '.git/config', '.gitmodules', '../x', 'a/../b', '/etc/passwd', 'a\\b', '', 'a//b'])('rejects %s', path => {
    expect(() => validatePublishPath(path)).toThrow()
  })
  it('accepts ordinary site paths and strips a leading ./', () => {
    expect(validatePublishPath('./assets/app.js')).toBe('assets/app.js')
    expect(validatePublishPath('_next/static/x.js')).toBe('_next/static/x.js')
  })
})

describe('pagesStatus', () => {
  it('reports the latest build so a publish can be verified', async () => {
    const request: GithubRequest = async url => url.endsWith('/builds/latest')
      ? Response.json({ status: 'built', commit: 'newcommit', error: { message: null }, updated_at: '2026-10-20T00:00:00Z' })
      : Response.json({ html_url: 'https://me.github.io/site/', status: 'built' })
    expect(await pagesStatus(request, 'me', 'site', 't')).toEqual({ status: 'built', url: 'https://me.github.io/site/', commit: 'newcommit', error: undefined, updatedAt: '2026-10-20T00:00:00Z' })
  })
  it('says not built yet before the first build exists', async () => {
    const request: GithubRequest = async url => url.endsWith('/builds/latest') ? new Response('{}', { status: 404 }) : Response.json({ html_url: 'u' })
    expect((await pagesStatus(request, 'me', 'site', 't')).status).toBe('not built yet')
  })
})

describe('createRepo', () => {
  it('creates a public, initialized repository so the site branch is never the default', async () => {
    let sent: Record<string, unknown> = {}
    const request: GithubRequest = async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return Response.json({ name: 'site', html_url: 'https://github.com/me/site', default_branch: 'main', owner: { login: 'me' } }, { status: 201 })
    }
    expect(await createRepo(request, { token: 't', name: 'site' })).toEqual({ owner: 'me', repo: 'site', url: 'https://github.com/me/site', defaultBranch: 'main' })
    expect(sent).toMatchObject({ name: 'site', private: false, auto_init: true })
  })
  it('explains a name that already exists', async () => {
    const request: GithubRequest = async () => Response.json({ message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }, { status: 422 })
    await expect(createRepo(request, { token: 't', name: 'site' })).rejects.toThrow(/name already exists/)
  })
  it.each(['', 'a b', '../x', 'x/y'])('rejects invalid name %s', async name => {
    await expect(createRepo(async () => new Response(), { token: 't', name })).rejects.toThrow(/invalid repository name/)
  })
})
