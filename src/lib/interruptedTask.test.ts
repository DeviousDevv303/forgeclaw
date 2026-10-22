// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AUTO_RESUME_MAX_AGE_MS, findInterruptedTask, type InterruptibleMessage } from './interruptedTask'

const now = 1_800_000_000_000
const notCommand = () => false
const pair = (over: Partial<InterruptibleMessage> = {}, replyOver: Partial<InterruptibleMessage> = {}): InterruptibleMessage[] => [
  { id: 'u1', role: 'user', content: 'build my mom an English site', timestamp: now - 60_000, ...over },
  { id: 'a1', role: 'assistant', content: 'Processing…', streaming: true, timestamp: now - 60_000, ...replyOver },
]

describe('findInterruptedTask', () => {
  it('finds the task the page died on, to resume by itself', () => {
    expect(findInterruptedTask(pair(), { now, isCommand: notCommand }))
      .toEqual({ userId: 'u1', replyId: 'a1', prompt: 'build my mom an English site', imageUrl: undefined, auto: true })
  })
  it('is null when the last reply finished', () => {
    expect(findInterruptedTask(pair({}, { streaming: false }), { now, isCommand: notCommand })).toBeNull()
  })
  it('ignores an older interrupted reply once the conversation moved on', () => {
    const messages = [...pair(), { id: 'u2', role: 'user', content: 'hi', timestamp: now }, { id: 'a2', role: 'assistant', content: 'hello', timestamp: now }]
    expect(findInterruptedTask(messages, { now, isCommand: notCommand })).toBeNull()
  })
  it('leaves a re-attached DeepSeek run alone', () => {
    expect(findInterruptedTask(pair(), { now, skipReplyId: 'a1', isCommand: notCommand })).toBeNull()
  })
  it('never re-runs a resume by itself (no loop when the resume is killed too)', () => {
    expect(findInterruptedTask(pair({ resumedAfterInterrupt: true }), { now, isCommand: notCommand })).toMatchObject({ auto: false, reason: 'already-resumed' })
  })
  it('waits for a tap when the task is old', () => {
    const t = now - AUTO_RESUME_MAX_AGE_MS - 1
    expect(findInterruptedTask(pair({}, { timestamp: t }), { now, isCommand: notCommand })).toMatchObject({ auto: false, reason: 'too-old' })
  })
  it('waits for a tap on a fixed command, which could repeat a side effect', () => {
    expect(findInterruptedTask(pair(), { now, isCommand: () => true })).toMatchObject({ auto: false, reason: 'command' })
  })
})
