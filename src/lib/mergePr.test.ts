// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { mergePullRequest } from './mergePr'
import { isProtectedPath, parseProtectedList } from './protectedPaths'
import { requiresCoSign } from './guardianGate'
import { executeTool, FORGE_TOOLS } from './forgeTools'
import { CODING_TOOL_ORDER, toolsForCapability, WRITE_TOOL_NAMES } from './managedAgent'
import { SCULPT_LOCKED_MESSAGE } from './sculptKey'

const POLICY = '# policy\n.github/\npackage.json\nsrc/lib/guardianGate.ts\nvite.config.*\n'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const b64 = (text: string) => btoa(text)

interface World { pull?: Partial<Record<string, unknown>>; files?: string[]; checks?: Array<{ name: string; status: string; conclusion: string | null }>; policy?: string | null; mergeStatus?: number }
function github(w: World = {}) {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  const files = w.files ?? ['src/lib/elapsed.ts']
  const request = async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/\/pulls\/\d+\/merge$/.test(url)) return json(w.mergeStatus === 405 ? { message: 'Pull Request is not mergeable' } : { merged: true, sha: 'abcdef1234567' }, w.mergeStatus ?? 200)
    if (/\/pulls\/\d+\/files/.test(url)) return json(files.map(filename => ({ filename })))
    if (/\/pulls\/\d+$/.test(url)) return json({ number: 7, title: 'Tidy elapsed', state: 'open', draft: false, mergeable: true, mergeable_state: 'clean', changed_files: files.length, head: { sha: 'headsha1234567' }, base: { ref: 'main', repo: { default_branch: 'main' } }, ...w.pull })
    if (url.includes('/contents/.github/protected-paths.txt')) return w.policy === null ? json({}, 404) : json({ content: b64(w.policy ?? POLICY), encoding: 'base64' })
    if (url.includes('/check-runs')) return json({ total_count: 1, check_runs: w.checks ?? [{ name: 'build', status: 'completed', conclusion: 'success' }] })
    return json({}, 404)
  }
  return { request, calls }
}
const input = { owner: 'o', repo: 'r', token: 't', pullNumber: 7, sleep: async () => {} }

describe('mergePullRequest', () => {
  it('merges a green pull request, pinned to the head it checked', async () => {
    const g = github()
    const out = await mergePullRequest(g.request, input)
    expect(out).toMatch(/^✓ Merged pull request #7 "Tidy elapsed" into main \(squash\) as abcdef1/)
    const put = g.calls.find(c => c.method === 'PUT')!
    expect(put.body).toEqual({ merge_method: 'squash', sha: 'headsha1234567' })
  })
  const refusals: Array<[string, World, RegExp]> = [
    ['a draft', { pull: { draft: true } }, /still a draft/],
    ['a closed pull request', { pull: { state: 'closed' } }, /is closed/],
    ['a pull request that is already merged', { pull: { merged: true, state: 'closed' } }, /already merged/],
    ['another base branch', { pull: { base: { ref: 'develop', repo: { default_branch: 'main' } } } }, /targets "develop"/],
    ['conflicts', { pull: { mergeable: false, mergeable_state: 'dirty' } }, /merge conflicts/],
    ['a protected path (workflow)', { files: ['src/a.ts', '.github/workflows/x.yml'] }, /protected paths \(\.github\/workflows\/x\.yml\)/],
    ['a protected path (Guardian)', { files: ['src/lib/guardianGate.ts'] }, /protected paths/],
    ['a protected path at any depth', { files: ['packages/app/package.json'] }, /protected paths/],
    ['an unreadable policy', { policy: null }, /Could not read the protected-paths policy/],
    ['no checks at all', { checks: [] }, /No checks ran/],
    ['a check still running', { checks: [{ name: 'build', status: 'in_progress', conclusion: null }] }, /not all green.*build \(in_progress\)/],
    ['a failing check', { checks: [{ name: 'build', status: 'completed', conclusion: 'failure' }] }, /build \(failure\)/],
    ['a refusal from GitHub', { mergeStatus: 405 }, /GitHub refused the merge.*405/],
  ]
  for (const [name, world, message] of refusals) {
    it(`refuses ${name}, and merges nothing`, async () => {
      const g = github(world)
      await expect(mergePullRequest(g.request, input)).rejects.toThrow(message)
      if (!(world.mergeStatus)) expect(g.calls.some(c => c.method === 'PUT')).toBe(false)
    })
  }
  it('refuses a pull request that moved since it was reviewed', async () => {
    const g = github()
    await expect(mergePullRequest(g.request, { ...input, expectedHeadSha: 'oldsha0000000' })).rejects.toThrow(/changed since it was reviewed/)
    expect(g.calls.some(c => c.method === 'PUT')).toBe(false)
  })
  it('checks the old name of a renamed file too', async () => {
    const g = github()
    const request = async (url: string, init?: RequestInit) => /\/pulls\/7\/files/.test(url) ? json([{ filename: 'docs/x.md', previous_filename: '.github/workflows/y.yml' }]) : g.request(url, init)
    await expect(mergePullRequest(request, input)).rejects.toThrow(/protected paths/)
  })
})

describe('the gate', () => {
  const call = { id: '1', name: 'github_merge_pr', input: { pull_number: 7 } }
  it('co-signs under every posture, including autonomous', () => {
    for (const posture of ['autonomous', 'operator-shell', 'full-cosign'] as const) expect(requiresCoSign(call, posture), posture).toBe(true)
  })
  it('is offered to the coding capability only, never to read-only agents', () => {
    expect(FORGE_TOOLS.some(t => t.name === 'github_merge_pr')).toBe(true)
    expect(WRITE_TOOL_NAMES.has('github_merge_pr')).toBe(true)
    expect(CODING_TOOL_ORDER).toContain('github_merge_pr')
    expect(toolsForCapability('coding', FORGE_TOOLS).map(t => t.name)).toContain('github_merge_pr')
    expect(toolsForCapability('coding-readonly', FORGE_TOOLS).map(t => t.name)).not.toContain('github_merge_pr')
  })
  it('does nothing while self-sculpt is locked', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool(call, { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true, sculptUnlocked: false } as never)
    expect(out).toBe(SCULPT_LOCKED_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('protected paths: the TypeScript port agrees with the Python checker the workflows run', () => {
  const list = readFileSync('.github/protected-paths.txt', 'utf8')
  const paths = [
    '.github/workflows/deploy.yml', '.GitHub/Workflows/x.yml', 'src/App.tsx', 'src/lib/forgeTools.ts', 'src/lib/guardianGate.ts',
    'package.json', 'apps/web/package.json', 'package-lock.json', 'vite.config.ts', 'sub/vite.config.mjs', 'eslint.config.js',
    'tsconfig.app.json', 'tsconfig.json', 'engine/server.ts', 'foundation/x/y.md', 'LICENSE', 'LICENSE.md', 'docs/readme.md',
    'src/lib/elapsed.ts', '../etc/passwd', './src/App.tsx', 'src//lib//a.ts', 'scripts/x.sh', 'src/scripts/workflowHardening.test.ts',
    '.gitattributes', 'a/.gitmodules', 'tests/foundation/a.test.ts', 'docs/brand/forgeclaw-avatar.png',
  ]
  it('gives the same answer for every path', () => {
    const py = spawnSync('python3', ['-c', [
      'import sys, json; sys.path.insert(0, ".github/scripts")',
      'import importlib.util as u; s = u.spec_from_file_location("cp", ".github/scripts/check-protected.py"); m = u.module_from_spec(s); s.loader.exec_module(m)',
      'entries = m.load(".github/protected-paths.txt"); paths = json.loads(sys.stdin.read())',
      'print(json.dumps([m.is_protected(p, entries) for p in paths]))',
    ].join('\n')], { input: JSON.stringify(paths), encoding: 'utf8' })
    expect(py.status, py.stderr).toBe(0)
    const expected = JSON.parse(py.stdout) as boolean[]
    const entries = parseProtectedList(list)
    expect(paths.map(p => isProtectedPath(p, entries))).toEqual(expected)
  })
})
