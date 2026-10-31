// @vitest-environment jsdom
// Nexus walks with the providers all the way to the chat response: no stage strips the owner's teaching silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDeepSeekTaskPayload } from './ai/deepseekContext'
import { sendViaRouter } from './ai/providerRouter'
import type { AIRequest } from './ai/types'
import { readDeepSeekMirror } from './deepseekArtifact'
import { executeTool, loadToolContext } from './forgeTools'
import { joinNexusGuidance, nexusGuidanceForDeepSeek, NEXUS_GUIDANCE_END, splitNexusGuidance } from './nexusGuidance'

const RULE = 'say plainly when a step failed'
beforeEach(() => localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: [RULE], rejected: [] })))
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('the guidance block travels as a unit', () => {
  it('splits out of and back into a larger context', () => {
    const g = nexusGuidanceForDeepSeek('anything at all').text
    expect(g.endsWith(NEXUS_GUIDANCE_END)).toBe(true)
    const context = `runtime envelope line\n\n${g}\n\nApproved CORPUS context: beta`
    const split = splitNexusGuidance(context)
    expect(split.guidance).toBe(g)
    expect(split.rest).toBe('runtime envelope line\n\nApproved CORPUS context: beta')
    expect(splitNexusGuidance('no guidance here')).toEqual({ guidance: '', rest: 'no guidance here' })
    expect(joinNexusGuidance('', 'rest')).toBe('rest')
  })
  it('keeps the end marker when the size cap cuts the text', () => {
    localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: Array.from({ length: 12 }, (_, i) => `rule ${i} ${'x'.repeat(150)}`), rejected: [] }))
    const g = nexusGuidanceForDeepSeek('task', { maxChars: 600 }).text
    expect(g.length).toBeLessThanOrEqual(600)
    expect(splitNexusGuidance(g)).toEqual({ guidance: g, rest: '' })
  })
})

describe('dispatch to the Qwen/Qwen3-8B workflow', () => {
  async function dispatchedContext(task: string, extra = ''): Promise<string | undefined> {
    const payload = buildDeepSeekTaskPayload(task)
    let sent: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (/dispatches$/.test(String(url))) { sent = JSON.parse(String(init?.body)).inputs; throw new Error('stop after dispatch') }
      return new Response('{}', { status: 404 })
    }))
    await executeTool({ id: 'p', name: 'deepseek_reason', input: { task: payload.task, context: [payload.context, extra].filter(Boolean).join('\n\n') } }, { ...loadToolContext(), ghToken: 't', guardianPosture: 'operator-shell', actor: 'operator', requestGuardianApproval: async () => true }).catch(() => {})
    return sent?.context
  }

  it('delivers the guidance even when the task shares no words with it', async () => {
    expect(await dispatchedContext('write a poem about cats')).toContain(RULE)
  })
  it('still drops the other context that shares no words with the task', async () => {
    const context = await dispatchedContext('write a poem about cats', 'Yesterday commit deadbeefdeadbeef answered quantum chromodynamics')
    expect(context).toContain(RULE)
    expect(context).not.toContain('chromodynamics')
  })
})

describe('stale context is still dropped when NEXUS has taught nothing', () => {
  it('sends an empty context for unrelated stale records', async () => {
    localStorage.clear()
    let sent: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (/dispatches$/.test(String(url))) { sent = JSON.parse(String(init?.body)).inputs; throw new Error('stop after dispatch') }
      return new Response('{}', { status: 404 })
    }))
    await executeTool({ id: 'p', name: 'deepseek_reason', input: { task: 'write a poem about cats', context: 'Yesterday commit deadbeefdeadbeef answered quantum chromodynamics' } }, { ...loadToolContext(), ghToken: 't', guardianPosture: 'operator-shell', actor: 'operator', requestGuardianApproval: async () => true }).catch(() => {})
    expect(sent?.context).toBe('')
  })
})

describe('the fixed DeepSeek chains', () => {
  const turn = (prompt: string, tools: string[], results: Array<[string, string]> = []): AIRequest => ({
    model: 'deepseek-16b', systemPrompt: '', tools: tools.map(name => ({ name, description: name, parameters: {} })),
    messages: [{ role: 'user', content: prompt }, ...results.flatMap(([name, content], i) => [
      { role: 'assistant' as const, content: '', tool_calls: [{ id: `c${i}`, name, input: {} }] },
      { role: 'tool' as const, content, tool_call_id: `c${i}` },
    ])],
  })
  const first = async (request: AIRequest) => {
    const r = await sendViaRouter(request, '', 'deepseek')
    if (!r.success) throw new Error(r.error.message)
    return r.response.toolCalls?.[0]
  }

  it('hands the website chain a bounded NEXUS block', async () => {
    const call = await first(turn('Build me a landing page website for my bakery and deploy it', ['deepseek_reason', 'github_create_repo']))
    expect(call).toMatchObject({ name: 'deepseek_reason', input: { profile: 'site' } })
    const context = String(call?.input.context)
    expect(context).toContain(RULE)
    expect(context.length).toBeLessThanOrEqual(600)
  })
  it('hands the self-sculpt rewrite step a bounded NEXUS block', async () => {
    const file = "export const x = 1\n"
    const read = `File: src/lib/elapsed.ts (${file.length} bytes)\n\`\`\`\n${file}\n\`\`\``
    const call = await first(turn('Sculpt src/lib/elapsed.ts so it shows milliseconds', ['deepseek_reason', 'github_read_file', 'sculpt_self'], [['github_read_file', read]]))
    expect(call).toMatchObject({ name: 'deepseek_reason', input: { profile: 'code' } })
    expect(String(call?.input.context)).toContain(RULE)
    expect(String(call?.input.context).length).toBeLessThanOrEqual(600)
  })
  it('sends no context field when NEXUS has taught nothing', async () => {
    localStorage.clear()
    const call = await first(turn('Build me a landing page website for my bakery and deploy it', ['deepseek_reason']))
    expect(call?.input.context).toBeUndefined()
  })
})

describe('the size budget', () => {
  it('cuts the envelope and old records before it cuts the guidance', () => {
    const envelope = `[RUNTIME_STATE ${'x'.repeat(9000)}][/RUNTIME_STATE]`
    const payload = buildDeepSeekTaskPayload(`explain the build pipeline\n\n${envelope}`, 'github_repo_state result:\n' + 'y'.repeat(20000))
    expect(payload.context).toContain(RULE)
    expect(payload.context!.length).toBeLessThanOrEqual(22_000)
  })
})

describe('a call that did not come through the router', () => {
  async function dispatched(input: Record<string, unknown>): Promise<Record<string, string> | undefined> {
    let sent: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (/dispatches$/.test(String(url))) { sent = JSON.parse(String(init?.body)).inputs; throw new Error('stop after dispatch') }
      return new Response('{}', { status: 404 })
    }))
    await executeTool({ id: 'h', name: 'deepseek_reason', input }, { ...loadToolContext(), ghToken: 't', guardianPosture: 'operator-shell', actor: 'operator', requestGuardianApproval: async () => true }).catch(() => {})
    return sent
  }

  it('gets the owner\'s guidance attached at dispatch (hand-typed call, no context)', async () => {
    const sent = await dispatched({ task: 'write a poem about cats' })
    expect(sent?.context).toContain(RULE)
    expect(sent?.context).toContain(NEXUS_GUIDANCE_END)
  })
  it('does not double-attach when the call already carries a block', async () => {
    const block = nexusGuidanceForDeepSeek('write a poem about cats').text
    const sent = await dispatched({ task: 'write a poem about cats', context: block })
    expect(sent?.context?.split(RULE).length).toBe(2)
  })
  it('keeps the attached block small for the long-output profiles', async () => {
    localStorage.setItem('nexus_heuristics_v1', JSON.stringify({ approved: Array.from({ length: 12 }, (_, i) => `rule ${i} ${'x'.repeat(150)}`), rejected: [] }))
    const sent = await dispatched({ task: 'rewrite the file', profile: 'code' })
    expect((sent?.context ?? '').length).toBeLessThanOrEqual(600)
  })
  it('attaches nothing when NEXUS has taught nothing', async () => {
    localStorage.clear()
    expect((await dispatched({ task: 'write a poem about cats' }))?.context).toBe('')
  })
})

describe('a trim in the workflow is never silent', () => {
  const meta = (extra: string) => `model=Qwen/Qwen3-8B\nrole=primary\nelapsed_seconds=40\n${extra}`
  async function deliver(metaText: string) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(String(url).includes('.meta') ? metaText : 'the answer', { status: 200 })))
    return readDeepSeekMirror({ ...loadToolContext(), ghToken: 't' }, 'o', 'r', 'deepseek-1')
  }
  it('reads prompt_trimmed and nexus_guidance from the result metadata', async () => {
    expect(await deliver(meta('prompt_trimmed=true\nnexus_guidance=kept\n'))).toMatchObject({ promptTrimmed: true, nexusGuidance: 'kept' })
    expect(await deliver(meta('prompt_trimmed=false\nnexus_guidance=none\n'))).not.toHaveProperty('promptTrimmed')
  })
  const turn = (stages: string): AIRequest => ({
    model: 'deepseek-16b', systemPrompt: '',
    tools: [{ name: 'deepseek_reason', description: 'd', parameters: {} }],
    messages: [
      { role: 'user', content: 'Explain how a hash table handles collisions in detail' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c0', name: 'deepseek_reason', input: {} }] },
      { role: 'tool', tool_call_id: 'c0', content: `✓ Qwen/Qwen3-8B completed as deepseek-1 on o/r@main.\n${stages}\nRun: https://run\n\nBuckets chain or probe.` },
    ],
  })
  const say = async (stages: string) => { const r = await sendViaRouter(turn(stages), '', 'deepseek'); if (!r.success) throw new Error(r.error.message); return r.response.text }

  it('tells the chat when the prompt was cut, and what happened to the guidance', async () => {
    expect(await say('Stages: checkpoint=Qwen/Qwen3-8B (primary); prompt-trimmed=true; nexus-guidance=kept; learning-persistence=not requested.')).toContain('Your NEXUS guidance was kept.')
    expect(await say('Stages: checkpoint=Qwen/Qwen3-8B; prompt-trimmed=true; nexus-guidance=cut.')).toContain('Your NEXUS guidance was also cut.')
    expect(await say('Stages: checkpoint=Qwen/Qwen3-8B; prompt-trimmed=true; nexus-guidance=none.')).toMatch(/part of the context was cut\.$/)
  })
  it('adds nothing when no trim fired', async () => {
    expect(await say('Stages: checkpoint=Qwen/Qwen3-8B; learning-persistence=not requested.')).toBe('Buckets chain or probe.')
  })
})
