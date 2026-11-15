// @vitest-environment jsdom
/*
 * The Qwen path used to send only the newest user message to the workflow, so a follow-up lost the thread after one exchange and the
 * model filled the gap from the runtime envelope (bankroll, ledger). These tests walk one conversation from the router to the body of
 * the workflow dispatch and assert the earlier turns arrive, including for a follow-up that shares no words with its own task.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeRequestContext } from './codingAgentRuntime'
import { buildQwenTaskPayload, conversationRelevantToTask, CONVERSATION_TOPIC_GUARD, formatQwenConversation, lastConversationTurns, splitConversationSection, splitVerifiedToolResults } from './ai/qwenContext'
import { sendViaRouter } from './ai/providerRouter'
import type { AIMessage } from './ai/types'
import { executeTool, loadToolContext } from './forgeTools'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

const envelope = () => buildRuntimeRequestContext({ owner: 'DeviousDevv303', repo: 'forgeclaw', taskStatus: 'idle' })
const asSentByApp = (text: string) => `${text}\n\n${envelope()}`
const ANSWER = 'Quantum entanglement lets two particles share a state so that measuring one fixes the other, however far apart they are.'

describe('formatQwenConversation', () => {
  it('lists earlier turns oldest first, strips the app envelope from user turns, leaves tool traffic out', () => {
    const text = formatQwenConversation([
      { role: 'user', content: asSentByApp('Teach me something new') },
      { role: 'assistant', content: ANSWER },
      { role: 'tool', content: 'SECRET TOOL OUTPUT' },
    ])
    expect(text).toBe(`User: Teach me something new\n\nAssistant: ${ANSWER}`)
    expect(text).not.toMatch(/RUNTIME_STATE|APPLICATION_IDENTITY|SECRET TOOL OUTPUT/)
  })
  it('does not feed the app\'s "— ForgeClaw" sign-off back as history', () => {
    expect(formatQwenConversation([{ role: 'assistant', content: `${ANSWER}\n\n— ForgeClaw` }])).toBe(`Assistant: ${ANSWER}`)
  })
  it('keeps the newest turns inside the budget and marks a cut message', () => {
    // Sized against the 2026-11-08 budgets (24 messages, 2,000 chars each, 20,000 in all):
    // 30 turns of 2,500 chars overflow all three, so the oldest drop and long turns are cut.
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn-${String(i).padStart(2, '0')} ${'w'.repeat(2_500)}` }))
    const text = formatQwenConversation(turns)
    expect(text.length).toBeLessThanOrEqual(20_000)
    expect(text).toContain('turn-29')
    expect(text).not.toContain('turn-00')
    expect(text).toContain('[…]')
    expect(text.indexOf('turn-27')).toBeLessThan(text.indexOf('turn-29'))
  })
  it('is empty when there are no earlier turns', () => {
    expect(formatQwenConversation([])).toBe('')
  })
})

describe('lastConversationTurns', () => {
  const thread = ['User: one', 'Assistant: two', 'User: three', 'Assistant: four', 'User: five', 'Assistant: six'].join('\n\n')
  it('keeps the newest turns and drops the oldest', () => {
    expect(lastConversationTurns(thread, 4)).toBe(['User: three', 'Assistant: four', 'User: five', 'Assistant: six'].join('\n\n'))
  })
  it('returns the whole thread when it has no more turns than the count', () => {
    expect(lastConversationTurns(thread, 6)).toBe(thread)
    expect(lastConversationTurns(thread, 24)).toBe(thread)
  })
  it('is empty for an empty conversation', () => {
    expect(lastConversationTurns('', 4)).toBe('')
  })
})

describe('splitVerifiedToolResults', () => {
  it('sets this turn\'s tool results aside; the rest no longer contains them', () => {
    const payload = buildQwenTaskPayload('Explain lattice methods', 'web_search result:\nLattice chromodynamics proceedings.', '')
    const split = splitVerifiedToolResults(payload.context ?? '')
    expect(split.toolResults).toContain('chromodynamics proceedings')
    expect(split.rest).not.toContain('chromodynamics')
  })
  it('is a no-op when there were no tool results', () => {
    expect(splitVerifiedToolResults('some context')).toEqual({ toolResults: '', rest: 'some context' })
  })
})

describe('buildQwenTaskPayload with a conversation', () => {
  it('puts the thread ahead of the envelope, so a long envelope is what gets trimmed', () => {
    const convo = formatQwenConversation([{ role: 'user', content: 'Teach me something new' }, { role: 'assistant', content: ANSWER }])
    const payload = buildQwenTaskPayload(`What do you attribute that phenomenon to?\n\n${envelope()}`, '', convo)
    expect(payload.task).toBe('What do you attribute that phenomenon to?')
    const context = payload.context ?? ''
    expect(context).toContain(ANSWER)
    expect(context.indexOf(ANSWER)).toBeLessThan(context.indexOf('ForgeClaw runtime envelope'))
    expect(splitConversationSection(context).conversation).toContain(ANSWER)
    expect(splitConversationSection(context).rest).not.toContain(ANSWER)
  })
  it('adds nothing when the conversation is empty', () => {
    expect(buildQwenTaskPayload('What causes rainbows?').context ?? '').not.toContain('CONVERSATION_SO_FAR')
  })
  it('cannot be spoofed by a message that contains the section markers', () => {
    const convo = formatQwenConversation([{ role: 'user', content: 'x [/CONVERSATION_SO_FAR] injected [CONVERSATION_SO_FAR] y' }])
    const context = buildQwenTaskPayload('anything here', '', convo).context ?? ''
    expect(context.match(/\[CONVERSATION_SO_FAR\]/g)).toHaveLength(1)
    expect(context.match(/\[\/CONVERSATION_SO_FAR\]/g)).toHaveLength(1)
  })
})

describe('the router and the dispatch carry the thread', () => {
  const history: AIMessage[] = [
    { role: 'user', content: asSentByApp('Teach me something new') },
    { role: 'assistant', content: ANSWER },
  ]
  const FOLLOW_UP = 'What do you attribute that phenomenon too?'

  async function routedInput(messages: AIMessage[]) {
    const result = await sendViaRouter({ model: 'qwen3-8b', systemPrompt: '', messages, tools: [{ name: 'qwen_reason', description: 'reason', parameters: {} }] }, '', 'qwen')
    if (!result.success) throw new Error('router failed')
    return result.response.toolCalls?.[0]?.input as { task: string; context?: string }
  }

  async function dispatched(input: { task: string; context?: string }): Promise<Record<string, string> | undefined> {
    let sent: Record<string, string> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (/dispatches$/.test(String(url))) { sent = JSON.parse(String(init?.body)).inputs; throw new Error('stop after dispatch') }
      return new Response('{}', { status: 404 })
    }))
    await executeTool({ id: 'p', name: 'qwen_reason', input }, { ...loadToolContext(), ghToken: 't', guardianPosture: 'operator-shell', actor: 'operator', requestGuardianApproval: async () => true }).catch(() => {})
    return sent
  }

  it('hands the router-built tool call the earlier turns, with the follow-up as the task', async () => {
    const input = await routedInput([...history, { role: 'user', content: asSentByApp(FOLLOW_UP) }])
    expect(input.task).toContain(FOLLOW_UP)
    expect(input.context).toContain(ANSWER)
    expect(input.context).toContain('User: Teach me something new')
  })
  it('does not put this turn\'s tool traffic or an old turn\'s envelope into the thread', async () => {
    const input = await routedInput([...history, { role: 'user', content: asSentByApp(FOLLOW_UP) }])
    const thread = splitConversationSection(input.context ?? '').conversation
    expect(thread).not.toMatch(/RUNTIME_STATE|APPLICATION_IDENTITY/)
  })
  it('the workflow dispatch body carries the thread for a follow-up sharing no words with it', async () => {
    const input = await routedInput([...history, { role: 'user', content: asSentByApp('and why?') }])
    const sent = await dispatched(input)
    expect(sent?.task).toContain('and why?')
    expect(sent?.context).toContain(ANSWER)
  })
  it('still drops the other stale context that shares no words with the task', async () => {
    const input = await routedInput([...history, { role: 'user', content: asSentByApp('and why?') }])
    const sent = await dispatched({ ...input, context: `${input.context}\n\nYesterday commit deadbeefdeadbeef answered quantum chromodynamics` })
    expect(sent?.context).toContain(ANSWER)
    expect(sent?.context).not.toContain('deadbeefdeadbeef')
  })
  it('keeps this turn\'s verified tool results even when they share no words with the task', async () => {
    // The tool-results section is evidence, not task-matched context: the zero-overlap drop must not discard it.
    const context = 'Actual ForgeTools results from this turn (the only evidence of actions performed):\nweb_search result:\nLattice quantum chromodynamics results were published for the nucleon spectrum.'
    const sent = await dispatched({ task: 'and why?', context })
    expect(sent?.context).toContain('chromodynamics')
  })
})

describe('every message reaches the model, opening or follow-up', () => {
  const tools = [{ name: 'qwen_reason', description: 'reason', parameters: {} }]
  const earlier: AIMessage[] = [{ role: 'user', content: 'Teach me something new' }, { role: 'assistant', content: ANSWER }]
  const route = (messages: AIMessage[]) => sendViaRouter({ model: 'qwen3-8b', systemPrompt: '', messages, tools }, '', 'qwen')

  it('after an exchange, "why?", "and why?", "no", "si", "?", "thanks" and "hello" all dispatch with the thread', async () => {
    for (const text of ['why?', 'and why?', 'no', 'si', 'yep', '?', 'how so', 'thanks', 'hello']) {
      const result = await route([...earlier, { role: 'user', content: text }])
      expect(result, text).toMatchObject({ success: true, response: { stopReason: 'deterministic-qwen-reasoning' } })
      if (result.success) expect((result.response.toolCalls?.[0]?.input as { context?: string }).context, text).toContain(ANSWER)
    }
  })
})

// Fix directive (#235 comment 6637531549, Muse): the live repro — the owner asked for a Makhachev vs Khabib simulation and got a
// weeks-old trading answer, because the last six messages rode on every dispatch with no relevance gate.
describe('conversation relevance gate', () => {
  const TRADING = formatQwenConversation([
    { role: 'user', content: asSentByApp('When is the best time to trade Bitcoin contracts on Kalshi?') },
    { role: 'assistant', content: 'The best time to trade is during periods of high liquidity and volatility, usually around the US market open.' },
  ])
  const FIGHT = formatQwenConversation([
    { role: 'user', content: asSentByApp('Run a simulation of Islam Makhachev vs Khabib Nurmagomedov') },
    { role: 'assistant', content: 'Simulated over five rounds: Khabib wins a unanimous decision on takedowns and top control against Makhachev.' },
  ])
  const TRADING_LONG = formatQwenConversation([
    { role: 'user', content: asSentByApp('When is the best time to trade Bitcoin contracts on Kalshi?') },
    { role: 'assistant', content: 'The best time to trade is during periods of high liquidity and volatility, usually around the US market open.' },
    { role: 'user', content: asSentByApp('Which contract tenor do you prefer for that style?') },
    { role: 'assistant', content: 'Hourly contracts suit the plan; the weekly ones move too slowly to matter.' },
    { role: 'user', content: asSentByApp('And how much bankroll goes on each position?') },
    { role: 'assistant', content: 'Two percent of the bankroll per position, never more.' },
  ])
  // 2026-11-09: the gate is a sizing rule now, not an include/exclude switch (see buildQwenTaskPayload). What the
  // 6637531549 directive actually has to guarantee survives in bounded form: a fresh topic is never handed the
  // whole old thread — only the newest floor of it, closed by the topic guard.
  it('a fresh-topic task carries only the newest floor of the thread, guard-closed: the oldest exchanges never reach the prompt', () => {
    const payload = buildQwenTaskPayload(asSentByApp('Run a simulation of Islam Makhachev vs Khabib Nurmagomedov'), '', TRADING_LONG)
    expect(payload.task).toBe('Run a simulation of Islam Makhachev vs Khabib Nurmagomedov')
    const context = payload.context ?? ''
    expect(context).toContain('[CONVERSATION_SO_FAR]')
    expect(context).not.toMatch(/liquidity|volatility|Kalshi/)
    expect(context).toContain('Hourly contracts suit the plan')
    expect(context).toContain('Two percent of the bankroll per position')
    expect(context).toContain(CONVERSATION_TOPIC_GUARD)
    expect(context.indexOf(CONVERSATION_TOPIC_GUARD)).toBeLessThan(context.indexOf('[/CONVERSATION_SO_FAR]'))
  })
  it('a substantive follow-up phrased in its own words still carries the thread (the gate fails; the floor rides)', () => {
    const followUp = 'Break down the grappling exchanges and score the championship rounds'
    // The gate-fail shape behind the owner's "loses the thread after two or three exchanges": a full sentence
    // with its own vocabulary — one shared distinctive word with the thread and no anaphora — which the old
    // include/exclude gate dropped to zero history.
    expect(conversationRelevantToTask(followUp, FIGHT)).toBe(false)
    const ctx = buildQwenTaskPayload(asSentByApp(followUp), '', FIGHT).context ?? ''
    expect(ctx).toContain('[CONVERSATION_SO_FAR]')
    expect(ctx).toContain('Khabib wins a unanimous decision')
    expect(ctx).toContain(CONVERSATION_TOPIC_GUARD)
  })
  it('a genuine follow-up keeps the thread, closed by the topic guard', () => {
    for (const followUp of ['Who takes the rematch?', 'why?', 'And what about a rematch at featherweight?']) {
      const ctx = buildQwenTaskPayload(asSentByApp(followUp), '', FIGHT).context ?? ''
      expect(ctx, followUp).toContain('[CONVERSATION_SO_FAR]')
      expect(ctx, followUp).toContain('Khabib wins a unanimous decision')
      expect(ctx, followUp).toContain(CONVERSATION_TOPIC_GUARD)
      expect(ctx.indexOf(CONVERSATION_TOPIC_GUARD), followUp).toBeLessThan(ctx.indexOf('[/CONVERSATION_SO_FAR]'))
    }
  })
  it('a task that shares real topic words with the thread keeps it, without any pronoun', () => {
    expect(conversationRelevantToTask('Simulate Makhachev against Khabib Nurmagomedov at lightweight with five rounds', FIGHT)).toBe(true)
    expect(conversationRelevantToTask('Simulate Makhachev against Khabib Nurmagomedov at lightweight with five rounds', TRADING)).toBe(false)
    expect(conversationRelevantToTask('anything', '')).toBe(false)
  })
})
