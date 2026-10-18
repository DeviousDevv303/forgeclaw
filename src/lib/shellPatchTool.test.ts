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
  return { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true, journal }
}
const call = (input: Record<string, unknown>) => ({ id: '1', name: 'shell_patch', input })

describe('shell_patch', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('dispatches shell-repair.yml with a tool-generated branch and invocation id', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? new Response(null, { status: 204 }) : json({ url }, 404))
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool(call({ patch: PATCH, reason: 'fix typo' }), ctxWith(createRunJournal()))
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

  it('is exposed as a tool but granted to no coding capability', () => {
    expect(FORGE_TOOLS.some(t => t.name === 'shell_patch')).toBe(true)
    expect(CODING_TOOL_ORDER).not.toContain('shell_patch')
    for (const capability of ['coding-readonly', 'coding'] as const) {
      expect(toolsForCapability(capability, FORGE_TOOLS).map(t => t.name)).not.toContain('shell_patch')
    }
  })
})
