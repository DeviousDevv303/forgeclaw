// @vitest-environment jsdom
// Voice-to-text (owner request 2026-11-22: ForgeClaw must "understand audio… voice to text…
// whichever or both"). Two paths, one transcription engine (audio-transcribe.yml):
//  A) No Web Speech API in the browser → the mic button records with MediaRecorder and the
//     transcript lands in the composer (this test stubs NO SpeechRecognition, and a recorder
//     that only accepts audio/mp4 — the iOS Safari shape).
//  B) An attached audio file is transcribed on send, and the labeled transcript is the
//     message every text-only provider receives.
// Every failure must be VISIBLE under the composer — the dictation bug this follows was silence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const API = 'https://api.github.com/repos/DeviousDevv303/forgeclaw'
const TRANSCRIPT = 'hola, esto es una nota de voz'
const flow = { fail: false }
let invocationId = ''

function githubFetch(url: string, init: RequestInit = {}) {
  if (url === `${API}/git/ref/heads/audio-inputs`) return new Response('{}', { status: 404 })
  if (url === `${API}/git/blobs`) return Response.json({ sha: 'blob1' })
  if (url === `${API}/git/trees`) return Response.json({ sha: 'tree1' })
  if (url === `${API}/git/commits`) return Response.json({ sha: 'commit1' })
  if (url === `${API}/git/refs`) return Response.json({})
  if (url.endsWith('/actions/workflows/audio-transcribe.yml/dispatches')) {
    invocationId = String(((JSON.parse(String(init.body)) as { inputs: Record<string, string> }).inputs).invocation_id)
    return new Response(null, { status: 204 })
  }
  if (url.includes('/actions/workflows/audio-transcribe.yml/runs')) {
    return Response.json({ workflow_runs: [{ id: 7, name: 'Transcribe Audio', event: 'workflow_dispatch', head_branch: 'main', display_title: `Transcribe Audio ${invocationId}`, created_at: new Date().toISOString(), status: 'completed', conclusion: flow.fail ? 'failure' : 'success', run_number: 4, html_url: 'https://github.com/o/r/actions/runs/7' }] })
  }
  if (url.endsWith(`/contents/audio-results/${invocationId}.txt?ref=audio-results`)) return new Response(flow.fail ? 'TRANSCRIPTION FAILED (failure); see the run log.' : TRANSCRIPT)
  if (url.endsWith(`/contents/audio-results/${invocationId}.meta.txt?ref=audio-results`)) return new Response('model=Systran/faster-whisper-small\nlanguage=es\n')
  return new Response('{}', { status: 404 })
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state = 'inactive'
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? ''
    FakeMediaRecorder.instances.push(this)
  }
  static isTypeSupported(type: string) { return type === 'audio/mp4' } // iOS Safari's answer
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: 'audio/mp4' }) })
    this.onstop?.()
  }
}

beforeEach(() => {
  localStorage.clear()
  flow.fail = false
  invocationId = ''
  FakeMediaRecorder.instances = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => githubFetch(String(url), init)))
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  Element.prototype.scrollIntoView = () => {}
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: { getVoices: () => [], speak() {}, cancel() {}, pause() {}, resume() {}, onvoiceschanged: null } })
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: FakeMediaRecorder })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, writable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } })
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
  // Deliberately NO SpeechRecognition / webkitSpeechRecognition: that absence is the test.
})
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.resetModules()
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
})

describe('record-and-transcribe fallback (no Web Speech API)', () => {
  it('records with MediaRecorder and lands the transcript in the composer', async () => {
    localStorage.setItem('gh_token', 'test-token')
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    // The recording state is words on screen, and the recorder took the iOS format.
    expect(await screen.findByText(/Recording… speak now/)).toBeTruthy()
    expect(FakeMediaRecorder.instances).toHaveLength(1)
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/mp4')
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toBe(TRANSCRIPT), { timeout: 15000 })
    expect(screen.queryByText(/Recording… speak now/)).toBeNull()
  }, 30000)

  it('surfaces a VISIBLE message when transcription fails — never silence', async () => {
    localStorage.setItem('gh_token', 'test-token')
    flow.fail = true
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    expect(await screen.findByText(/Recording… speak now/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    const alert = await screen.findByRole('alert', {}, { timeout: 15000 })
    expect(alert.textContent).toMatch(/Transcription failed/)
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    expect(composer.value).toBe('')
  }, 30000)

  it('explains plainly when there is no GitHub token instead of dying silently', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/needs a GitHub token/)
    expect(FakeMediaRecorder.instances).toHaveLength(0) // it never even started recording
  }, 30000)
})

describe('attached voice message (Path B)', () => {
  it('transcribes the clip on send and the labeled transcript is the message sent', async () => {
    localStorage.setItem('gh_token', 'test-token')
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const memo = new File(['fake-audio'], 'Voice Memo.m4a', { type: 'audio/x-m4a' })
    fireEvent.change(fileInput, { target: { files: [memo] } })
    expect(await screen.findByText(/Voice Memo\.m4a/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^SEND$/i }))
    // The user's message carries the transcript, labeled as a voice-message transcript.
    expect(await screen.findByText(/\[Voice message: Voice Memo\.m4a — transcript by faster-whisper small/), ).toBeTruthy()
    expect(await screen.findByText(new RegExp(TRANSCRIPT))).toBeTruthy()
  }, 30000)

  it('does NOT send when transcription fails — the failure is visible and the text stays', async () => {
    localStorage.setItem('gh_token', 'test-token')
    flow.fail = true
    const { default: App } = await import('./App')
    const { container } = render(<App />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['fake-audio'], 'Voice Memo.m4a', { type: 'audio/x-m4a' })] } })
    expect(await screen.findByText(/Voice Memo\.m4a/)).toBeTruthy()
    const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'escucha esto' } })
    fireEvent.click(screen.getByRole('button', { name: /^SEND$/i }))
    const alert = await screen.findByRole('alert', {}, { timeout: 15000 })
    expect(alert.textContent).toMatch(/Transcription failed/)
    // Nothing was sent: the typed text and the attachment are still right there to retry.
    expect(composer.value).toBe('escucha esto')
    expect(screen.getByText(/Voice Memo\.m4a/)).toBeTruthy()
    expect(screen.queryByText(/\[Voice message:/)).toBeNull()
  }, 30000)
})

describe('family mode (relay tier)', () => {
  it('attempts transcription through the relay family tier with a family code and no token', async () => {
    vi.stubEnv('VITE_PUBLIC_RELAY_URL', 'https://relay.example')
    try {
      localStorage.setItem('forgeclaw_family_code', 'test-family-code')
      const calls: Array<{ url: string; authorization: string | null }> = []
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), authorization: new Headers(init?.headers).get('Authorization') })
        return githubFetch(String(url), init)
      }))
      const { default: App } = await import('./App')
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: 'Dictate' }))
      // The guard passes on the family code alone: recording starts, no needs-a-token alert.
      expect(await screen.findByText(/Recording… speak now/)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
      const composer = screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement
      await waitFor(() => expect(composer.value).toBe(TRANSCRIPT), { timeout: 15000 })
      // The dispatch went to the relay's family tier, carrying the family code as its Bearer.
      const dispatch = calls.find(c => c.url.endsWith('/actions/workflows/audio-transcribe.yml/dispatches'))!
      expect(dispatch.url).toBe('https://relay.example/v1/family/repos/DeviousDevv303/forgeclaw/actions/workflows/audio-transcribe.yml/dispatches')
      expect(dispatch.authorization).toBe('Bearer test-family-code')
    } finally {
      vi.unstubAllEnvs()
    }
  }, 30000)
})
