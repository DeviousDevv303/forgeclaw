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

interface Run { name: string; status: string; conclusion: string | null }
interface World {
  pull?: Partial<Record<string, unknown>>; files?: string[]; policy?: string | null; mergeStatus?: number
  /** Checks as a function of how many times they have been read for that head (so a run can finish while we wait). */
  checks?: (head: string, reads: number) => Run[]
  /** Pull request state as a function of the number of reads (so "behind" can change after an update). */
  pullAt?: (reads: number, updated: boolean) => Partial<Record<string, unknown>>
  updateStatus?: number
}
const GREEN_RUN: Run[] = [{ name: 'build', status: 'completed', conclusion: 'success' }]
function github(w: World = {}) {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  const files = w.files ?? ['src/lib/elapsed.ts']
  const reads: Record<string, number> = {}
  let pullReads = 0
  let updated = false
  let clock = 0
  const request = async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (/\/pulls\/\d+\/update-branch$/.test(url)) { if ((w.updateStatus ?? 202) >= 300) return json({ message: 'merge conflict between base and head' }, w.updateStatus); updated = true; return json({ message: 'Updating pull request branch.' }, 202) }
    if (/\/pulls\/\d+\/merge$/.test(url)) return json(w.mergeStatus === 405 ? { message: 'Pull Request is not mergeable' } : { merged: true, sha: 'abcdef1234567' }, w.mergeStatus ?? 200)
    if (/\/pulls\/\d+\/files/.test(url)) return json(files.map(filename => ({ filename })))
    if (/\/pulls\/\d+$/.test(url)) {
      pullReads++
      return json({ number: 7, title: 'Tidy elapsed', state: 'open', draft: false, mergeable: true, mergeable_state: 'clean', changed_files: files.length, head: { sha: updated ? 'newhead9876543' : 'headsha1234567' }, base: { ref: 'main', repo: { default_branch: 'main' } }, ...w.pull, ...w.pullAt?.(pullReads, updated) })
    }
    if (url.includes('/contents/.github/protected-paths.txt')) return w.policy === null ? json({}, 404) : json({ content: b64(w.policy ?? POLICY), encoding: 'base64' })
    if (url.includes('/check-runs')) {
      const sha = /commits\/([^/]+)\/check-runs/.exec(url)![1]
      reads[sha] = (reads[sha] ?? 0) + 1
      return json({ total_count: 1, check_runs: (w.checks ?? (() => GREEN_RUN))(sha, reads[sha]) })
    }
    return json({}, 404)
  }
  // A fake clock: sleeping advances it, so waiting for a run costs no real time.
  const timing = { sleep: async (ms: number) => { clock += ms }, now: () => clock, watchMainMs: 60_000 }
  return { request, calls, timing }
}
const base = { owner: 'o', repo: 'r', token: 't', pullNumber: 7 }

describe('mergePullRequest', () => {
  it('merges a green pull request, pinned to the head it checked, and reports main afterwards', async () => {
    const g = github()
    const out = await mergePullRequest(g.request, { ...base, ...g.timing })
    expect(out).toMatch(/^✓ Merged pull request #7 "Tidy elapsed" into main \(squash\) as abcdef1/)
    expect(out).toContain('On main all finished green: build')
    expect(g.calls.find(c => c.method === 'PUT' && c.url.endsWith('/merge'))!.body).toEqual({ merge_method: 'squash', sha: 'headsha1234567' })
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
    ['no checks at all (after the grace period)', { checks: () => [] }, /No checks ran/],
    ['a failing check', { checks: () => [{ name: 'build', status: 'completed', conclusion: 'failure' }] }, /Checks failed.*build \(failure\)/],
    ['a refusal from GitHub', { mergeStatus: 405 }, /GitHub refused the merge.*405/],
    ['a pull request GitHub reports blocked (required review)', { pull: { mergeable_state: 'blocked' } }, /reports pull request #7 as blocked/],
  ]
  for (const [name, world, message] of refusals) {
    it(`refuses ${name}, and merges nothing`, async () => {
      const g = github(world)
      await expect(mergePullRequest(g.request, { ...base, ...g.timing })).rejects.toThrow(message)
      if (!world.mergeStatus) expect(g.calls.some(c => c.url.endsWith('/merge'))).toBe(false)
    })
  }
  it('refuses a pull request that moved since it was reviewed', async () => {
    const g = github()
    await expect(mergePullRequest(g.request, { ...base, ...g.timing, expectedHeadSha: 'oldsha0000000' })).rejects.toThrow(/changed since it was reviewed/)
    expect(g.calls.some(c => c.url.endsWith('/merge'))).toBe(false)
  })
  it('checks the old name of a renamed file too', async () => {
    const g = github()
    const request = async (url: string, init?: RequestInit) => /\/pulls\/7\/files/.test(url) ? json([{ filename: 'docs/x.md', previous_filename: '.github/workflows/y.yml' }]) : g.request(url, init)
    await expect(mergePullRequest(request, { ...base, ...g.timing })).rejects.toThrow(/protected paths/)
  })

  it('waits for a run that is still going, then merges once it finishes green', async () => {
    const g = github({ checks: (_h, reads) => reads < 4 ? [{ name: 'build', status: 'in_progress', conclusion: null }] : GREEN_RUN })
    const out = await mergePullRequest(g.request, { ...base, ...g.timing })
    expect(out).toContain('✓ Merged pull request #7')
    expect(g.calls.filter(c => c.url.includes('/commits/headsha1234567/check-runs')).length).toBeGreaterThanOrEqual(4)
    expect(g.calls.filter(c => c.url.endsWith('/merge')).length).toBe(1)
  })
  it('gives up with a clear message when the run never finishes, merging nothing', async () => {
    const g = github({ checks: () => [{ name: 'build', status: 'in_progress', conclusion: null }] })
    await expect(mergePullRequest(g.request, { ...base, ...g.timing, maxWaitMs: 120_000 })).rejects.toThrow(/had not finished after 2 minutes \(build\)/)
    expect(g.calls.some(c => c.url.endsWith('/merge'))).toBe(false)
  })
  it('refuses at once when a check fails while others are still running', async () => {
    const g = github({ checks: () => [{ name: 'lint', status: 'completed', conclusion: 'failure' }, { name: 'build', status: 'in_progress', conclusion: null }] })
    await expect(mergePullRequest(g.request, { ...base, ...g.timing })).rejects.toThrow(/lint \(failure\)/)
  })
  it('gives checks a moment to start before saying none ran', async () => {
    const g = github({ checks: (_h, reads) => reads < 3 ? [] : GREEN_RUN })
    await expect(mergePullRequest(g.request, { ...base, ...g.timing })).resolves.toContain('✓ Merged')
  })

  it('updates a branch that is behind, waits for the checks on the NEW head, and merges pinned to it', async () => {
    const g = github({
      pullAt: (_r, updated) => ({ mergeable_state: updated ? 'clean' : 'behind' }),
      checks: (head, reads) => head === 'newhead9876543' ? (reads < 3 ? [{ name: 'build', status: 'in_progress', conclusion: null }] : GREEN_RUN) : GREEN_RUN,
    })
    const out = await mergePullRequest(g.request, { ...base, ...g.timing, expectedHeadSha: 'headsha1234567' })
    expect(g.calls.find(c => c.url.endsWith('/update-branch'))!.body).toEqual({ expected_head_sha: 'headsha1234567' })
    expect(g.calls.find(c => c.url.endsWith('/merge'))!.body).toEqual({ merge_method: 'squash', sha: 'newhead9876543' })
    expect(out).toContain('updated the branch from main')
    // The old head's checks are never what authorises the merge.
    expect(g.calls.some(c => c.url.includes('/commits/headsha1234567/check-runs'))).toBe(false)
  })
  it('stops when GitHub will not update a branch that is behind', async () => {
    const g = github({ pull: { mergeable_state: 'behind' }, updateStatus: 422 })
    await expect(mergePullRequest(g.request, { ...base, ...g.timing })).rejects.toThrow(/behind main and GitHub would not update it: 422/)
    expect(g.calls.some(c => c.url.endsWith('/merge'))).toBe(false)
  })
  it('warns when the default branch\'s own checks fail after the merge', async () => {
    const g = github({ checks: head => head === 'abcdef1234567' ? [{ name: 'Deploy', status: 'completed', conclusion: 'failure' }] : GREEN_RUN })
    const out = await mergePullRequest(g.request, { ...base, ...g.timing })
    expect(out).toContain('✓ Merged')
    expect(out).toContain('⚠ On main these FAILED after the merge: Deploy (failure)')
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
