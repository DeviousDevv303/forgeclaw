import { describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_DEFAULT_MAX_TOKENS, anthropicProvider, toAnthropicMessages } from './anthropicProvider'

describe('toAnthropicMessages', () => {
  it('puts every tool_result of one assistant turn into a single following user message', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'Check the repo.' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 't1', name: 'github_repo_state', input: {} },
        { id: 't2', name: 'github_list_files', input: { path: '' } },
      ] },
      { role: 'tool', content: 'HEAD abc', tool_call_id: 't1' },
      { role: 'tool', content: 'README.md', tool_call_id: 't2' },
    ])
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({ role: 'assistant', content: [
      { type: 'tool_use', id: 't1', name: 'github_repo_state', input: {} },
      { type: 'tool_use', id: 't2', name: 'github_list_files', input: { path: '' } },
    ] })
    expect(out[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'HEAD abc' },
      { type: 'tool_result', tool_use_id: 't2', content: 'README.md' },
    ] })
  })

  it('drops empty messages and a leading assistant turn from the history window', () => {
    const out = toAnthropicMessages([
      { role: 'assistant', content: 'Earlier reply' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'Again' },
    ])
    expect(out).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }, { type: 'text', text: 'Again' }] }])
  })
})

describe('anthropicProvider.send', () => {
  it('uses a max_tokens budget that fits a whole-file write', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input
      void _init
      return Response.json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await anthropicProvider.send({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], model: 'claude-sonnet-5-5' }, 'sk-ant-test-key-123456789012')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
  })

  it('marks tool calls cut off at max_tokens so they are not executed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      content: [{ type: 'tool_use', id: 'w1', name: 'github_write_file', input: { path: 'index.html' } }],
      stop_reason: 'max_tokens',
    })))
    const res = await anthropicProvider.send({ systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], model: 'claude-sonnet-5-5' }, 'sk-ant-test-key-123456789012')
    expect(res.toolCalls?.[0]?.parseError).toMatch(/output token limit/)
  })
})
