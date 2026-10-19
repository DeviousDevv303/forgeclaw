// @vitest-environment node
// Runs the DeepSeek workflow's Python tests under the Build Gate and pins the workflow wiring that
// makes the fast engine safe: cache saved only when the file exists, slow fallback bounded, runner pinned.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/deepseek-16b.yml', 'utf8')

describe('deepseek python tests', () => {
  it('pass (gguf helpers + engine selection against the real embedded script)', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_deepseek*.py'], {
      encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  })
})

describe('deepseek-16b.yml wiring', () => {
  it('stays pinned to ubuntu-24.04 and keeps the job timeout', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).not.toContain('ubuntu-latest')
    expect(workflow).toContain('timeout-minutes: 30')
  })

  it('caches the GGUF with restore + guarded save, and no longer restores the 14 GB float16 cache', () => {
    expect(workflow).toContain('uses: actions/cache/restore@v4')
    expect(workflow).toContain('uses: actions/cache/save@v4')
    expect(workflow).toMatch(/if: \$\{\{ steps\.gguf_cache\.outputs\.cache-hit != 'true' && steps\.gguf_present\.outputs\.present == 'true' \}\}/)
    expect(workflow).not.toContain('restore-keys')
    expect(workflow).not.toContain('~/.cache/huggingface\n')
  })

  it('installs the prebuilt llama.cpp wheel without compiling, and survives its absence', () => {
    expect(workflow).toContain('--only-binary=llama-cpp-python')
    expect(workflow).toContain('abetlen.github.io/llama-cpp-python/whl/cpu')
    expect(workflow).toMatch(/\|\| echo "::warning::llama-cpp-python wheel unavailable/)
  })

  it('retries the mirror push when concurrent runs race', () => {
    expect(workflow).toContain('for attempt in 1 2 3 4')
    expect(workflow).toContain('rebase origin/deepseek-results')
  })

  it('records which engine produced the answer in result_meta.txt', () => {
    expect(workflow).toContain('engine=llama.cpp GGUF')
    expect(workflow).toContain('engine=transformers float16 (slow fallback)')
  })
})
