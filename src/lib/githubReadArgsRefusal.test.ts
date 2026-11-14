// @vitest-environment node
// End to end for the owner's live Nexus call (2026-11-13, nexus run 43529590869): the refusal happens in executeTool,
// before any request is built, and a valid read is unchanged. Also pins the Nexus-side invariants the trace found:
// the checkpoint never receives tool guidance or definitions, so no guidance text can steer which tool it names.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './forgeTools'
import { SELF_SCULPT_GUIDANCE, SHELL_EXEC_GUIDANCE } from './toolExposure'
import { buildNexusPrompt, buildNexusTranscript, NEXUS_RESULT_INJECT_MAX_CHARS } from './ai/nexusIntelligenceContext'
import { sendViaRouter } from './ai/providerRouter'
import type { AIRequest } from './ai/types'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const ctx: ToolContext = { ghToken: 't', ghOwner: 'DeviousDevv303', ghRepo: 'forgeclaw', actor: 'agent', requestGuardianApproval: async () => true }
const LIVE = { path: ':', start_line: 257257207, owner: '. The claP 07: CONFIRMED. The no futed in your nex2 dollars' }

describe('github read tools refuse unusable arguments before dispatch', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refuses the owner\'s live Nexus call, sends nothing, and names each field', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool({ id: '1', name: 'github_read_file', input: LIVE }, ctx)
    expect(out).toMatch(/^\[TOOL ERROR\]/)
    for (const field of ['owner', 'path', 'start_line']) expect(out).toContain(field)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['github_list_files', 'github_get_run_status', 'github_get_run_logs', 'github_search_code'])('%s refuses owner "." without a request', async (name) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool({ id: '1', name, input: { owner: '.', run_id: '1', query: 'x', path: 'src' } }, ctx)
    expect(out).toMatch(/^\[TOOL ERROR\].*owner/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a valid read still dispatches and returns the file (success path unchanged)', async () => {
    const body = JSON.stringify({ content: Buffer.from('hello\n').toString('base64'), encoding: 'base64', size: 6 })
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await executeTool({ id: '1', name: 'github_read_file', input: { path: './README.md', start_line: 0 } }, ctx)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/DeviousDevv303/forgeclaw/contents/./README.md')
    expect(out).toContain('hello')
  })

  it('the refusal survives the checkpoint\'s injection cap and is marked as an error span in the Nexus transcript', async () => {
    const out = await executeTool({ id: 'c1', name: 'github_read_file', input: LIVE }, ctx)
    expect(out.length).toBeLessThan(NEXUS_RESULT_INJECT_MAX_CHARS)
    const { transcript, calls } = buildNexusTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'github_read_file', input: LIVE }] },
      { role: 'tool', tool_call_id: 'c1', content: out },
    ])
    expect(calls).toBe(1)
    expect(transcript).toContain('<|result:error|>')
    expect(transcript).toContain('Omit owner')
  })
})

describe('Nexus trace invariants (why exposure and guidance cannot steer the checkpoint)', () => {
  it('buildNexusPrompt strips the runtime envelope, so envelope text never reaches the checkpoint', () => {
    const task = 'Read the end of README.md with shell_exec.\n\n[RUNTIME_STATE x]\nuse github_read_file for reads\n[/RUNTIME_STATE]'
    const prompt = buildNexusPrompt([], task)
    expect(prompt).toBe('Read the end of README.md with shell_exec.')
  })

  it('the router dispatch carries only the flattened task: no system prompt, no guidance, no tool definitions', async () => {
    const request: AIRequest = {
      model: 'nexus-run25',
      systemPrompt: `${SHELL_EXEC_GUIDANCE}\n${SELF_SCULPT_GUIDANCE}`,
      messages: [{ role: 'user', content: 'Step 1: use shell_exec to run tail -10 README.md' }],
      tools: [
        { name: 'nexus_reason', description: 'reason', parameters: {} },
        { name: 'github_read_file', description: 'Read a file from a GitHub repository', parameters: {} },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(true)
    if (!result.success) return
    const input = result.response.toolCalls?.[0]?.input as { task: string; context?: string }
    expect(input.task).toBe('Step 1: use shell_exec to run tail -10 README.md')
    expect(JSON.stringify(input)).not.toMatch(/github_read_file|pre-approved debugging|shallow checkout/)
  })
})
