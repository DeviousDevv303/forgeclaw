// @vitest-environment node
// Proves the real write tools record how to undo themselves, so STOP can roll a run back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'
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

function ctxWith(journal: ReturnType<typeof createRunJournal>): ToolContext {
  return { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'operator', requestGuardianApproval: async () => true, journal, sculptUnlocked: true }
}

describe('write tools record rollback information', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('github_write_file on a branch records the head before and the commit it wrote', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/git/ref/heads/feat/a')) return json({ object: { sha: 'b'.repeat(40) } })
      if (init?.method === 'PUT') return json({ commit: { sha: 'a'.repeat(40), html_url: 'u' }, content: {} })
      return json({}, 404) // file does not exist yet
    }))
    const journal = createRunJournal()
    const out = await executeTool({ id: '1', name: 'github_write_file', input: { path: 'docs/x.md', content: 'x', message: 'docs: x', branch: 'feat/a' } }, ctxWith(journal))
    expect(out).toContain('Created docs/x.md')
    expect(journal.entries()).toEqual([expect.objectContaining({ kind: 'branch_advanced', branch: 'feat/a', beforeSha: 'b'.repeat(40), afterSha: 'a'.repeat(40) })])
  })

  it('github_write_file without a branch is journaled as irreversible, never as an automatic undo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? json({ commit: { sha: 'c'.repeat(40) } }) : json({}, 404)))
    const journal = createRunJournal()
    await executeTool({ id: '1', name: 'github_write_file', input: { path: 'docs/x.md', content: 'x', message: 'docs: x' } }, ctxWith(journal))
    expect(journal.entries()).toEqual([expect.objectContaining({ kind: 'irreversible' })])
    expect(JSON.stringify(journal.entries())).toContain('default branch')
  })

  it('github_run_workflow records the dispatched workflow', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const journal = createRunJournal()
    await executeTool({ id: '1', name: 'github_run_workflow', input: { workflow: 'build-gate.yml' } }, ctxWith(journal))
    expect(journal.entries()).toEqual([expect.objectContaining({ kind: 'workflow_dispatch', workflow: 'build-gate.yml' })])
  })

  it('sculpt_self records the dispatch by branch name and marks a new branch as deletable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/git/ref/heads/') ? json({}, 404) : new Response(null, { status: 204 })))
    const journal = createRunJournal()
    await executeTool({ id: '1', name: 'sculpt_self', input: { file_path: 'src/lib/x.ts', content: 'export {}', reason: 'test', branch: 'sculpt/x' } }, ctxWith(journal))
    expect(journal.entries()).toEqual([
      expect.objectContaining({ kind: 'workflow_dispatch', workflow: 'self-sculpt.yml', needle: 'sculpt/x' }),
      expect.objectContaining({ kind: 'branch_created', branch: 'sculpt/x' }),
    ])
  })

  it('sculpt_self never marks a pre-existing branch as deletable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/git/ref/heads/') ? json({ object: { sha: 'd'.repeat(40) } }) : new Response(null, { status: 204 })))
    const journal = createRunJournal()
    await executeTool({ id: '1', name: 'sculpt_self', input: { file_path: 'src/lib/x.ts', content: 'export {}', reason: 'test', branch: 'sculpt/x' } }, ctxWith(journal))
    expect(journal.entries().map(e => e.kind)).toEqual(['workflow_dispatch'])
  })

  it('a failed write records nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? json({ message: 'nope' }, 422) : json({}, 404)))
    const journal = createRunJournal()
    const out = await executeTool({ id: '1', name: 'github_write_file', input: { path: 'docs/x.md', content: 'x', message: 'docs: x', branch: 'feat/a' } }, ctxWith(journal))
    expect(out).toMatch(/TOOL ERROR/)
    expect(journal.entries()).toEqual([])
  })
})
