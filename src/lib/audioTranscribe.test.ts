import { describe, expect, it } from 'vitest'
import { formatVoiceMessageTranscript, runAudioTranscription, uploadAudioInput } from './audioTranscribe'

const API = 'https://api.github.com/repos/o/r'
const MP4 = 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t'

function github(opts: { branchExists?: boolean; conflictOnce?: boolean; conclusion?: string; transcript?: string } = {}) {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
  let conflicts = opts.conflictOnce ? 1 : 0
  let invocationId = ''
  const request = async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ url, method, body })
    if (url === `${API}/git/ref/heads/audio-inputs`) return opts.branchExists ? Response.json({ object: { sha: 'tip' } }) : new Response('{}', { status: 404 })
    if (url === `${API}/git/commits/tip`) return Response.json({ tree: { sha: 'tiptree' } })
    if (url === `${API}/git/blobs`) return Response.json({ sha: 'blob1' })
    if (url === `${API}/git/trees`) return Response.json({ sha: 'tree1' })
    if (url === `${API}/git/commits`) return Response.json({ sha: 'commit1' })
    if (url === `${API}/git/refs/heads/audio-inputs` || url === `${API}/git/refs`) {
      if (conflicts-- > 0) return new Response('{}', { status: 422 })
      return Response.json({})
    }
    if (url.endsWith('/actions/workflows/audio-transcribe.yml/dispatches')) { invocationId = String((body!.inputs as Record<string, string>).invocation_id); return new Response(null, { status: 204 }) }
    if (url.includes('/actions/workflows/audio-transcribe.yml/runs')) return Response.json({ workflow_runs: [{ id: 7, name: 'Transcribe Audio', event: 'workflow_dispatch', head_branch: 'main', display_title: `Transcribe Audio ${invocationId}`, created_at: new Date().toISOString(), status: 'in_progress', run_number: 4, html_url: 'https://github.com/o/r/actions/runs/7' }] })
    if (url === `${API}/actions/runs/7`) return Response.json({ id: 7, status: 'completed', conclusion: opts.conclusion ?? 'success', run_number: 4, html_url: 'https://github.com/o/r/actions/runs/7' })
    if (url.endsWith(`/contents/audio-results/${invocationId}.txt?ref=audio-results`)) return new Response(opts.transcript ?? 'Hola, esto es una nota de voz.')
    if (url.endsWith(`/contents/audio-results/${invocationId}.meta.txt?ref=audio-results`)) return new Response('model=Systran/faster-whisper-small\nlanguage=es\n')
    return new Response('{}', { status: 404 })
  }
  return { request, calls, id: () => invocationId }
}
const fast = { sleep: async () => {}, now: Date.now }

describe('audio transcription on GitHub Actions', () => {
  it('uploads an attached clip, runs the workflow on it, and returns the transcript', async () => {
    const gh = github()
    const result = await runAudioTranscription(gh.request, { owner: 'o', repo: 'r', token: 't', audio: MP4, ...fast })
    expect(result.transcript).toBe('Hola, esto es una nota de voz.')
    expect(result.model).toBe('Systran/faster-whisper-small')
    expect(result.language).toBe('es')
    // First upload creates the branch as an orphan holding only the clip.
    expect(gh.calls.find(c => c.url === `${API}/git/blobs`)!.body).toEqual({ content: 'AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t', encoding: 'base64' })
    expect(gh.calls.find(c => c.url === `${API}/git/commits` && c.method === 'POST')!.body!.parents).toEqual([])
    expect(gh.calls.find(c => c.url === `${API}/git/refs`)!.body).toEqual({ ref: 'refs/heads/audio-inputs', sha: 'commit1' })
    const dispatch = gh.calls.find(c => c.url.endsWith('/dispatches'))!
    expect(dispatch.body!.inputs).toEqual({ audio_ref: `audio-inputs/${gh.id()}.mp4`, language: '', invocation_id: gh.id() })
  })

  it('adds to an existing branch and retries when another upload moved it', async () => {
    const gh = github({ branchExists: true, conflictOnce: true })
    expect(await uploadAudioInput(gh.request, { owner: 'o', repo: 'r', token: 't', invocationId: 'audio-1', dataUrl: MP4 })).toBe('audio-inputs/audio-1.mp4')
    expect(gh.calls.filter(c => c.url === `${API}/git/refs/heads/audio-inputs` && c.method === 'PATCH')).toHaveLength(2)
    expect(gh.calls.find(c => c.url === `${API}/git/trees`)!.body!.base_tree).toBe('tiptree')
  })

  it('passes an explicit language to the workflow, lowercased', async () => {
    const gh = github()
    await runAudioTranscription(gh.request, { owner: 'o', repo: 'r', token: 't', audio: MP4, language: 'ES', ...fast })
    expect(gh.calls.find(c => c.url.endsWith('/dispatches'))!.body!.inputs).toMatchObject({ language: 'es' })
  })

  it('reports a failed transcription as a failure, never as a transcript', async () => {
    await expect(runAudioTranscription(github({ conclusion: 'failure', transcript: 'TRANSCRIPTION FAILED (failure); see the run log.' }).request, { owner: 'o', repo: 'r', token: 't', audio: MP4, ...fast }))
      .rejects.toThrow(/audio transcription run #4 failed \(failure\)/)
    await expect(runAudioTranscription(github().request, { owner: 'o', repo: 'r', token: 't', audio: 'data:image/png;base64,iVBORw0KGgo=', ...fast })).rejects.toThrow(/needs an attached audio clip/)
  })

  it('labels a transcript as a voice message for the model', () => {
    expect(formatVoiceMessageTranscript('Voice Memo.m4a', 'hola mundo'))
      .toBe('[Voice message: Voice Memo.m4a — transcript by faster-whisper small (GitHub Actions, CPU)]\n\nhola mundo')
  })
})
