// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nexusProvider } from './nexusProvider'

const endpoint = 'http://127.0.0.1:8787'
const responseText = 'NEXUS provider test response.'
const encodedResponse = Buffer.from(responseText, 'utf8').toString('base64')

describe('NEXUS local provider adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      if (body === 'STATUS') {
        return new Response('OK\tSTATUS\tinitialized=1\toffline=1\nEND\n', { status: 200 })
      }
      if (body.startsWith('CHAT\t')) {
        return new Response(`OK\tCHAT\t${encodedResponse}\nEND\n`, { status: 200 })
      }
      return new Response('ERR\tdW5zdXBwb3J0ZWQ=', { status: 400 })
    }))
  })

  it('recognizes only loopback endpoints as configured', () => {
    expect(nexusProvider.isConfigured(endpoint)).toBe(true)
    expect(nexusProvider.isConfigured('https://example.invalid')).toBe(false)
    expect(nexusProvider.supportsTools('qwen2.5-1.5b-instruct-q4_k_m')).toBe(false)
  })

  it('checks the offline NEXUS runtime and decodes local chat output', async () => {
    await nexusProvider.test(endpoint)
    const onToken = vi.fn()
    const result = await nexusProvider.send({
      systemPrompt: 'You are local.',
      messages: [{ role: 'user', content: 'Say hello.' }],
      model: 'qwen2.5-1.5b-instruct-q4_k_m',
      onToken,
    }, endpoint)

    expect(result.provider).toBe('nexus')
    expect(result.text).toBe(responseText)
    expect(onToken).toHaveBeenCalledWith(responseText)
  })

  it('does not grant tool authority to the MVP runtime', async () => {
    await expect(nexusProvider.send({
      systemPrompt: 'You are local.',
      messages: [{ role: 'user', content: 'Use a tool.' }],
      model: 'qwen2.5-1.5b-instruct-q4_k_m',
      tools: [{ name: 'run_js', description: 'test', parameters: {} }],
    }, endpoint)).rejects.toThrow('does not grant tool authority')
  })
})
