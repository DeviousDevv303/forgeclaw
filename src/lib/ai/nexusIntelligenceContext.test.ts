import { describe, expect, it } from 'vitest'
import {
  buildNexusPrompt,
  buildNexusTranscript,
  parseNexusSegment,
  stripNexusGrammar,
  NEXUS_PROMPT_MAX_CHARS,
} from './nexusIntelligenceContext'
import type { AIMessage } from './types'

describe('buildNexusPrompt', () => {
  it('puts the current task last and flattens prior turns ahead of it', () => {
    const prompt = buildNexusPrompt(
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
      'second question',
    )
    expect(prompt).toBe('first question\nfirst answer\nsecond question')
  })

  it('drops the oldest history first when the budget bites, keeping the current task', () => {
    const prior = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, content: `old turn ${i} ${'x'.repeat(60)}` }))
    const prompt = buildNexusPrompt(prior, 'the current task')
    expect(prompt.length).toBeLessThanOrEqual(NEXUS_PROMPT_MAX_CHARS)
    expect(prompt.endsWith('the current task')).toBe(true)
    expect(prompt).not.toContain('old turn 0')
  })

  it('skips tool messages in the flattened history', () => {
    const prompt = buildNexusPrompt(
      [{ role: 'tool', content: 'raw tool output' }, { role: 'user', content: 'kept' }],
      'now',
    )
    expect(prompt).toBe('kept\nnow')
  })
})

describe('buildNexusTranscript', () => {
  const turn: AIMessage[] = [
    { role: 'user', content: 'read package.json' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'b1', name: 'nexus_reason', input: { task: 'read package.json' } }] },
    { role: 'tool', tool_call_id: 'b1', content: '✓ Nexus Intelligence completed as nexus-1 on o/r@main.\nStages: x\nRun: u\n\n<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"package.json"}}<|/call|>' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'github_read_file', input: { path: 'package.json' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"name":"forgeclaw"}' },
  ]

  it('rebuilds the call/result spans and skips nexus_reason itself', () => {
    const { transcript, calls } = buildNexusTranscript(turn)
    expect(calls).toBe(1)
    expect(transcript).toBe('<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"package.json"}}<|/call|><|result:ok|>{"name":"forgeclaw"}<|/result|>')
  })

  it('marks failed tool results as result:error', () => {
    const failed: AIMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'shell_exec', input: { command: 'ls' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '[TOOL ERROR] boom' },
    ]
    const { transcript } = buildNexusTranscript(failed)
    expect(transcript).toContain('<|result:error|>[TOOL ERROR] boom<|/result|>')
  })

  it('ignores calls whose result has not arrived yet', () => {
    const pending: AIMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'github_read_file', input: { path: 'x' } }] },
    ]
    expect(buildNexusTranscript(pending)).toEqual({ transcript: '', calls: 0 })
  })
})

describe('parseNexusSegment', () => {
  it('parses the frozen Run 25 v1 tool-call output verbatim', () => {
    // run25/eval/v1.jsonl, ev1-tool_choice-001 — the graded prediction this provider serves.
    const parsed = parseNexusSegment('<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"package.json"}}<|/call|>')
    expect(parsed).toMatchObject({ kind: 'call', name: 'github_read_file', input: { path: 'package.json' } })
  })

  it('parses a direct answer with its evidence token', () => {
    const parsed = parseNexusSegment('<|route:direct|><|ev:not_verified|><|answer|>Glad to help.<|/answer|><|end|>')
    expect(parsed).toMatchObject({ kind: 'answer', text: 'Glad to help.' })
  })

  it('parses a continuation answer (no route token after a result)', () => {
    const parsed = parseNexusSegment('<|ev:verified|><|answer|>Here is what the tool returned above.<|/answer|><|end|>')
    expect(parsed).toMatchObject({ kind: 'answer', text: 'Here is what the tool returned above.' })
  })

  it('surfaces a runner failure instead of rendering it as an answer', () => {
    const parsed = parseNexusSegment('[NEXUS RUN FAILED] checkpoint sha256 mismatch')
    expect(parsed).toMatchObject({ kind: 'failed', message: 'checkpoint sha256 mismatch' })
  })

  it('fails an empty segment', () => {
    expect(parseNexusSegment('   ')).toMatchObject({ kind: 'failed' })
  })

  it('strips grammar from unstructured text instead of dropping it', () => {
    expect(stripNexusGrammar('<|route:direct|>plain words<|end|>')).toBe('plain words')
    expect(parseNexusSegment('<|route:defer|>I need the file path first.')).toMatchObject({ kind: 'answer', text: 'I need the file path first.' })
  })
})
