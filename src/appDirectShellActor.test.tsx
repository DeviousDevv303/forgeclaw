// @vitest-environment jsdom
// The composer's forced-shell path (/shell <cmd>) is the operator's own hand: it must execute
// with actor 'operator', matching both the explicit-tool path and the corpus record the shell
// block itself writes (actor: 'operator'). Before the fix the block passed the bare toolCtx,
// so executor provenance and the corpus record disagreed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type ToolCallLike = { name: string; input: { command?: string } }
const executeCalls: Array<{ call: ToolCallLike; ctx: { actor?: string } }> = []

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gh_token', 'test-token')
  executeCalls.length = 0
  vi.doMock('./lib/forgeTools', async (load) => {
    const actual = await load<typeof import('./lib/forgeTools')>()
    return {
      ...actual,
      executeTool: async (call: ToolCallLike, ctx: { actor?: string }) => {
        executeCalls.push({ call, ctx })
        return 'operator shell output'
      },
    }
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('./lib/forgeTools'); vi.resetModules() })

describe('composer forced-shell dispatch', () => {
  it('executes a /shell command with actor operator', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '/shell echo hello' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(executeCalls.some(c => c.call.name === 'shell_exec')).toBe(true), { timeout: 8000 })
    const shellCall = executeCalls.find(c => c.call.name === 'shell_exec')!
    expect(shellCall.call.input.command).toBe('echo hello')
    expect(shellCall.ctx.actor).toBe('operator')
  }, 20000)
})
