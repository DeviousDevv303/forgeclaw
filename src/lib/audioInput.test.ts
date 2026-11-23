import { describe, expect, it } from 'vitest'
import {
  audioDataUrlBytes,
  audioExtensionForMediaType,
  audioExtensionForName,
  isAudioAttachment,
  parseAudioDataUrl,
  pickRecorderMimeType,
  recorderSupported,
} from './audioInput'

const MP4 = 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t'
const WEBM_OPUS = 'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAA'

describe('audio data URLs', () => {
  it('parses the formats the transcription workflow accepts', () => {
    expect(parseAudioDataUrl(MP4)).toEqual({ mediaType: 'audio/mp4', data: 'AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t', extension: 'mp4' })
    expect(parseAudioDataUrl(WEBM_OPUS)?.extension).toBe('webm')
    expect(parseAudioDataUrl('data:audio/x-m4a;base64,AAAA')?.extension).toBe('m4a')
    expect(parseAudioDataUrl('data:audio/mpeg;base64,AAAA')?.extension).toBe('mp3')
    expect(parseAudioDataUrl('data:audio/wav;base64,AAAA')?.extension).toBe('wav')
    expect(parseAudioDataUrl('data:audio/ogg;base64,AAAA')?.extension).toBe('ogg')
  })

  it('rejects non-audio and unsupported data URLs', () => {
    expect(parseAudioDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
    expect(parseAudioDataUrl('data:audio/aiff;base64,AAAA')).toBeNull()
    expect(parseAudioDataUrl('data:text/plain;base64,AAAA')).toBeNull()
    expect(parseAudioDataUrl('https://example.com/clip.mp3')).toBeNull()
    expect(parseAudioDataUrl('not a data url')).toBeNull()
  })

  it('measures the decoded size of a payload', () => {
    expect(audioDataUrlBytes('data:audio/mp4;base64,AAAA')).toBe(3)
    expect(audioDataUrlBytes('data:audio/mp4;base64,AAA=')).toBe(2)
    expect(audioDataUrlBytes('data:audio/mp4;base64,AA==')).toBe(1)
  })
})

describe('audio attachment detection', () => {
  it('accepts audio data URLs', () => {
    expect(isAudioAttachment({ name: 'clip' }, MP4)).toBe(true)
    expect(isAudioAttachment({ name: 'clip.webm' }, WEBM_OPUS)).toBe(true)
  })

  it('accepts an iOS voice memo whose content lost its audio type, by file name', () => {
    // Voice memos arrive as .m4a with an empty/generic type: the reader may hand back an
    // octet-stream data URL or the raw bytes as text. The name is the evidence left.
    expect(isAudioAttachment({ name: 'Voice Memo.m4a' }, 'data:application/octet-stream;base64,AAAA')).toBe(true)
    expect(isAudioAttachment({ name: 'note.MP3' }, 'raw bytes read as text')).toBe(true)
  })

  it('does not steal images or ordinary files', () => {
    expect(isAudioAttachment({ name: 'photo.jpg' }, 'data:image/jpeg;base64,/9j/AAAA')).toBe(false)
    expect(isAudioAttachment({ name: 'notes.txt' }, 'hello')).toBe(false)
    expect(isAudioAttachment({ name: 'song.aiff' }, 'data:audio/aiff;base64,AAAA')).toBe(false)
  })
})

describe('recorder support and format choice', () => {
  it('needs both MediaRecorder and getUserMedia', () => {
    expect(recorderSupported({ MediaRecorder: class {} }, { mediaDevices: { getUserMedia: () => {} } })).toBe(true)
    expect(recorderSupported({}, { mediaDevices: { getUserMedia: () => {} } })).toBe(false)
    expect(recorderSupported({ MediaRecorder: class {} }, {})).toBe(false)
    expect(recorderSupported(null, null)).toBe(false)
  })

  it('prefers WebM/Opus where offered (Chrome) and falls back to MP4 (iOS Safari)', () => {
    expect(pickRecorderMimeType(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMimeType(t => t === 'audio/mp4')).toBe('audio/mp4')
    expect(pickRecorderMimeType(() => false)).toBe('')
    expect(pickRecorderMimeType(() => { throw new Error('nope') })).toBe('')
  })

  it('maps media types and names to workflow extensions', () => {
    expect(audioExtensionForMediaType('audio/webm;codecs=opus')).toBe('webm')
    expect(audioExtensionForMediaType('AUDIO/MP4')).toBe('mp4')
    expect(audioExtensionForMediaType('audio/aiff')).toBeNull()
    expect(audioExtensionForName('Voice Memo.m4a')).toBe('m4a')
    expect(audioExtensionForName('clip.WAV')).toBe('wav')
    expect(audioExtensionForName('archive.tar.gz')).toBeNull()
    expect(audioExtensionForName('noextension')).toBeNull()
  })
})
