// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
import { describe, expect, it, vi } from 'vitest'
import { FORGE_TOOLS } from './forgeTools'
import { formatSwarm, parseSwarmCommand, parseSwarmPlan, SWARM_CHILD_TOOLS, SWARM_NEEDS_KEY_NOTICE } from './swarm'
import { runSwarmRequest, type SwarmRequestDeps } from './swarmRunner'

const plan = (agents: unknown[]) => JSON.stringify({ agents })
const A = { role: 'Builder reader', task: 'Read src/lib/forgeTools.ts and report where the warning text is built.', tools: ['github_read_file'] }
const B = { role: 'UI reader', task: 'Read src/App.tsx and report where the warning text is shown.', tools: ['github_read_file', 'shell_exec'] }

describe('/swarm command', () => {
  it('parses a task, gives usage for none, and ignores other text', () => {
    expect(parseSwarmCommand('/swarm find how the warning travels')).toEqual({ kind: 'run', task: 'find how the warning travels' })
    expect(parseSwarmCommand('/swarm')).toMatchObject({ kind: 'usage' })
    expect(parseSwarmCommand('/swarm hi')).toMatchObject({ kind: 'usage' })
    expect(parseSwarmCommand('show me the swarm')).toBeNull()
    expect(parseSwarmCommand('/swarmy thing to do here')).toBeNull()
  })
})

describe('the plan', () => {
  it('child tools are real tools, read-only by name, and never spawn, write, shell, fetch or funds', () => {
    const names = new Set(FORGE_TOOLS.map(t => t.name))
    for (const t of SWARM_CHILD_TOOLS) expect(names.has(t), t).toBe(true)
    expect(SWARM_CHILD_TOOLS.filter(t => /spawn|write|patch|sculpt|shell|run_|http_fetch|funds|send|create|merge|publish|memory_write|generate/.test(t))).toEqual([])
  })
  it('keeps allowed tools and drops, by name, any tool outside the read-only list', () => {
    const p = parseSwarmPlan(plan([A, B]))
    expect(p).toMatchObject({ ok: true })
    if (!p.ok) return
    expect(p.agents[1].tools).toEqual(['github_read_file'])
    expect(p.agents[1].droppedTools).toEqual(['shell_exec'])
  })
  it('accepts JSON inside a code fence or prose', () => {
    expect(parseSwarmPlan('Here you go:\n```json\n' + plan([A, B]) + '\n```').ok).toBe(true)
  })
  it('refuses, with the reason, a plan that is not JSON, has one agent, too many, a duplicate task or an empty task', () => {
    expect(parseSwarmPlan('I would split it in two.')).toEqual({ ok: false, reason: 'the planner did not return JSON' })
    expect(parseSwarmPlan('{"agents": [')).toMatchObject({ ok: false })
    expect(parseSwarmPlan(plan([A]))).toMatchObject({ ok: false, reason: expect.stringMatching(/at least 2/) })
    expect(parseSwarmPlan(plan([A, B, { ...A, task: A.task + ' 3' }, { ...A, task: A.task + ' 4' }, { ...A, task: A.task + ' 5' }]))).toMatchObject({ ok: false, reason: expect.stringMatching(/limit is 4/) })
    expect(parseSwarmPlan(plan([A, { ...B, task: A.task.toUpperCase() }]))).toMatchObject({ ok: false, reason: expect.stringMatching(/same task/) })
    expect(parseSwarmPlan(plan([A, { role: 'x', task: '' }]))).toMatchObject({ ok: false, reason: expect.stringMatching(/no usable task/) })
  })
})

function deps(over: Partial<SwarmRequestDeps> = {}): SwarmRequestDeps {
  return {
    active: 'nexus-intelligence', keys: { moonshot: 'sk-test' }, models: { moonshot: 'kimi-k2.6' }, allTools: FORGE_TOOLS, toolCtx: { spawnAgent: async () => 'nested' } as never,
    callProviderFn: vi.fn(async (_p, _m, system: string) => ({ text: system.includes('split one task') ? plan([A, B]) : 'The warning is built in forgeTools (agent 1) and shown in App (agent 2).' })) as never,
    runSubAgentFn: vi.fn(async (_s: string, task: string) => `report for: ${task.slice(0, 30)}`) as never,
    ...over,
  }
}

describe('running a swarm', () => {
  it('with no hosted key nothing runs, and the notice says Nexus was not asked', async () => {
    const d = deps({ keys: {} })
    expect(await runSwarmRequest('task text here', d)).toEqual({ ok: false, text: SWARM_NEEDS_KEY_NOTICE })
    expect(d.callProviderFn).not.toHaveBeenCalled()
    expect(d.runSubAgentFn).not.toHaveBeenCalled()
  })
  it('plans once, runs each agent with only its granted read-only tools and no way to spawn, then combines', async () => {
    const events: string[] = []
    const d = deps({ onAgent: e => events.push(`${e.phase}${e.index}:${e.provider}`) })
    const r = await runSwarmRequest('find how the warning travels', d)
    expect(r.ok).toBe(true)
    expect(r).toMatchObject({ provider: 'moonshot', model: 'kimi-k2.6' })
    expect(d.callProviderFn).toHaveBeenCalledTimes(2)
    const calls = (d.runSubAgentFn as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls.map(c => c[2])).toEqual([['github_read_file'], ['github_read_file']])
    expect(calls.map(c => c[3])).toEqual(['moonshot', 'moonshot'])
    for (const c of calls) expect((c[7] as { spawnAgent?: unknown }).spawnAgent).toBeUndefined()
    expect(events.sort()).toEqual(['end0:moonshot', 'end1:moonshot', 'start0:moonshot', 'start1:moonshot'])
    expect(r.text).toContain('Swarm: 2 of 2 agents returned.')
    expect(r.text).toContain('The Nexus checkpoint did not form this swarm and was not asked.')
    expect(r.text).toContain('(not granted: shell_exec)')
    expect(r.text).toContain('Combined answer:')
  })
  it('an unusable plan starts no agent and says why', async () => {
    const d = deps({ callProviderFn: vi.fn(async () => ({ text: 'Sure, I will look into it.' })) as never })
    const r = await runSwarmRequest('find how the warning travels', d)
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/No swarm was run: the planner did not return JSON\..*no agent was started/)
    expect(d.runSubAgentFn).not.toHaveBeenCalled()
  })
  it('one failed agent does not take the other down; the reply shows both and is marked incomplete', async () => {
    const d = deps({ runSubAgentFn: vi.fn(async (_s: string, task: string) => { if (task.includes('App.tsx')) throw new Error('GitHub 404'); return 'built at forgeTools.ts:2243' }) as never })
    const r = await runSwarmRequest('find how the warning travels', d)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('Swarm: 1 of 2 agents returned.')
    expect(r.text).toMatch(/Agent 2 · UI reader · FAILED[\s\S]*error: GitHub 404/)
    expect(r.text).toContain('Combined answer:')
    // The combining step is told which agent failed.
    const synthesisInput = (d.callProviderFn as unknown as ReturnType<typeof vi.fn>).mock.calls[1][3][0].content as string
    expect(synthesisInput).toMatch(/Agent 2 \(UI reader\) — FAILED/)
  })
  it('when every agent fails there is no combining call and no combined answer', async () => {
    const d = deps({ runSubAgentFn: vi.fn(async () => { throw new Error('rate limited') }) as never })
    const r = await runSwarmRequest('find how the warning travels', d)
    expect(r.ok).toBe(false)
    expect(d.callProviderFn).toHaveBeenCalledTimes(1)
    expect(r.text).toContain('No combined answer: no agent returned a report.')
  })
  it('a failed combining step still shows the agents\' reports', async () => {
    const d = deps({ callProviderFn: vi.fn(async (_p, _m, system: string) => { if (system.includes('split one task')) return { text: plan([A, B]) }; throw new Error('timeout') }) as never })
    const r = await runSwarmRequest('find how the warning travels', d)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('Swarm: 2 of 2 agents returned.')
    expect(r.text).toContain('No combined answer: the combining step failed (timeout).')
  })
})

describe('formatSwarm', () => {
  it('names an agent with no tools as having none', () => {
    const t = formatSwarm({ task: 't', results: [{ agent: { role: 'Thinker', task: 'think about it carefully', tools: [], droppedTools: [] }, status: 'returned', text: 'x' }], synthesis: 'y' }, 'Kimi · k')
    expect(t).toContain('tools: none')
  })
})
