import { describe, expect, it } from 'vitest'
import { NEXUS_TEXT_ANSWER_NOTE, sendViaRouter } from './providerRouter'
import { buildNexusPrompt, buildNexusTranscript, NEXUS_PROMPT_MAX_CHARS } from './nexusIntelligenceContext'
import type { AIRequest } from './types'

// Capability pins for the Nexus Intelligence provider, one block per owner-named area
// (2026-11-21): shell commands, the self-sculpt handoff, and follow-up context. Image
// rendering pins live in nexusRouter.test.ts (the image guarantee) and imageArtifact.test.ts
// (the mirror/artifact download). These tests pin APP behavior only; what the checkpoint
// itself does with a correct dispatch is the graded benchmark's business, not the app's.

const NEXUS_TOOLS = [{ name: 'nexus_reason', description: 'reason', parameters: {} }]
const SHELL_SEGMENT = '<|route:tool|><|call|>{"name":"shell_exec","arguments":{"command":"git status --short","working_directory":"."}}<|/call|>'
const SHELL_OK = ['Shell execution complete.', 'Run #12 (id: 99)', 'Invocation: shell-1', 'Command: git status --short', 'Exit code: 0', '', ' M src/lib/elapsed.ts'].join('\n')
const SHELL_FAILED = '[TOOL ERROR] Shell execution failed.\nRun #12 (id: 99)\nInvocation: shell-1\nCommand: git status --short\nExit code: 1\nConclusion: failure'

function nexusResult(segment: string, id = 'nexus-1'): string {
  return `✓ Nexus Intelligence completed as ${id} on DeviousDevv303/forgeclaw@main.\nStages: dispatch=accepted; checkpoint=nexus-run25-sha256-c41852fb0ac1.\nRun: https://github.com/DeviousDevv303/forgeclaw/actions/runs/1\n\n${segment}`
}

describe('Area 1 — shell commands under Nexus', () => {
  it('turns a Nexus shell_exec segment into a normal app tool call, arguments verbatim', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: NEXUS_TOOLS,
      messages: [
        { role: 'user', content: 'run `git status --short` for me' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'run `git status --short` for me' } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult(SHELL_SEGMENT) },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'nexus-tool-call' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('shell_exec')
      // The live app call form is exactly the graded training form: command + working_directory.
      expect(result.response.toolCalls?.[0]?.input).toEqual({ command: 'git status --short', working_directory: '.' })
    }
  })

  it('injects a successful shell result as a result:ok span, framing intact', () => {
    const { transcript, calls } = buildNexusTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 's1', name: 'shell_exec', input: { command: 'git status --short', working_directory: '.' } }] },
      { role: 'tool', tool_call_id: 's1', content: SHELL_OK },
    ])
    expect(calls).toBe(1)
    expect(transcript).toContain('<|result:ok|>')
    expect(transcript).toContain('Shell execution complete.')
    expect(transcript).toContain('Exit code: 0')
  })

  it('injects a failed shell result as a result:error span — a failure never reads as success prose', () => {
    const { transcript, calls } = buildNexusTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 's1', name: 'shell_exec', input: { command: 'git status --short', working_directory: '.' } }] },
      { role: 'tool', tool_call_id: 's1', content: SHELL_FAILED },
    ])
    expect(calls).toBe(1)
    expect(transcript).toContain('<|result:error|>')
    expect(transcript).not.toContain('<|result:ok|>')
    expect(transcript).toContain('Exit code: 1')
  })

  it('caps an injected shell result at the transcript budget instead of overflowing the window', () => {
    const big = `Shell execution complete.\n${'x'.repeat(5000)}`
    const { transcript } = buildNexusTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 's1', name: 'shell_exec', input: { command: 'cat big.log' } }] },
      { role: 'tool', tool_call_id: 's1', content: big },
    ])
    expect(transcript.length).toBeLessThan(2_000)
    expect(transcript).toContain('<|result:ok|>')
    expect(transcript).toContain('<|/result|>')
  })
})

describe('Area 2 — self-sculpt under Nexus hands off to the Qwen chain', () => {
  const SCULPT_TOOLS = [
    { name: 'qwen_reason', description: 'reason', parameters: {} },
    { name: 'github_read_file', description: 'read', parameters: {} },
    { name: 'sculpt_self', description: 'sculpt', parameters: {} },
  ]
  const SCULPT_ASK = 'improve src/lib/elapsed.ts so it shows milliseconds under one second'

  it('fires the handoff: first step is the Qwen chain reading the file, attributed to Qwen', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', tools: SCULPT_TOOLS, messages: [{ role: 'user', content: SCULPT_ASK }] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'qwen', model: 'qwen3-8b', stopReason: 'deterministic-sculpt-read' } })
    if (result.success) {
      expect(result.response.toolCalls?.[0]?.name).toBe('github_read_file')
      expect(result.response.toolCalls?.[0]?.input).toEqual({ path: 'src/lib/elapsed.ts' })
    }
  })

  it('does not fire on a non-sculpt Nexus request, even with qwen_reason offered', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '',
      tools: [...NEXUS_TOOLS, ...SCULPT_TOOLS],
      messages: [{ role: 'user', content: 'what is the package name?' }],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
  })

  it('does not fire on sculpt intent with no repository file path', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '',
      tools: [...NEXUS_TOOLS, ...SCULPT_TOOLS],
      messages: [{ role: 'user', content: 'improve yourself' }],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
  })

  it('cannot fire when the app did not offer qwen_reason — the handoff is gated on the offering', async () => {
    // App.tsx offers qwen_reason (plus github_read_file/sculpt_self) exactly when it detects the
    // same handoff; this pins the router side of that seam: no offering, no chain, Nexus answers.
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', tools: NEXUS_TOOLS, messages: [{ role: 'user', content: SCULPT_ASK }] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { provider: 'nexus-intelligence', stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
  })
})

describe('Area 4 — follow-up context under Nexus', () => {
  it('carries the prior topic and the prior answer into a follow-up dispatch', async () => {
    const request: AIRequest = {
      model: 'nexus-run25', systemPrompt: '', tools: NEXUS_TOOLS,
      messages: [
        { role: 'user', content: "let's talk about UFC — what's the next fight?" },
        { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: "let's talk about UFC — what's the next fight?" } }] },
        { role: 'tool', tool_call_id: 'b1', content: nexusResult('<|route:tool|><|call|>{"name":"web_search","arguments":{"query":"next UFC fight"}}<|/call|>') },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'web_search', input: { query: 'next UFC fight' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'ufc.com snippet: UFC 311 — Makhachev vs Tsarukyan 2, Jan 18, Intuit Dome.' },
        { role: 'assistant', content: 'The next UFC fight is UFC 311: Makhachev vs Tsarukyan 2, on Jan 18.' },
        { role: 'user', content: 'when does it start?' },
      ],
    }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result).toMatchObject({ success: true, response: { stopReason: 'deterministic-nexus-reasoning' } })
    if (result.success) {
      const task = String(result.response.toolCalls?.[0]?.input.task ?? '')
      expect(task).toContain("let's talk about UFC")
      expect(task).toContain('The next UFC fight is UFC 311')
      expect(task.endsWith('when does it start?')).toBe(true)
      // A fresh turn has no transcript prefix; prior turns ride in the task text only.
      expect(result.response.toolCalls?.[0]?.input.context).toBeUndefined()
      // Prior turns' raw tool results do NOT ride along — only the assistant's answer text does.
      // The topic survives a follow-up only as far as the previous answer actually stated it.
      expect(task).not.toContain('ufc.com snippet')
    }
  })

  it('injects an in-turn web_search result into the continuation transcript', () => {
    const { transcript, calls } = buildNexusTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'web_search', input: { query: 'next UFC fight' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'UFC 311 — Makhachev vs Tsarukyan 2, Jan 18.' },
    ])
    expect(calls).toBe(1)
    expect(transcript).toContain('<|call|>{"name":"web_search","arguments":{"query":"next UFC fight"}}<|/call|>')
    expect(transcript).toContain('<|result:ok|>UFC 311 — Makhachev vs Tsarukyan 2, Jan 18.<|/result|>')
  })

  it('strips the standing answer note out of stored answers before they re-enter the prompt', () => {
    const stored = `The package is named forgeclaw.\n\n${NEXUS_TEXT_ANSWER_NOTE}`
    const prompt = buildNexusPrompt([{ role: 'assistant', content: stored }], 'and its license?')
    expect(prompt).toContain('The package is named forgeclaw.')
    expect(prompt).not.toContain('answering alone')
    expect(prompt.endsWith('and its license?')).toBe(true)
  })

  it('drops the OLDEST lines first when the budget bites — the topic-setting line is the first casualty', () => {
    // Exactly when a topic silently drops: once cumulative prior text + the new task exceeds
    // NEXUS_PROMPT_MAX_CHARS, whole lines are shifted off the front. The first line of a
    // conversation is normally where the topic was set, so it is the first thing lost, even
    // when a later (longer) line survives.
    const topic = "let's talk about UFC"
    // 21 + 1 + 1170 + 1 + 19 = 1,212 > 1,200: one shift (the topic line) brings it to 1,190.
    const longAnswer = 'x'.repeat(1_170)
    const prompt = buildNexusPrompt([
      { role: 'user', content: topic },
      { role: 'assistant', content: longAnswer },
    ], 'when does it start?')
    expect(prompt.length).toBeLessThanOrEqual(NEXUS_PROMPT_MAX_CHARS)
    expect(prompt).not.toContain(topic)
    expect(prompt).toContain(longAnswer)
    expect(prompt.endsWith('when does it start?')).toBe(true)
  })

  it('never drops the current task; an oversized task is tail-kept to the budget', () => {
    const prompt = buildNexusPrompt([], 'y'.repeat(NEXUS_PROMPT_MAX_CHARS + 300))
    expect(prompt).toBe('y'.repeat(NEXUS_PROMPT_MAX_CHARS))
  })
})
