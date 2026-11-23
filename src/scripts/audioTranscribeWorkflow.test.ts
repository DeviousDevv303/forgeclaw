// @vitest-environment node
// audio-transcribe.yml is ForgeClaw's speech-to-text path (faster-whisper on the CPU runner).
// The failure class this pins against is the never-run-workflow one (image-analyze's unpinned
// transformers, browser-automation's missing dependency): a workflow nobody exercised hid its
// breakage. These tests pin the contract — pinned runner and deps, a read-only transcribe job,
// the model-free mirror as the only writer, and the av pin that faster-whisper 1.2.1 can
// actually decode with (av 19 removed a keyword it passes; verified locally 2026-11-22).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')

describe('transcribe_audio.py', () => {
  it('passes its python tests', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_transcribe_audio.py'], {
      encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  })

  it('transcribes with faster-whisper small on CPU (int8), never a hosted API', () => {
    const src = read('.github/scripts/transcribe_audio.py')
    expect(src).toContain('MODEL = "small"')
    expect(src).toContain('compute_type="int8"')
    expect(src).not.toMatch(/api\.openai\.com|api\.deepgram|speech\.googleapis/)
  })
})

describe('audio-transcribe.yml', () => {
  const wf = read('.github/workflows/audio-transcribe.yml')

  it('is pinned: runner, read-only token, exact deps, no inline python', () => {
    expect(wf).toContain('runs-on: ubuntu-24.04')
    expect(wf).not.toContain('ubuntu-latest')
    expect(wf).toMatch(/permissions:\n {2}contents: read/)
    expect(wf).toContain('persist-credentials: false')
    expect(wf).toContain('-r .github/requirements-audio.txt')
    expect(wf).toContain('run: python .github/scripts/transcribe_audio.py')
    expect(wf).not.toContain('python3 -c')
    expect(wf).toContain('run-name: Transcribe Audio ${{ inputs.invocation_id }}')
  })

  it('exact-pins every audio requirement, including the compatible av', () => {
    const lines = read('.github/requirements-audio.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) expect(line, line).toMatch(/^[A-Za-z0-9_.-]+==[0-9][^\s]*$/)
    expect(lines).toContain('faster-whisper==1.2.1')
    // av 19.x breaks faster-whisper 1.2.1's decode call; 16.1.0 is the verified pin.
    expect(lines).toContain('av==16.1.0')
    expect(lines.some(l => /^av==19/.test(l))).toBe(false)
  })

  it('takes an attached clip from audio-inputs (MP4 included); only the model-free mirror job can write', () => {
    const transcribe = wf.slice(wf.indexOf('\n  transcribe:\n'), wf.indexOf('\n  mirror:\n'))
    const mirror = wf.slice(wf.indexOf('\n  mirror:\n'))
    expect(transcribe).not.toContain('contents: write')
    expect(transcribe).toContain("grep -Eqx 'audio-inputs/[A-Za-z0-9._-]{1,120}\\.(webm|mp4|m4a|mp3|wav|ogg|flac|aac)'")
    expect(transcribe).toContain('git show "FETCH_HEAD:$AUDIO_REF"')
    expect(mirror).toMatch(/permissions:\n {6}contents: write/)
    expect(mirror).not.toContain('transcribe_audio.py')
    expect(mirror).not.toContain('pip install')
    expect(mirror).toContain('bash .github/scripts/audio_mirror.sh')
    // Checkout cleans the workspace, so it must come before the downloaded result.
    expect(mirror.indexOf('actions/checkout')).toBeLessThan(mirror.indexOf('actions/download-artifact'))
  })
})
