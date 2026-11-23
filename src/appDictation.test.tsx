// @vitest-environment jsdom
// Dictation (the 🎤 button beside Send) failed SILENTLY in the field (owner test 2026-11-22):
// click, second click, and a 3 s hold produced zero reaction. Root cause pinned in App.tsx:
// rec.onerror discarded the error event and only reset state, the start() catch was silent,
// and the only listening feedback was the button's own background color — so in any
// environment where recognition errors immediately (mic blocked, no mic, no network speech
// service) the state flipped true→false within a frame and the user saw nothing at all.
// These tests pin the fix: a visible Listening status while dictating, the transcript landing
// in the composer, and a visible plain-language message for every failure path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

type ResultEvent = { results: Array<Array<{ transcript: string }>> }
type ErrorEvent = { error?: string }

class FakeRecognition {
  static instances: FakeRecognition[] = []
  static behavior: 'ok' | 'error-not-allowed' | 'error-audio-capture' | 'error-service-not-allowed' | 'throw' = 'ok'
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((event: ResultEvent) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  started = false
  stopped = false
  constructor() { FakeRecognition.instances.push(this) }
  start() {
    if (FakeRecognition.behavior === 'throw') throw new Error('InvalidStateError')
    this.started = true
    if (FakeRecognition.behavior === 'error-not-allowed') this.onerror?.({ error: 'not-allowed' })
    if (FakeRecognition.behavior === 'error-audio-capture') this.onerror?.({ error: 'audio-capture' })
    if (FakeRecognition.behavior === 'error-service-not-allowed') this.onerror?.({ error: 'service-not-allowed' })
  }
  stop() { this.stopped = true; this.onend?.() }
  emitResult(transcript: string) { this.onresult?.({ results: [[{ transcript }]] }) }
}

class ThrowingRecognition {
  constructor() { throw new Error('construction is not supported in this WebView') }
}

/** The iOS-shaped recorder (MP4 only) + a working mic, for the fallback tests. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }
  static isTypeSupported(type: string) { return type === 'audio/mp4' }
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: 'audio/mp4' }) }); this.onstop?.() }
}

function stubRecorder() {
  FakeMediaRecorder.instances = []
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: FakeMediaRecorder })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, writable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } })
}

beforeEach(() => {
  localStorage.clear()
  FakeRecognition.instances = []
  FakeRecognition.behavior = 'ok'
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: FakeRecognition })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.resetModules()
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
})

describe('dictation button', () => {
  it('starts dictation with a VISIBLE listening status and types the transcript into the composer', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const rec = FakeRecognition.instances[0]
    expect(rec).toBeTruthy()
    expect(rec.started).toBe(true)
    // The listening state is words on screen, not just a button color.
    expect(await screen.findByText(/Listening… speak now/)).toBeTruthy()
    act(() => rec.emitResult('hello from dictation'))
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    expect(composer.value).toBe('hello from dictation')
  }, 20000)

  it('stops dictation on the second tap and clears the listening status', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Listening… speak now/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }))
    expect(FakeRecognition.instances[0].stopped).toBe(true)
    expect(screen.queryByText(/Listening… speak now/)).toBeNull()
  })

  it('surfaces a VISIBLE message when the microphone is blocked — never silence', async () => {
    FakeRecognition.behavior = 'error-not-allowed'
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Microphone is blocked/)
    expect(screen.queryByText(/Listening… speak now/)).toBeNull()
  })

  it('surfaces a VISIBLE message when there is no microphone', async () => {
    FakeRecognition.behavior = 'error-audio-capture'
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/No microphone found/)
  })

  it('stops dictation when the message is sent, so the sent text cannot resurrect in the composer', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const rec = FakeRecognition.instances[0]
    act(() => rec.emitResult('dictated words'))
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    expect(composer.value).toBe('dictated words')
    fireEvent.click(screen.getByRole('button', { name: /^SEND$/i }))
    expect(rec.stopped).toBe(true)
    expect(composer.value).toBe('')
    // A late result from the dead session must not write the sent text back.
    act(() => rec.emitResult('dictated words'))
    expect(composer.value).toBe('')
  })

  it('stops the recognizer when the composer unmounts — the mic never stays hot', async () => {
    const { default: App } = await import('./App')
    const { unmount } = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Listening… speak now/)).toBeTruthy()
    unmount()
    expect(FakeRecognition.instances[0].stopped).toBe(true)
  })

  it('surfaces a VISIBLE message when recognition start() itself throws', async () => {
    FakeRecognition.behavior = 'throw'
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Dictation couldn't start/)
  })

  it('falls back to RECORDING when the speech service is a dead end (Android WebView shape)', async () => {
    // webkitSpeechRecognition exists but every session dies with service-not-allowed:
    // retrying dictation can never work, so the button must take the working route.
    FakeRecognition.behavior = 'error-service-not-allowed'
    localStorage.setItem('gh_token', 'test-token')
    stubRecorder()
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Recording… speak now/)).toBeTruthy()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  }, 20000)

  it('falls back to RECORDING when the recognition constructor itself throws (embedded WebView shape)', async () => {
    localStorage.setItem('gh_token', 'test-token')
    stubRecorder()
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: ThrowingRecognition })
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Recording… speak now/)).toBeTruthy()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
  }, 20000)

  it('still explains plainly when the constructor throws and NO fallback can run', async () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: ThrowingRecognition })
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Dictation couldn't start/)
  }, 20000)

  it('a stale session\'s late error/end cannot kill the live session', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const first = FakeRecognition.instances[0]
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    const second = FakeRecognition.instances[1]
    expect(await screen.findByText(/Listening… speak now/)).toBeTruthy()
    // The dead session reports in late — neither event may touch the live session.
    act(() => { first.onerror?.({ error: 'audio-capture' }); first.onend?.() })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/Listening… speak now/)).toBeTruthy()
    act(() => second.emitResult('second session words'))
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    expect(composer.value).toBe('second session words')
  }, 20000)
})
