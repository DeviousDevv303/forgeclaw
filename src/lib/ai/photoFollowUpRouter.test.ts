import { describe, expect, it } from 'vitest'
import { sendViaRouter } from './providerRouter'
import type { AIRequest } from './types'

const IMAGE = 'data:image/png;base64,iVBORw0KGgo='
const TOOLS = [{ name: 'nexus_reason', description: 'reason', parameters: {} }, { name: 'analyze_image', description: 'look', parameters: {} }]

describe('a follow-up question about an analyzed photo (Nexus provider)', () => {
  const history: AIRequest['messages'] = [
    { role: 'user', content: 'what is this?', image_url: IMAGE },
    { role: 'assistant', content: 'A red car beside a brick wall.\n\nPhoto analyzed by ForgeClaw\'s vision workflow (Qwen2-VL-2B); the text-only Nexus checkpoint was not asked to interpret the image.' },
  ]

  it('goes to the vision workflow with the new question, not to the text-only checkpoint', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', tools: TOOLS, messages: [...history, { role: 'user', content: 'what color is the car?', image_url: IMAGE }] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.stopReason).toBe('deterministic-image-analysis')
    expect(result.response.toolCalls?.[0]).toMatchObject({ name: 'analyze_image', input: { image_url: 'attached', prompt: 'what color is the car?' } })
  })

  it('an unrelated follow-up still reaches the Nexus dispatch', async () => {
    const request: AIRequest = { model: 'nexus-run25', systemPrompt: '', tools: TOOLS, messages: [...history, { role: 'user', content: 'what is the capital of France?' }] }
    const result = await sendViaRouter(request, '', 'nexus-intelligence')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.response.toolCalls?.[0]?.name).toBe('nexus_reason')
    // The attribution line is not part of the conversation the checkpoint reads.
    expect(String(result.response.toolCalls?.[0]?.input.task)).toBe('what is this?\nA red car beside a brick wall.\nwhat is the capital of France?')
  })
})
