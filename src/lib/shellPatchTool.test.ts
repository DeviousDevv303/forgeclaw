// @vitest-environment node
// shell_patch wraps shell-repair.yml. These tests pin the properties the audit made load-bearing:
// the tool (not the model) names the branch, the dispatch is gated under every posture, rollback
// is journaled like sculpt_self, and a dispatch is never reported as a verified change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, FORGE_TOOLS, type ToolContext } from './forgeTools'
import { requiresCoSign } from './guardianGate'
import { CODING_TOOL_ORDER, toolsForCapability } from './managedAgent'
import { createRunJournal } from './runRollback'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const PATCH = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-a\n+b\n'

function ctxWith(journal: ReturnType<typeof createRunJournal>): ToolContext {
  return { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true, journal, sculptUnlocked: true }
}
const call = (input: Record<string, unknown>) => ({ id: '1', name: 'shell_patch', input })

describe('shell_patch', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('dispatches shell-repair.yml with a tool-generated branch and invocation id', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? new Response(null, { status: 204 }) : json({ url }, 404))
    vi.stubGlobal('fetch', fetchMock)
    // wait:false is dispatch-only and must say so; the default waits (tests below).
    const out = await executeTool(call({ patch: PATCH, reason: 'fix typo', wait: false }), ctxWith(createRunJournal()))
    const dispatch = fetchMock.mock.calls.find(([url]) => String(url).includes('/shell-repair.yml/dispatches'))!
    const body = JSON.parse((dispatch[1] as RequestInit).body as string)
    expect(body.ref).toBe('main')
    expect(body.inputs.repair_branch).toBe(`forge/repair/${body.inputs.invocation_id}`)
    // Must satisfy the workflow's own input validation.
    expect(body.inputs.repair_branch).toMatch(/^forge\/repair\/[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/)
    expect(body.inputs.invocation_id).toMatch(/^[A-Za-z0-9._:-]{1,120}$/)
    expect(body.inputs.patch).toBe(PATCH)
    expect(out).toContain('NOT VERIFIED')
    expect(out).toContain(body.inputs.invocation_id)
  })

  it('refuses a model-supplied branch or invocation id and dispatches nothing', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    for (const extra of [{ repair_branch: 'forge/repair/mine' }, { branch: 'main' }, { invocation_id: 'x' }]) {
      const out = await executeTool(call({ patch: PATCH, reason: 'r', ...extra }), ctxWith(createRunJournal()))
      expect(out).toMatch(/TOOL ERROR/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates the patch and reason before any network call', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const symlinkPatch = 'diff --git a/l b/l\nnew file mode 120000\n--- /dev/null\n+++ b/l\n@@ -0,0 +1 @@\n+/etc/passwd\n'
    const bad: Array<Record<string, unknown>> = [
      { patch: '', reason: 'r' },
      { patch: PATCH, reason: '' },
      { patch: 'just some prose, not a diff', reason: 'r' },
      { patch: PATCH + 'x'.repeat(60_001), reason: 'r' },
      { patch: PATCH, reason: 'two\nlines' },
      { patch: PATCH, reason: 'x'.repeat(241) },
      { patch: symlinkPatch, reason: 'r' },
    ]
    for (const input of bad) expect(await executeTool(call(input), ctxWith(createRunJournal())), JSON.stringify(input).slice(0, 60)).toMatch(/TOOL ERROR/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records the dispatch by invocation id and marks the new branch as deletable (sculpt_self pattern)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/git/ref/heads/') ? json({}, 404) : new Response(null, { status: 204 })))
    const journal = createRunJournal()
    await executeTool(call({ patch: PATCH, reason: 'r' }), ctxWith(journal))
    const entries = journal.entries()
    expect(entries.map(e => e.kind)).toEqual(['workflow_dispatch', 'branch_created'])
    expect(entries[0]).toMatchObject({ workflow: 'shell-repair.yml' })
    const branch = (entries[1] as { branch: string }).branch
    expect(branch.startsWith('forge/repair/')).toBe(true)
    expect((entries[0] as { needle: string }).needle).toBe(branch.replace('forge/repair/', ''))
  })

  it('never marks a pre-existing branch as deletable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/git/ref/heads/') ? json({ object: { sha: 'd'.repeat(40) } }) : new Response(null, { status: 204 })))
    const journal = createRunJournal()
    await executeTool(call({ patch: PATCH, reason: 'r' }), ctxWith(journal))
    expect(journal.entries().map(e => e.kind)).toEqual(['workflow_dispatch'])
  })

  it('records nothing when the dispatch is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/git/ref/heads/') ? json({}, 404) : json({ message: 'no' }, 422)))
    const journal = createRunJournal()
    const out = await executeTool(call({ patch: PATCH, reason: 'r' }), ctxWith(journal))
    expect(out).toMatch(/TOOL ERROR/)
    expect(journal.entries()).toEqual([])
  })
})

describe('shell_patch gating and exposure', () => {
  it('requires co-sign under the default and full postures, so it is no looser than github_run_workflow', () => {
    const c = call({ patch: PATCH, reason: 'r' })
    expect(requiresCoSign(c, 'operator-shell')).toBe(true)
    expect(requiresCoSign(c, 'full-cosign')).toBe(true)
    expect(requiresCoSign({ id: '1', name: 'github_run_workflow', input: {} }, 'operator-shell')).toBe(true)
  })

  // 2026-10-20, Cristian Nunez: "self sculpt 100% operational via deepseek shell commands and all providers".
  // shell_patch and sculpt_self are now granted to the write-capable coding capability; they stay out of
  // read-only agents, still need co-sign under every posture but 'autonomous', and only ever open a PR.
  it('is granted to the coding capability only, never to read-only agents', () => {
    expect(FORGE_TOOLS.some(t => t.name === 'shell_patch')).toBe(true)
    for (const name of ['shell_patch', 'sculpt_self']) {
      expect(CODING_TOOL_ORDER).toContain(name)
      expect(toolsForCapability('coding', FORGE_TOOLS).map(t => t.name)).toContain(name)
      expect(toolsForCapability('coding-readonly', FORGE_TOOLS).map(t => t.name)).not.toContain(name)
      expect(requiresCoSign({ id: '1', name, input: {} }, 'operator-shell')).toBe(true)
    }
  })

  describe('waits for the run and reports what really happened', () => {
    function github(conclusion: string, prs: unknown[]) {
      let dispatched: { inputs: { invocation_id: string } } | undefined
      let polls = 0
      return vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/dispatches')) { dispatched = JSON.parse(String(init!.body)); return new Response(null, { status: 204 }) }
        if (String(url).includes('/git/ref/heads/')) return json({}, 404)
        const run = (status: string) => ({ id: 5, run_number: 42, name: 'Shell repair', display_title: `Shell repair ${dispatched?.inputs.invocation_id}`, event: 'workflow_dispatch', head_branch: 'main', status, conclusion: status === 'completed' ? conclusion : null, created_at: new Date().toISOString(), html_url: 'https://github.com/o/r/actions/runs/5' })
        if (String(url).includes('/shell-repair.yml/runs')) return json({ workflow_runs: [run('in_progress')] })
        if (String(url).endsWith('/actions/runs/5')) return json(run(++polls > 1 ? 'completed' : 'in_progress'))
        if (String(url).includes('/pulls?head=')) return json(prs)
        return json({}, 404)
      })
    }
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })
    // The tool polls every few seconds; drive the fake clock until it settles.
    async function settle(promise: Promise<string>): Promise<string> {
      for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(5_000)
      return promise
    }

    it('returns the pull request the run opened', async () => {
      vi.stubGlobal('fetch', github('success', [{ number: 77, html_url: 'https://github.com/o/r/pull/77' }]))
      const out = await settle(executeTool(call({ patch: PATCH, reason: 'fix typo' }), ctxWith(createRunJournal())))
      expect(out).toMatch(/^✓ Shell-patch .*: build-validated and proposed as pull request #77/)
      expect(out).toContain('pr: https://github.com/o/r/pull/77')
      expect(out).toContain('(not merged; review it)')
    })

    it('says which step failed and that nothing was pushed, from GitHub, not a guess', async () => {
      const base = github('failure', [])
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/actions/runs/5/jobs')) return json({ jobs: [{ steps: [
          { name: 'Set up job', conclusion: 'success' }, { name: 'Apply patch', conclusion: 'success' },
          { name: 'Commit and push repair branch', conclusion: 'success' }, { name: 'Create labeled pull request', conclusion: 'failure' },
        ] }] })
        return base(url, init)
      }))
      const out = await settle(executeTool(call({ patch: PATCH, reason: 'fix typo' }), ctxWith(createRunJournal())))
      expect(out).toContain('failed at the step "Create labeled pull request"')
      expect(out).toContain('Apply patch; Commit and push repair branch')
      expect(out).toMatch(/Branch forge\/repair\/\S+ on GitHub: NOT FOUND, so nothing was persisted/)
      expect(out).toContain('github_get_run_logs')
      expect(out).not.toContain('nothing was proposed (protected path')
    })

    it('reports a failing run as a failure with its logs, never as a proposal', async () => {
      vi.stubGlobal('fetch', github('failure', []))
      const out = await settle(executeTool(call({ patch: PATCH, reason: 'fix typo' }), ctxWith(createRunJournal())))
      expect(out).toMatch(/^\[TOOL ERROR\] Shell-patch .* run #42 concluded "failure": nothing was proposed/)
      expect(out).toContain('Logs: https://github.com/o/r/actions/runs/5')
    })
  })
})

