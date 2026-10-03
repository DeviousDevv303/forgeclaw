// @vitest-environment node
// Updated by MANUS: the previous assertions described the removed localhost/Ollama
// transport ("only loopback endpoints are configured", "checks the offline NEXUS
// runtime"), but nexusProvider now resolves to the Browser WebGPU engine, which is
// neither loopback-configured nor available under Node. The test asserted behaviour
// the runtime intentionally no longer has, so it failed on every run.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NEXUS_ENDPOINT,
  nexusProvider,
  isNexusWebGpuAvailable,
  NEXUS_MODELS,
} from './nexusProvider'
import { FORGE_TOOLS } from '../../forgeTools'
import { injectToolSchema, parseManualToolCalls, toToolCalls, stripToolSyntax } from '../manualToolMode'
import { adaptNexusMessages, limitNexusContext } from '../nexusContext'

describe('NEXUS provider adapter (Browser WebGPU path)', () => {
  it('exposes the WebGPU model list and a placeholder endpoint', () => {
    expect(nexusProvider.id).toBe('nexus')
    expect(nexusProvider.label).toContain('WebGPU')
    expect(NEXUS_MODELS.length).toBeGreaterThan(0)
    expect(DEFAULT_NEXUS_ENDPOINT.startsWith('webgpu://')).toBe(true)
  })

  it('does not require an API key and never claims native tool support', () => {
    expect(nexusProvider.requiresKey).toBe(false)
    expect(nexusProvider.isConfigured('')).toBe(true)
    expect(nexusProvider.supportsTools(NEXUS_MODELS[0].id)).toBe(false)
  })

  it('reports WebGPU as unavailable under Node instead of silently falling back', async () => {
    expect(isNexusWebGpuAvailable()).toBe(false)
    await expect(nexusProvider.test('')).rejects.toThrow('NEXUS WebGPU is unavailable')
  })

  it('refuses tool authority so the App owns execution through manual tool mode', async () => {
    await expect(nexusProvider.send({
      systemPrompt: 'You are local.',
      messages: [{ role: 'user', content: 'Use a tool.' }],
      model: NEXUS_MODELS[0].id,
      tools: [{ name: 'run_js', description: 'test', parameters: {} }],
    }, '')).rejects.toThrow('does not grant tool authority')
  })

  // The manual tool-mode bridge is what lets a no-native-tools model still act.
  it('round-trips a manual tool block through inject → parse → execute shape', () => {
    const withSchema = injectToolSchema('SYSTEM', FORGE_TOOLS)
    expect(withSchema).toContain('```tool_call')
    expect(withSchema).toContain('github_repo_state')

    const emitted = 'Reading state.\n```tool_call\n{"name":"github_repo_state","arguments":{}}\n```\nSTATUS: IN_PROGRESS'
    const actions = parseManualToolCalls(emitted)
    expect(actions).toHaveLength(1)
    expect(actions[0].toolName).toBe('github_repo_state')

    const calls = toToolCalls(actions)
    expect(calls[0].name).toBe('github_repo_state')
    expect(calls[0].id).toMatch(/^manual_/)

    const cleaned = stripToolSyntax(emitted)
    expect(cleaned).not.toContain('tool_call')
    expect(cleaned).toContain('STATUS: IN_PROGRESS')
  })

  it('parses the raw NEXUS FLUX envelope instead of displaying it', () => {
    const emitted = '{"toolcalls":[{"id":"call1","type":"function","function":{"name":"generateimage","arguments":"{\\"prompt\\":\\"Rick and Morty\\",\\"style\\":\\"cartoon\\",\\"width\\":256,\\"height\\":256}"}}]}'
    const actions = parseManualToolCalls(emitted)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      toolName: 'generate_image',
      params: { prompt: 'Rick and Morty', style: 'cartoon', width: 256, height: 256 },
    })
    expect(stripToolSyntax(emitted)).toBe('')
  })

  it('keeps the next WebGPU request user/tool-safe after a real tool result', () => {
    const adapted = adaptNexusMessages([
      { role: 'user', content: 'Check the repository.' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'github_repo_state', input: {} }] },
      { role: 'tool', content: 'repo: DeviousDevv303/forgeclaw', tool_call_id: 'call-1' },
    ])
    expect(adapted.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(adapted.at(-1)?.role).toBe('user')
    expect(adapted.at(-1)?.content).toContain('[TOOL RESULT call-1]')
  })

  it('never drops a fresh user turn when the system prompt exceeds the budget', () => {
    const bounded = limitNexusContext('SYSTEM '.repeat(3000), [{ role: 'user', content: 'hello' }], 100)
    expect(bounded.tokenCount).toBeLessThanOrEqual(100)
    expect(bounded.messages.at(-1)?.role).toBe('user')
    expect(bounded.messages.at(-1)?.content).toContain('hello')
  })
})
