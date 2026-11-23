import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../modelProviders'

vi.mock('./providerRouter', () => ({ sendViaRouter: vi.fn() }))

import { sendViaRouter } from './providerRouter'
import { callNexusViaRouter } from './nexusAgentTransport'

const mockedSend = vi.mocked(sendViaRouter)

function okResponse() {
  return {
    success: true,
    response: { text: 'child answer', provider: 'nexus-intelligence', model: 'nexus-run25', toolCalls: undefined, stopReason: 'nexus-synthesis-complete' },
  } as unknown as Awaited<ReturnType<typeof sendViaRouter>>
}

describe('callNexusViaRouter', () => {
  beforeEach(() => {
    mockedSend.mockReset()
  })

  it('folds the spawn system_prompt into the child dispatch as a role line above the task', async () => {
    // The router's Nexus branch builds its dispatch from messages alone, so before
    // this fold the child's system_prompt never reached the workflow and the child
    // ran on the bare task. The dispatch the router receives must carry the role.
    mockedSend.mockResolvedValue(okResponse())
    const messages: ChatMessage[] = [{ role: 'user', content: 'Find where the image warning is built.' }]
    const result = await callNexusViaRouter('nexus-run25', 'You are a research agent. Cite file paths.', messages, '', {}, [])
    expect(result.text).toBe('child answer')
    expect(mockedSend).toHaveBeenCalledTimes(1)
    const request = mockedSend.mock.calls[0][0]
    expect(request.messages[0].content).toBe('You are a research agent. Cite file paths.\nFind where the image warning is built.')
    // The caller's history is not mutated: the fold builds a new array per call,
    // so it cannot stack across the sub-agent loop's iterations.
    expect(messages[0].content).toBe('Find where the image warning is built.')
  })

  it('leaves the child messages untouched when the spawn carries no system_prompt', async () => {
    mockedSend.mockResolvedValue(okResponse())
    const messages: ChatMessage[] = [{ role: 'user', content: 'Just the task.' }]
    await callNexusViaRouter('nexus-run25', '  ', messages, '', {}, [])
    const request = mockedSend.mock.calls[0][0]
    expect(request.messages[0].content).toBe('Just the task.')
  })
})
