// @vitest-environment node
// ─── F-032 regression: persistence claims must match the artifact ─────────────
// Pass 41 confirmed headlessly that memory_write returned `✓ Stored …` while a
// following memory_read found nothing, and coding_task_update returned
// `✓ Coding agent state persisted — …` while the reloaded state carried no
// update — both claims rode safeSetItem, which swallows storage failures.
// These tests drive the real dispatcher against (a) throwing storage,
// (b) silently-dropping storage (a setItem that "succeeds" without storing —
// only read-back can catch it), and (c) healthy storage.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, loadToolContext } from './forgeTools'
import { loadCodingAgentState } from './codingAgentState'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

/** Quota/private-mode storage: setItem throws, reads still work. */
class ThrowingStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException('quota exceeded', 'QuotaExceededError')
  }
}

/** Pathological storage: setItem returns normally but stores nothing. */
class DroppingStorage extends MemoryStorage {
  override setItem(): void { /* silently drops the write */ }
}

function install(storage: Storage) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

const ctx = () => ({ ...loadToolContext(), ghToken: '', guardianPosture: 'autonomous' as const })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('F-032 memory_write claim', () => {
  it('reports a visible failure — not "Stored" — when storage throws', async () => {
    install(new ThrowingStorage())
    const out = await executeTool(
      { id: 'f032-1', name: 'memory_write', input: { key: 'blade_note', value: 'remember this' } },
      ctx(),
    )
    expect(out).not.toContain('✓ Stored')
    expect(out).toContain('NOT stored')
    // The artifact agrees: nothing is there to read back.
    const read = await executeTool({ id: 'f032-2', name: 'memory_read', input: { key: 'blade_note' } }, ctx())
    expect(read).toBe('(no value stored for key "blade_note")')
  })

  it('reports a visible failure when storage silently drops the write (read-back catches it)', async () => {
    install(new DroppingStorage())
    const out = await executeTool(
      { id: 'f032-3', name: 'memory_write', input: { key: 'blade_note', value: 'remember this' } },
      ctx(),
    )
    expect(out).not.toContain('✓ Stored')
    expect(out).toContain('NOT stored')
  })

  it('claims Stored only when the value is verifiably persisted', async () => {
    install(new MemoryStorage())
    const out = await executeTool(
      { id: 'f032-4', name: 'memory_write', input: { key: 'blade_note', value: 'remember this' } },
      ctx(),
    )
    expect(out).toBe('✓ Stored "blade_note" in memory.')
    const read = await executeTool({ id: 'f032-5', name: 'memory_read', input: { key: 'blade_note' } }, ctx())
    expect(read).toBe('remember this')
  })
})

describe('F-032 coding_task_update claim', () => {
  const update = {
    task: 'f032 probe task',
    status: 'in_progress',
    owner: 'DeviousDevv303',
    repo: 'forgeclaw',
    branch: 'main',
    head_sha: 'f98e02b1da16',
  }

  it('reports a visible failure — not "persisted" — when storage throws', async () => {
    install(new ThrowingStorage())
    const out = await executeTool({ id: 'f032-6', name: 'coding_task_update', input: update }, ctx())
    expect(out).not.toContain('✓ Coding agent state persisted')
    expect(out).toContain('NOT persisted')
    // The artifact agrees: a fresh load carries no trace of the update.
    const loaded = loadCodingAgentState()
    expect(loaded.task).not.toBe('f032 probe task')
  })

  it('claims persisted only when a fresh load carries the update (resume-after-reload)', async () => {
    install(new MemoryStorage())
    const out = await executeTool({ id: 'f032-7', name: 'coding_task_update', input: update }, ctx())
    expect(out).toContain('✓ Coding agent state persisted')
    const loaded = loadCodingAgentState()
    expect(loaded.task).toBe('f032 probe task')
    expect(loaded.taskStatus).toBe('in_progress')
    expect(loaded.headSha).toBe('f98e02b1da16')
  })
})
