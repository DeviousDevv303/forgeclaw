import { describe, expect, it } from 'vitest'
import { currentDateNote, needsCurrentInfo } from './currentInfo'
import { sendViaRouter } from './ai/providerRouter'

describe('questions about what is current', () => {
  it.each([
    "what's the latest in tech",
    'what is new in AI this year',
    'recent breakthroughs in batteries',
    'best phones of 2026',
    "what's trending in fashion",
    'what happened at the city council meeting last night',
    'any announcements from yesterday',
    'what changed overnight in the markets',
    'did anything break this morning',
  ])('needs current info: %s', text => expect(needsCurrentInfo(text)).toBe(true))

  it.each([
    'explain how recursion works',
    'what is the latest commit on the repo',
    'write a poem about the ocean',
    'Good morning, give me a calisthenics workout for today',
  ])('does not: %s', text => expect(needsCurrentInfo(text)).toBe(false))

  it('tells the model the real date and to admit outdated knowledge', () => {
    const note = currentDateNote(new Date('2026-10-20T12:00:00Z'))
    expect(note).toMatch(/^Today's date is \w+, October 20, 2026\./)
    expect(note).toContain('say plainly that your information may be outdated')
  })

  it("routes \"what's the latest in tech\" on DeepSeek through deep research before the model answers", async () => {
    const tools = ['deepseek_reason', 'deep_research'].map(name => ({ name, description: name, parameters: {} }))
    const r = await sendViaRouter({ model: 'deepseek-16b', systemPrompt: '', tools, messages: [{ role: 'user', content: "what's the latest in tech" }] }, '', 'deepseek')
    expect(r).toMatchObject({ success: true, response: { stopReason: 'deterministic-deep-research' } })
    if (r.success) expect(r.response.toolCalls?.[0]).toMatchObject({ name: 'deep_research', input: { question: "what's the latest in tech" } })
  })
})
