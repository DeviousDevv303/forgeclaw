// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { providers } from '../providerRouter'
import { nexusWebGpuProvider } from './nexusWebGpuProvider'

describe('NEXUS browser WebGPU provider', () => {
  it('routes the nexus provider ID to the browser-local adapter', () => {
    expect(providers.nexus).toBe(nexusWebGpuProvider)
    expect(nexusWebGpuProvider.models[0]?.id).toBe('Qwen2.5-1.5B-Instruct-q4f16_1-MLC')
  })

  it('fails clearly when WebGPU is unavailable without calling localhost', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(nexusWebGpuProvider.send({
        systemPrompt: 'local test',
        messages: [{ role: 'user', content: 'hello' }],
        model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      }, '')).rejects.toThrow(/WebGPU is unavailable/)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
