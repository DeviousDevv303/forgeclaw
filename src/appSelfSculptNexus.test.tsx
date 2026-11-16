// @vitest-environment jsdom
// App-level Nexus coverage: direct sculpt commands and the Nexus -> Qwen self-sculpt handoff.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type ToolCallLike = { id?: string; name: string; input: Record<string, unknown> }
type ToolContextLike = { actor?: string; providerId?: string; actingProvider?: string }
const executeCalls: Array<{ call: ToolCallLike; ctx: ToolContextLike }> = []

const ORIGINAL = 'export const value = 1\n'
const UPDATED = '/** improved */\nexport const value = 1\n'
const READ_RESULT = `File: src/example.ts (${ORIGINAL.length} bytes)\n\`\`\`\n${ORIGINAL}\n\`\`\``
const QWEN_RESULT = `✓ Qwen/Qwen3-8B completed as test-run on DeviousDevv303/forgeclaw@main.\nStages: rewrite=completed.\nRun: https://github.com/DeviousDevv303/forgeclaw/actions/runs/1\n\n\`\`\`ts\n${UPDATED}\`\`\``
const NEXUS_RESULT = '✓ Nexus Intelligence completed as test-run on DeviousDevv303/forgeclaw@main.\n' +
  'Stages: dispatch=accepted; checkpoint=nexus-run25-sha256-c41852fb0ac1.\n' +
  'Run: https://github.com/DeviousDevv303/forgeclaw/actions/runs/2\n\n' +
  '<|ev:verified|><|answer|>A concise answer from Nexus Intelligence.<|/answer|><|end|>'

const originalDescriptors: Array<{ target: object; key: PropertyKey; descriptor?: PropertyDescriptor }> = []
function preserveDescriptor(target: object, key: PropertyKey) {
  originalDescriptors.push({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) })
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  localStorage.setItem('fm_provider', 'nexus-intelligence')
  // The key itself is never needed by these tests; the persisted unlocked flag gates tool exposure.
  localStorage.setItem('fc_sculpt_key_v1', JSON.stringify({ salt: 'test-salt', hash: 'test-hash', iterations: 1 }))
  localStorage.setItem('fc_sculpt_unlocked_v1', '1')
  executeCalls.length = 0

  vi.doMock('./lib/forgeTools', async (load) => {
    const actual = await load<typeof import('./lib/forgeTools')>()
    return {
      ...actual,
      executeTool: async (call: ToolCallLike, ctx: ToolContextLike) => {
        executeCalls.push({ call, ctx })
        switch (call.name) {
          case 'github_read_file': return READ_RESULT
          case 'qwen_reason': return QWEN_RESULT
          case 'sculpt_self': return '✓ Self-sculpt build-validated and proposed as pull request #2'
          case 'shell_patch': return '✓ Shell patch build-validated and proposed as pull request #1'
          case 'nexus_reason': return NEXUS_RESULT
          default: return `[TOOL ERROR] Unexpected test tool: ${call.name}`
        }
      },
    }
  })

  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  for (const [target, key] of [
    [window, 'matchMedia'],
    [window, 'speechSynthesis'],
    [navigator, 'languages'],
    [HTMLCanvasElement.prototype, 'getContext'],
    [Element.prototype, 'scrollIntoView'],
  ] as Array<[object, PropertyKey]>) preserveDescriptor(target, key)
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const { target, key, descriptor } of originalDescriptors.splice(0).reverse()) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
  vi.doUnmock('./lib/forgeTools')
  vi.resetModules()
})

async function renderNexusAppAndSubmit(prompt: string) {
  const { default: App } = await import('./App')
  render(<App />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: prompt } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('Nexus self-sculpt routing in App', () => {
  it('dispatches a typed /patch with its one-line reason and unified diff to shell_patch', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-export const value = 1\n+export const value = 2'
    await renderNexusAppAndSubmit(`/patch update the example value\n${patch}`)

    await waitFor(() => expect(executeCalls.some(({ call }) => call.name === 'shell_patch')).toBe(true), { timeout: 8000 })
    expect(executeCalls.map(({ call }) => call.name)).toEqual(['shell_patch'])
    expect(executeCalls[0].call.input).toEqual({ patch: `${patch}\n`, reason: 'update the example value' })
    expect(executeCalls[0].ctx).toMatchObject({ providerId: 'nexus-intelligence', actingProvider: 'operator' })
  }, 20000)

  it('routes typed /sculpt through github_read_file, qwen_reason, and sculpt_self', async () => {
    await renderNexusAppAndSubmit('/sculpt src/example.ts add a documentation comment')

    await waitFor(() => expect(executeCalls.some(({ call }) => call.name === 'sculpt_self')).toBe(true), { timeout: 8000 })
    expect(executeCalls.map(({ call }) => call.name)).toEqual(['github_read_file', 'qwen_reason', 'sculpt_self'])
    expect(executeCalls[0].call.input).toEqual({ path: 'src/example.ts' })
    expect(executeCalls[1].call.input).toMatchObject({ profile: 'code', nexus_learn: true })
    expect(executeCalls[2].call.input).toMatchObject({ file_path: 'src/example.ts', content: UPDATED, before_content: ORIGINAL })
    expect(executeCalls.every(({ ctx }) => ctx.providerId === 'nexus-intelligence')).toBe(true)
  }, 20000)

  it('hands natural-language improve requests to Qwen and preserves selected-provider provenance', async () => {
    await renderNexusAppAndSubmit('improve src/example.ts by adding a short documentation comment')

    await waitFor(() => expect(executeCalls.some(({ call }) => call.name === 'sculpt_self')).toBe(true), { timeout: 8000 })
    expect(executeCalls.map(({ call }) => call.name)).toEqual(['github_read_file', 'qwen_reason', 'sculpt_self'])
    expect(executeCalls.every(({ ctx }) => ctx.providerId === 'nexus-intelligence')).toBe(true)
    expect(executeCalls.filter(({ call }) => call.name === 'qwen_reason').every(({ ctx }) => ctx.actingProvider === 'qwen')).toBe(true)
    expect(executeCalls[1].ctx).toMatchObject({ providerId: 'nexus-intelligence', actingProvider: 'qwen' })
    expect(executeCalls[2].call.input).toMatchObject({ file_path: 'src/example.ts', content: UPDATED, before_content: ORIGINAL })
  }, 20000)

  it('dispatches an ordinary Nexus request to nexus_reason only', async () => {
    await renderNexusAppAndSubmit('Give me a brief overview of your capabilities.')

    await waitFor(() => expect(executeCalls.some(({ call }) => call.name === 'nexus_reason')).toBe(true), { timeout: 8000 })
    expect(executeCalls.map(({ call }) => call.name)).toEqual(['nexus_reason'])
    expect(executeCalls.some(({ call }) => ['github_read_file', 'qwen_reason', 'sculpt_self', 'shell_patch'].includes(call.name))).toBe(false)
    expect(executeCalls[0].ctx).toMatchObject({ providerId: 'nexus-intelligence', actingProvider: 'nexus-intelligence' })
  }, 20000)
})
