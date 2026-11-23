// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Audio clips the app can transcribe ─────────────────────────────────────
// The browser-side half of voice-to-text: which clips count as audio, how a recorded
// or attached clip becomes a data URL, and which MediaRecorder format to ask for.
// The transcription itself runs on GitHub Actions (see audioTranscribe.ts).

/** Clips are voice notes, not podcasts: 10 MB covers ~20 minutes of Opus and bounds the upload. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
}

const EXTENSION_LIST = Object.values(EXTENSIONS).filter((v, i, a) => a.indexOf(v) === i)

/** The file extension for a supported audio media type (codec parameters stripped), else null. */
export function audioExtensionForMediaType(mediaType: string): string | null {
  return EXTENSIONS[mediaType.toLowerCase().split(';')[0].trim()] ?? null
}

/** The file extension of a name like "Voice Memo.m4a" when it names a supported clip, else null. */
export function audioExtensionForName(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? ''
  return EXTENSION_LIST.includes(ext) ? ext : null
}

/** Parse a base64 audio data URL. The media type must be one the transcription workflow accepts. */
export function parseAudioDataUrl(url: string): { mediaType: string; data: string; extension: string } | null {
  const match = /^data:(audio\/[a-z0-9+.-]+(?:;[a-z0-9=.-]+)*);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url.trim())
  if (!match) return null
  const mediaType = match[1].toLowerCase()
  const extension = audioExtensionForMediaType(mediaType)
  if (!extension) return null
  return { mediaType, data: match[2].replace(/\s+/g, ''), extension }
}

/** Approximate decoded byte size of a base64 data URL payload. */
export function audioDataUrlBytes(dataUrl: string): number {
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/\s+/g, '')
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

/**
 * An attached file is an audio clip when its content is an audio data URL — or when the
 * file name says so: iOS hands over voice memos (.m4a) with an empty or generic type, so
 * the content can arrive as an application/octet-stream data URL or even as raw text.
 */
export function isAudioAttachment(file: { name: string }, content: string): boolean {
  if (content.startsWith('data:audio/')) return parseAudioDataUrl(content) !== null
  if (content.startsWith('data:image')) return false
  return audioExtensionForName(file.name) !== null
}

/** MediaRecorder + getUserMedia both present (the record-and-transcribe fallback can run). */
export function recorderSupported(win: unknown, nav: unknown): boolean {
  const w = win as { MediaRecorder?: unknown } | null | undefined
  const n = nav as { mediaDevices?: { getUserMedia?: unknown } } | null | undefined
  return Boolean(w && typeof w.MediaRecorder === 'function' && n?.mediaDevices && typeof n.mediaDevices.getUserMedia === 'function')
}

/**
 * The MediaRecorder mime type to request, best first. Chrome records WebM/Opus; iOS Safari
 * (14.1+) records MP4/AAC and rejects the WebM types — the workflow decodes both. '' means
 * "the browser's default", for recorders with no isTypeSupported.
 */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string {
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']) {
    try {
      if (isTypeSupported(candidate)) return candidate
    } catch {
      // A recorder that throws on a probe gets the browser default below.
      return ''
    }
  }
  return ''
}

/**
 * Recognition error codes that mean the speech SERVICE is unusable in this browser, as
 * opposed to a problem with the mic or the speech: embedded Android WebViews expose
 * webkitSpeechRecognition but every session dies with 'service-not-allowed', and a
 * language the service does not carry never starts. Retrying Web Speech cannot fix
 * either — the record-and-transcribe path is the working route there.
 */
export function recognitionServiceDeadEnd(code: string): boolean {
  return code === 'service-not-allowed' || code === 'language-not-supported'
}

/** Which plain-language mic message a getUserMedia failure deserves. */
export type MicErrorKind = 'blocked' | 'noMic' | 'busy' | 'failed'

/**
 * getUserMedia rejects with DOMExceptions whose NAME is the diagnosis: a permission
 * denial is not a missing mic, and neither is a mic another app is holding. Mapping
 * every failure to "blocked" (the old behavior) sends users to the wrong fix.
 */
export function micErrorKind(error: unknown): MicErrorKind {
  const name = (error as { name?: unknown } | null | undefined)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'blocked'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'noMic'
    case 'NotReadableError':
    case 'AbortError':
      return 'busy'
    default:
      return 'failed'
  }
}

/** Read a recorded Blob as a data URL (what the transcription upload consumes). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('reading the recording failed'))
    reader.readAsDataURL(blob)
  })
}
