// @vitest-environment jsdom
// A typed operator shell command (pwd, git diff, grep ...) is dispatched without a model turn, so the
// result bubble must not be stamped with the active provider/model. Found in the 2026-11-13 audit: under
// Nexus Intelligence a direct `pwd` result was labelled "nexus-intelligence · nexus-run25" although no
// model ran, which misattributes tool output to the model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type ToolCallLike = { name: string; input: { command?: string } }
const executeCalls: Array<{ call: ToolCallLike; ctx: { actor?: string } }> = []

beforeEach(() => {
  vi.resetModules()
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
describe('direct shell result provenance', () => {
  it.each(['nexus-intelligence', 'moonshot'])('does not attribute a typed shell result to the %s model', async (provider) => {
    localStorage.setItem('fm_provider', provider)
    const { default: App } = await import('./App')
    render(<App />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'pwd' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(executeCalls.some(c => c.call.name === 'shell_exec')).toBe(true), { timeout: 8000 })
    expect(executeCalls[0].call.input.command).toBe('pwd')
    await screen.findByText(/operator shell output/, {}, { timeout: 8000 })
    // The per-message label is "<provider> · <model>"; none may be rendered for a tool-only result.
    expect(screen.queryByText(/^nexus-intelligence · nexus-run25$/)).toBeNull()
    expect(screen.queryByText(new RegExp(`^${provider} · `))).toBeNull()
  }, 20000)
})
