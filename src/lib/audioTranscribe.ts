// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Speech-to-text on GitHub Actions (faster-whisper) ──────────────────────
// ForgeClaw's providers are text models: none of them hears audio. A recorded or attached
// clip is committed to the audio-inputs branch, audio-transcribe.yml transcribes it with
// faster-whisper "small" on the CPU runner, and the transcript is read back from the
// audio-results branch (artifact zips are not readable from the browser). The workflow's
// mirror job removes the clip from audio-inputs once it has been transcribed. Same shape
// as visionInput.ts, one transcription engine for both voice paths (recorded dictation
// fallback and attached voice messages).

import type { GithubRequest } from './githubPublish'
import { audioDataUrlBytes, MAX_AUDIO_BYTES, parseAudioDataUrl } from './audioInput'
import { dispatchAndWait, newInvocationId } from './workflowRun'

export const AUDIO_TRANSCRIBE_WORKFLOW = 'audio-transcribe.yml'
export const AUDIO_INPUT_BRANCH = 'audio-inputs'
export const AUDIO_RESULT_BRANCH = 'audio-results'
/** Model download + load + transcription on the free CPU runner; an 11 s clip measured ~12 s locally. */
export const AUDIO_MAX_WAIT_MS = 20 * 60 * 1000
export const TRANSCRIBE_MODEL_LABEL = 'faster-whisper small (GitHub Actions, CPU)'

async function githubJson<T>(request: GithubRequest, url: string, token: string, step: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, { ...init, headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`${step} failed: GitHub ${res.status}${body.message ? ` ${body.message}` : ''}`)
  }
  return await res.json() as T
}

/** Commit the clip to audio-inputs/<invocationId>.<ext>; returns that path. Creates the branch (orphan) on first use. */
export async function uploadAudioInput(request: GithubRequest, input: { owner: string; repo: string; token: string; invocationId: string; dataUrl: string }): Promise<string> {
  const audio = parseAudioDataUrl(input.dataUrl)
  if (!audio) throw new Error('the attached file is not a supported audio clip (WebM, MP4, M4A, MP3, WAV, OGG, FLAC or AAC)')
  if (audioDataUrlBytes(input.dataUrl) > MAX_AUDIO_BYTES) throw new Error(`the audio is larger than ${MAX_AUDIO_BYTES / (1024 * 1024)} MB — record or attach a shorter clip`)
  const base = `https://api.github.com/repos/${input.owner}/${input.repo}`
  const path = `${AUDIO_INPUT_BRANCH}/${input.invocationId}.${audio.extension}`
  const blob = await githubJson<{ sha: string }>(request, `${base}/git/blobs`, input.token, 'uploading the audio', { method: 'POST', body: JSON.stringify({ content: audio.data, encoding: 'base64' }) })
  for (let attempt = 0; attempt < 3; attempt++) {
    const refRes = await request(`${base}/git/ref/heads/${AUDIO_INPUT_BRANCH}`, { headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    if (!refRes.ok && refRes.status !== 404) throw new Error(`reading the ${AUDIO_INPUT_BRANCH} branch failed: GitHub ${refRes.status}`)
    const parent = refRes.ok ? (await refRes.json() as { object: { sha: string } }).object.sha : undefined
    const baseTree = parent ? (await githubJson<{ tree: { sha: string } }>(request, `${base}/git/commits/${parent}`, input.token, 'reading the branch tip')).tree.sha : undefined
    const tree = await githubJson<{ sha: string }>(request, `${base}/git/trees`, input.token, 'building the commit', { method: 'POST', body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] }) })
    const commit = await githubJson<{ sha: string }>(request, `${base}/git/commits`, input.token, 'committing the audio', { method: 'POST', body: JSON.stringify({ message: `audio: clip for ${input.invocationId}`, tree: tree.sha, parents: parent ? [parent] : [] }) })
    const update = parent
      ? await request(`${base}/git/refs/heads/${AUDIO_INPUT_BRANCH}`, { method: 'PATCH', headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: false }) })
      : await request(`${base}/git/refs`, { method: 'POST', headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${AUDIO_INPUT_BRANCH}`, sha: commit.sha }) })
    if (update.ok) return path
    // 422: another upload moved the branch (or created it) first; rebuild on the new tip.
    if (update.status !== 422) throw new Error(`updating the ${AUDIO_INPUT_BRANCH} branch failed: GitHub ${update.status} (the token needs Contents: write)`)
  }
  throw new Error(`the ${AUDIO_INPUT_BRANCH} branch kept moving; try again`)
}

export interface AudioTranscriptionInput {
  owner: string
  repo: string
  token: string
  /** The clip as a base64 data URL (recorded in the composer or attached to the message). */
  audio: string
  /** Language code ('en', 'es', …); empty auto-detects. */
  language?: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function runAudioTranscription(request: GithubRequest, input: AudioTranscriptionInput): Promise<{ transcript: string; model: string; language: string; runUrl: string; invocationId: string }> {
  if (!parseAudioDataUrl(input.audio)) throw new Error('transcription needs an attached audio clip (WebM, MP4, M4A, MP3, WAV, OGG, FLAC or AAC)')
  const invocationId = newInvocationId('audio')
  const audioRef = await uploadAudioInput(request, { owner: input.owner, repo: input.repo, token: input.token, invocationId, dataUrl: input.audio })
  const run = await dispatchAndWait(request, {
    owner: input.owner, repo: input.repo, token: input.token, workflow: AUDIO_TRANSCRIBE_WORKFLOW,
    inputs: { audio_ref: audioRef, language: (input.language ?? '').trim().toLowerCase(), invocation_id: invocationId },
    invocationId, maxWaitMs: AUDIO_MAX_WAIT_MS, signal: input.signal, sleep: input.sleep, now: input.now,
  })
  const read = async (file: string) => request(`https://api.github.com/repos/${input.owner}/${input.repo}/contents/${AUDIO_RESULT_BRANCH}/${file}?ref=${AUDIO_RESULT_BRANCH}`, {
    headers: { Authorization: `token ${input.token}`, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store',
  })
  const res = await read(`${invocationId}.txt`)
  if (!res.ok) throw new Error(`audio transcription run #${run.run_number} concluded "${run.conclusion}" and its transcript could not be read (GitHub ${res.status}). Logs: ${run.html_url}`)
  const transcript = (await res.text()).trim()
  if (run.conclusion !== 'success' || !transcript || /^TRANSCRIPTION FAILED/.test(transcript)) throw new Error(`audio transcription run #${run.run_number} failed (${run.conclusion}). Logs: ${run.html_url}`)
  const meta = await read(`${invocationId}.meta.txt`).then(r => r.ok ? r.text() : '').catch(() => '')
  const model = /^model=(.+)$/m.exec(meta)?.[1] || 'Systran/faster-whisper-small'
  const language = /^language=(.+)$/m.exec(meta)?.[1] || ''
  return { transcript, model, language, runUrl: run.html_url, invocationId }
}

/**
 * How an attached voice message reaches every (text-only) provider: the transcript IS the
 * message, labeled as a voice-message transcript so the model knows it was spoken.
 */
export function formatVoiceMessageTranscript(name: string, transcript: string): string {
  return `[Voice message: ${name} — transcript by ${TRANSCRIBE_MODEL_LABEL}]\n\n${transcript}`
}
