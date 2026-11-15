// @vitest-environment node
// spawn_agent is the in-house swarm's entry point. Its handler cast system_prompt, task and tools with no check, so a
// malformed spawn (the Nexus checkpoint is a 4.48M-parameter model that can emit one) started a child on `undefined`,
// or died in `toolsStr.split is not a function` with an illegible error. The check is refusal-only: every spawn that
// worked before still works, and the argument shapes it refuses are ones that could only produce garbage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSpawnAgentArgs } from './spawnAgentArgCheck'
import { executeTool, type ToolContext } from './forgeTools'

describe('checkSpawnAgentArgs: refuses only what cannot work', () => {
  it.each([
    ['missing task', { system_prompt: 'You search.' }, /task/],
    ['empty task', { system_prompt: 'You search.', task: '' }, /task/],
    ['blank task', { system_prompt: 'You search.', task: '   \n ' }, /task/],
    ['non-text task', { system_prompt: 'You search.', task: { find: 'x' } }, /task/],
    ['missing system_prompt', { task: 'Find the file.' }, /system_prompt/],
    ['non-text system_prompt', { system_prompt: 42, task: 'Find the file.' }, /system_prompt/],
    ['tools as an array', { system_prompt: 'r', task: 't', tools: ['shell_exec', 'web_search'] }, /tools/],
    ['tools as an object', { system_prompt: 'r', task: 't', tools: { a: 1 } }, /tools/],
    ['tools as a number', { system_prompt: 'r', task: 't', tools: 3 }, /tools/],
  ])('refuses %s, naming the field', (_label, input, field) => {
    expect(checkSpawnAgentArgs(input as Record<string, unknown>)).toMatch(field)
  })

  it('reports every bad field in one message (the Nexus loop has 3 calls) and stays inside the 1,200-char window', () => {
    const out = checkSpawnAgentArgs({ tools: ['x'] })!
    for (const f of ['task', 'system_prompt', 'tools']) expect(out).toContain(f)
    expect(out.length).toBeLessThan(1200)
  })

  it.each([
    { system_prompt: 'You find files.', task: 'Find checkUnifiedDiff.' },
    { system_prompt: 'You find files.', task: 'Find checkUnifiedDiff.', tools: 'shell_exec' },
    { system_prompt: 'You find files.', task: 'Find it.', tools: 'shell_exec, github_search_code ,' },
    { system_prompt: '', task: 'Find it.' }, // a blank role works today
    { system_prompt: 'r', task: 't', tools: '' }, // empty means "all tools", as before
    { system_prompt: 'r', task: 't', tools: undefined },
    { system_prompt: 'r', task: 't', tools: null },
    { system_prompt: 'r', task: 't', tools: 'none' }, // names nothing real; works today as a child with no tools
    { system_prompt: 'r', task: 't', tools: 'shell_exec,nexus_reason' }, // a formation error to grade, not a refusal
  ])('accepts %j (unchanged)', (input) => {
    expect(checkSpawnAgentArgs(input as Record<string, unknown>)).toBeNull()
  })
})

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('spawn_agent through executeTool', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  const make = () => {
    const spawnAgent = vi.fn(async (_system: string, task: string) => `child done: ${task}`)
    const ctx: ToolContext = { ghToken: 't', ghOwner: 'o', ghRepo: 'r', actor: 'agent', requestGuardianApproval: async () => true, spawnAgent }
    return { spawnAgent, ctx }
  }

  it('a malformed spawn is refused as a [TOOL ERROR] and no child starts', async () => {
    const { spawnAgent, ctx } = make()
    const out = await executeTool({ id: '1', name: 'spawn_agent', input: { system_prompt: 'r', tools: ['x'] } }, ctx)
    expect(out).toMatch(/^\[TOOL ERROR\].*task/)
    expect(out).toContain('tools')
    expect(spawnAgent).not.toHaveBeenCalled()
  })

  it('a valid spawn still starts the child with the same arguments and returns its text', async () => {
    const { spawnAgent, ctx } = make()
    const out = await executeTool({ id: '1', name: 'spawn_agent', input: { system_prompt: 'You find files.', task: 'Find it.', tools: ' shell_exec , github_search_code ' } }, ctx)
    expect(spawnAgent).toHaveBeenCalledTimes(1)
    expect(spawnAgent).toHaveBeenCalledWith('You find files.', 'Find it.', ['shell_exec', 'github_search_code'])
    expect(out).toBe('child done: Find it.')
  })

  it('an omitted tools string still means all tools (undefined), as before', async () => {
    const { spawnAgent, ctx } = make()
    await executeTool({ id: '1', name: 'spawn_agent', input: { system_prompt: 'r', task: 't' } }, ctx)
    expect(spawnAgent).toHaveBeenCalledWith('r', 't', undefined)
  })
})
