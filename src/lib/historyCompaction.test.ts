import { describe, expect, it } from 'vitest'
import type { AIMessage } from './ai/types'
import { compactToolHistory } from './historyCompaction'

const round = (id: string, name: string, output: string): AIMessage[] => [
  { role: 'assistant', content: '', tool_calls: [{ id, name, input: {} }], reasoning_content: `thinking ${id}` },
  { role: 'tool', content: output, tool_call_id: id },
]
const big = (n: number) => 'x'.repeat(n)

describe('older bulky tool results are cut; recent ones and file contents are not', () => {
  const messages: AIMessage[] = [
    { role: 'user', content: 'diagnose the failing build' },
    ...round('a', 'github_get_run_logs', big(40_000)),
    ...round('b', 'github_read_file', big(40_000)),
    ...round('c', 'deep_research', big(40_000)),
    ...round('d', 'github_get_run_logs', big(40_000)),
  ]
  const out = compactToolHistory(messages)

  it('cuts an older log to its head with a note saying how to get the rest', () => {
    expect(out[2].content.length).toBeLessThan(3_300)
    expect(out[2].content).toMatch(/cut from 40000 characters.*call github_get_run_logs again/)
  })
  it('never cuts a file read, however old', () => {
    expect(out[4].content).toHaveLength(40_000)
  })
  it('keeps the last two tool rounds whole', () => {
    expect(out[6].content).toHaveLength(40_000)
    expect(out[8].content).toHaveLength(40_000)
  })
  it('keeps every message, its order, tool ids and Kimi reasoning, and does not modify the input', () => {
    expect(out).toHaveLength(messages.length)
    expect(out.map(m => [m.role, m.tool_call_id, m.reasoning_content])).toEqual(messages.map(m => [m.role, m.tool_call_id, m.reasoning_content]))
    expect(messages[2].content).toHaveLength(40_000)
  })
  it('leaves short results and short runs alone', () => {
    const short = [...round('a', 'shell_exec', 'ok'), ...round('b', 'shell_exec', 'ok'), ...round('c', 'shell_exec', 'ok')]
    expect(compactToolHistory(short)).toEqual(short)
    const two = [...round('a', 'shell_exec', big(9_000)), ...round('b', 'shell_exec', big(9_000))]
    expect(compactToolHistory(two)).toBe(two)
  })
})
