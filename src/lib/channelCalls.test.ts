// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHANNEL_CALL_WATERMARK_KEY,
  acknowledgeChannelCalls,
  filterNewChannelCalls,
  parseChannelCall,
  parseChannelCalls,
  readChannelCallWatermark,
  type GithubIssueCommentLike,
} from './channelCalls'

const MARKER = '<!-- forgeclaw-call:v1 id=call-1 -->'

function comment(overrides: Partial<GithubIssueCommentLike> = {}): GithubIssueCommentLike {
  return {
    id: 101,
    body: `@ForgeClaw\n\nCheck the relay and report back.\n\n${MARKER}`,
    created_at: '2026-10-23T06:30:00Z',
    user: { login: 'DeviousDevv303' },
    ...overrides,
  }
}

describe('parseChannelCall', () => {
  it('parses an owner comment carrying the v1 marker', () => {
    const call = parseChannelCall(comment())
    expect(call).not.toBeNull()
    expect(call?.callId).toBe('call-1')
    expect(call?.commentId).toBe(101)
    expect(call?.createdAt).toBe('2026-10-23T06:30:00Z')
  })

  it('strips the marker line from the task text and trims', () => {
    const call = parseChannelCall(comment())
    expect(call?.taskText).toBe('@ForgeClaw\n\nCheck the relay and report back.')
    expect(call?.taskText).not.toContain('forgeclaw-call')
  })

  it('ignores a comment with no marker, even from the owner', () => {
    expect(parseChannelCall(comment({ body: '@ForgeClaw please look at this' }))).toBeNull()
    expect(parseChannelCall(comment({ body: 'ordinary channel traffic' }))).toBeNull()
    expect(parseChannelCall(comment({ body: null }))).toBeNull()
  })

  it('ignores a marked comment from any other author', () => {
    expect(parseChannelCall(comment({ user: { login: 'someone-else' } }))).toBeNull()
    expect(parseChannelCall(comment({ user: null }))).toBeNull()
    expect(parseChannelCall(comment({ user: undefined }))).toBeNull()
  })

  it('ignores a marker for a different format version', () => {
    expect(parseChannelCall(comment({ body: '<!-- forgeclaw-call:v2 id=x -->\nDo things.' }))).toBeNull()
  })
})

describe('parseChannelCalls + filterNewChannelCalls', () => {
  it('keeps only real calls, oldest first', () => {
    const calls = parseChannelCalls([
      comment({ id: 105, body: `later task\n<!-- forgeclaw-call:v1 id=b -->` }),
      comment({ id: 99, body: 'no marker here' }),
      comment({ id: 103, body: `earlier task\n<!-- forgeclaw-call:v1 id=a -->` }),
      comment({ id: 104, user: { login: 'intruder' }, body: `forged\n${MARKER}` }),
    ])
    expect(calls.map(c => c.commentId)).toEqual([103, 105])
    expect(calls.map(c => c.callId)).toEqual(['a', 'b'])
  })

  it('watermark filtering keeps only calls strictly above the watermark', () => {
    const calls = parseChannelCalls([
      comment({ id: 100, body: `old\n<!-- forgeclaw-call:v1 id=old -->` }),
      comment({ id: 101, body: `edge\n<!-- forgeclaw-call:v1 id=edge -->` }),
      comment({ id: 102, body: `new\n<!-- forgeclaw-call:v1 id=new -->` }),
    ])
    expect(filterNewChannelCalls(calls, 101).map(c => c.callId)).toEqual(['new'])
    expect(filterNewChannelCalls(calls, 0)).toHaveLength(3)
    expect(filterNewChannelCalls(calls, 102)).toHaveLength(0)
  })
})

describe('watermark storage (strict read-back)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts at 0 with nothing stored', () => {
    expect(readChannelCallWatermark()).toBe(0)
  })

  it('acknowledge writes the highest comment id and reads it back', () => {
    const calls = parseChannelCalls([
      comment({ id: 140, body: `a\n<!-- forgeclaw-call:v1 id=a -->` }),
      comment({ id: 142, body: `b\n<!-- forgeclaw-call:v1 id=b -->` }),
    ])
    expect(acknowledgeChannelCalls(calls)).toBe(true)
    expect(localStorage.getItem(CHANNEL_CALL_WATERMARK_KEY)).toBe('142')
    expect(readChannelCallWatermark()).toBe(142)
  })

  it('acknowledge never moves the watermark backwards', () => {
    localStorage.setItem(CHANNEL_CALL_WATERMARK_KEY, '200')
    const calls = parseChannelCalls([comment({ id: 150, body: `a\n<!-- forgeclaw-call:v1 id=a -->` })])
    expect(acknowledgeChannelCalls(calls)).toBe(true)
    expect(readChannelCallWatermark()).toBe(200)
  })

  it('acknowledge of an empty list is a no-op success', () => {
    expect(acknowledgeChannelCalls([])).toBe(true)
    expect(readChannelCallWatermark()).toBe(0)
  })

  it('a corrupt stored watermark reads as 0, never as a phantom position', () => {
    localStorage.setItem(CHANNEL_CALL_WATERMARK_KEY, 'not-a-number')
    expect(readChannelCallWatermark()).toBe(0)
  })
})
