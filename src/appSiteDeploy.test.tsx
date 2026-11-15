// @vitest-environment jsdom
// End-to-end site deployment through the real App, tool dispatcher and Guardian gate, with Kimi:
// create repo -> publish all files in one commit -> poll Pages -> report. Authorized 2026-10-20 to run
// without co-sign under the default posture.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions'
type Msg = { role: string; content: string; tool_call_id?: string }
let fetchMock: ReturnType<typeof vi.fn>
let kimiReplies: unknown[]
const toolCall = (id: string, name: string, args: unknown) => ({
  choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }],
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'moonshot')
  localStorage.setItem('fm_moonshot_key', 'sk-test-kimi-key-0123456789abcdef')
  kimiReplies = []
  let pagesExists = false
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || 'GET').toUpperCase()
    if (url === KIMI_URL) return Response.json(kimiReplies.shift() ?? { choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] })
    if (url === 'https://api.github.com/user/repos' && method === 'POST') {
      return Response.json({ name: 'bakery-site', html_url: 'https://github.com/me/bakery-site', default_branch: 'main', owner: { login: 'me' } }, { status: 201 })
    }
    const base = 'https://api.github.com/repos/me/bakery-site'
    if (url === base) return Response.json({ default_branch: 'main' })
    if (url === `${base}/git/ref/heads/gh-pages`) return new Response('{}', { status: 404 })
    if (url === `${base}/git/trees` && method === 'POST') return Response.json({ sha: 'tree1' })
    if (url === `${base}/git/commits` && method === 'POST') return Response.json({ sha: 'c0ffee1234567890' })
    if (url === `${base}/git/refs` && method === 'POST') return Response.json({})
    if (url === `${base}/pages` && method === 'GET') return pagesExists ? Response.json({ html_url: 'https://me.github.io/bakery-site/' }) : new Response('{}', { status: 404 })
    if (url === `${base}/pages` && method === 'POST') { pagesExists = true; return Response.json({ html_url: 'https://me.github.io/bakery-site/' }, { status: 201 }) }
    if (url === `${base}/pages/builds/latest`) return Response.json({ status: 'built', commit: 'c0ffee1234567890', error: { message: null } })
    return new Response(JSON.stringify({ message: `unmocked ${method} ${url}` }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules() })

const kimiBodies = () => fetchMock.mock.calls.filter(([url]) => String(url) === KIMI_URL).map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { tools?: Array<{ function: { name: string } }>; messages: Msg[] })

describe('autonomous site deployment with Kimi', () => {
  it('creates the repo, publishes in one commit, verifies the build and reports, with no co-sign prompt', async () => {
    kimiReplies.push(
      toolCall('k1', 'github_create_repo', { name: 'bakery-site' }),
      toolCall('k2', 'github_publish_site', { owner: 'me', repo: 'bakery-site', message: 'Bakery site', files: [{ path: 'index.html', content: '<h1>Bakery</h1>' }, { path: 'style.css', content: 'h1{}' }] }),
      toolCall('k3', 'github_pages_status', { owner: 'me', repo: 'bakery-site' }),
      { choices: [{ message: { content: 'Live at https://me.github.io/bakery-site/' }, finish_reason: 'stop' }] },
    )
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'build me a landing page website for my bakery and deploy it' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(kimiBodies().length).toBe(4), { timeout: 10_000 })

    const first = kimiBodies()[0]
    const names = (first.tools ?? []).map(t => t.function.name)
    for (const name of ['github_create_repo', 'github_publish_site', 'github_pages_status']) expect(names).toContain(name)
    expect(first.messages[0].content).toContain('call github_publish_site ONCE with every file')

    const last = kimiBodies()[3].messages.filter(m => m.role === 'tool').map(m => m.content)
    expect(last[0]).toMatch(/^✓ Created repository me\/bakery-site/)
    expect(last[1]).toMatch(/^✓ Published 3 file\(s\) to me\/bakery-site@gh-pages in one commit/)
    expect(last[1]).toContain('Pages enabled for gh-pages')
    expect(last[2]).toMatch(/^Pages me\/bakery-site: built \(commit c0ffee1\)/)
    // One tree with every file (+ .nojekyll), one commit.
    const treePosts = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/git/trees') && (init as RequestInit).method === 'POST')
    expect(treePosts).toHaveLength(1)
    expect(JSON.parse(String((treePosts[0][1] as RequestInit).body)).tree.map((t: { path: string }) => t.path)).toEqual(['index.html', 'style.css', '.nojekyll'])
    // The URL is a tappable link now, so the sentence spans a text node and a link: check the visible text.
    await waitFor(() => expect(document.body.textContent).toMatch(/Live at https:\/\/me\.github\.io\/bakery-site\//), { timeout: 8000 })
    expect((screen.getByRole('link', { name: 'https://me.github.io/bakery-site/' }) as HTMLAnchorElement).href).toBe('https://me.github.io/bakery-site/')
    expect(screen.queryByText(/STATUS: BLOCKED/)).toBeNull()
    // A co-sign request would park the run (no 4th Kimi call); none of the results is a Guardian block.
    expect(last.some(content => content.startsWith('[GUARDIAN'))).toBe(false)
  }, 20_000)

  it('refuses to publish a site into the ForgeClaw repository', async () => {
    kimiReplies.push(toolCall('k1', 'github_publish_site', { owner: 'DeviousDevv303', repo: 'forgeclaw', message: 'x', files: [{ path: 'index.html', content: 'x' }] }))
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'publish a website for me' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(kimiBodies().length).toBe(2), { timeout: 10_000 })
    const tool = kimiBodies()[1].messages.find(m => m.role === 'tool')
    expect(tool?.content).toMatch(/^\[TOOL ERROR\] refusing to publish into DeviousDevv303\/forgeclaw/)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/repos/DeviousDevv303/forgeclaw/git/'))).toBe(false)
  }, 20_000)

  it('blocks a tool the turn did not offer (a plain question gets no github_create_repo)', async () => {
    kimiReplies.push(toolCall('k1', 'github_create_repo', { name: 'injected' }))
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'what is a good name for a dog?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(kimiBodies().length).toBe(2), { timeout: 10_000 })
    expect((kimiBodies()[0].tools ?? []).map(t => t.function.name)).not.toContain('github_create_repo')
    const tool = kimiBodies()[1].messages.find(m => m.role === 'tool')
    expect(tool?.content).toMatch(/^\[GUARDIAN BLOCKED\] github_create_repo was not offered/)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://api.github.com/user/repos')).toBe(false)
  }, 20_000)

  it('stops a run from creating more than 2 repositories', async () => {
    kimiReplies.push(
      toolCall('a', 'github_create_repo', { name: 'one' }),
      toolCall('b', 'github_create_repo', { name: 'two' }),
      toolCall('c', 'github_create_repo', { name: 'three' }),
    )
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'build me a website and deploy it' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(kimiBodies().length).toBe(4), { timeout: 10_000 })
    const results = kimiBodies()[3].messages.filter(m => m.role === 'tool').map(m => m.content)
    expect(results[0]).toMatch(/^✓ Created repository/)
    expect(results[1]).toMatch(/^✓ Created repository/)
    expect(results[2]).toMatch(/^\[GUARDIAN BLOCKED\] github_create_repo was not executed: this run already created 2/)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://api.github.com/user/repos')).toHaveLength(2)
  }, 20_000)
})

