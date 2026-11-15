// @vitest-environment node
// code-review.yml loaded CodeLlama-7B as float32 (~28 GB) on a 16 GB runner; the live run (39311383660) was
// killed after 2m12s. These tests pin the memory-safe replacement.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')
const wf = read('.github/workflows/code-review.yml')

describe('review_code.py', () => {
  it('passes its python tests', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_review_code.py'], {
      encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  })
})

describe('code-review.yml', () => {
  it('never loads full-precision 7B weights on the CPU runner', () => {
    expect(wf).not.toMatch(/float32|torch_dtype|AutoModelForCausalLM|codellama/i)
    expect(wf).not.toContain('pip install torch')
  })
  it('uses the pinned prebuilt llama.cpp wheel and a script, not inline python', () => {
    expect(wf).toMatch(/pip install llama-cpp-python==\d+\.\d+\.\d+ --only-binary=llama-cpp-python/)
    expect(wf).toContain('run: python .github/scripts/review_code.py')
    expect(wf).not.toContain('python3 -c')
  })
  it('does not clobber the locale variable and passes inputs through env, not shell text', () => {
    expect(wf).not.toMatch(/^\s+LANG:/m)
    expect(wf).toContain('REVIEW_LANGUAGE: ${{ inputs.language }}')
    expect(wf).toContain('CODE: ${{ inputs.code_content }}')
  })
  it('is pinned and least-privilege', () => {
    expect(wf).toContain('runs-on: ubuntu-24.04')
    expect(wf).toMatch(/permissions:\n {2}contents: read/)
    expect(wf).toContain('persist-credentials: false')
  })
  it('caches the model with a guarded save and still uploads the artifact the app expects on failure', () => {
    expect(wf).toContain('uses: actions/cache/restore@v4')
    expect(wf).toMatch(/steps\.gguf_present\.outputs\.present == 'true'/)
    expect(wf).toContain('name: code-review-${{ inputs.invocation_id }}')
    expect(wf).toContain('if: always()')
  })
  it('publishes the review from a separate, model-free job with write access; the review job stays read-only', () => {
    const review = wf.slice(wf.indexOf('\n  review:\n'), wf.indexOf('\n  mirror:\n'))
    const mirror = wf.slice(wf.indexOf('\n  mirror:\n'))
    expect(review).not.toContain('contents: write')
    expect(mirror).toMatch(/permissions:\n {6}contents: write/)
    expect(mirror).not.toContain('review_code.py')
    expect(mirror).not.toContain('pip install')
    expect(mirror).toContain('bash .github/scripts/review_mirror.sh')
    // Checkout cleans the workspace, so it must come before the downloaded result.
    expect(mirror.indexOf('actions/checkout')).toBeLessThan(mirror.indexOf('actions/download-artifact'))
  })
})
