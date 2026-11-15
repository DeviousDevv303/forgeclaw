// @vitest-environment node
// image-analyze.yml and browser-automation.yml had never run successfully. Their failures were:
//  - image-analyze: an unpinned transformers (5.x) no longer exports AutoModelForVision2Seq, so every run died on import;
//  - browser-automation: scripts/browser-automation.js used require() under "type": "module", and Playwright
//    was not a dependency anywhere.
// These tests pin the fixes so they cannot silently regress.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(p, 'utf8')

describe('analyze_image.py', () => {
  it('passes its python tests', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_analyze_image.py'], {
      encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  })

  it('uses the class that exists in transformers 5.x and not the removed one', () => {
    const src = read('.github/scripts/analyze_image.py')
    expect(src).toContain('AutoModelForImageTextToText')
    expect(src).not.toMatch(/import[^\n]*AutoModelForVision2Seq/)  // the docstring may mention it; an import may not
  })

  it('returns only newly generated tokens, never the echoed prompt', () => {
    expect(read('.github/scripts/analyze_image.py')).toContain('out[:, inputs["input_ids"].shape[1]:]')
  })
})

describe('image-analyze.yml', () => {
  const wf = read('.github/workflows/image-analyze.yml')
  it('is pinned: runner, read-only token, exact deps, no inline python', () => {
    expect(wf).toContain('runs-on: ubuntu-24.04')
    expect(wf).not.toContain('ubuntu-latest')
    expect(wf).toMatch(/permissions:\n {2}contents: read/)
    expect(wf).toContain('persist-credentials: false')
    expect(wf).toMatch(/torch==\d+\.\d+\.\d+\+cpu torchvision==\d+\.\d+\.\d+\+cpu/)
    expect(wf).toContain('-r .github/requirements-vision.txt')
    expect(wf).toContain('run: python .github/scripts/analyze_image.py')
    expect(wf).not.toContain('python3 -c')
  })
  it('exact-pins every vision requirement', () => {
    const lines = read('.github/requirements-vision.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) expect(line, line).toMatch(/^[A-Za-z0-9_.-]+==[0-9][^\s]*$/)
  })
  it('takes an attached picture from vision-inputs; only the model-free mirror job can write', () => {
    const analyze = wf.slice(wf.indexOf('\n  analyze:\n'), wf.indexOf('\n  mirror:\n'))
    const mirror = wf.slice(wf.indexOf('\n  mirror:\n'))
    expect(analyze).not.toContain('contents: write')
    expect(analyze).toContain("grep -Eqx 'vision-inputs/[A-Za-z0-9._-]{1,120}\\.(jpg|png|webp|gif)'")
    expect(analyze).toContain('git show "FETCH_HEAD:$IMAGE_REF"')
    expect(mirror).toMatch(/permissions:\n {6}contents: write/)
    expect(mirror).not.toContain('analyze_image.py')
    expect(mirror).not.toContain('pip install')
    expect(mirror).toContain('bash .github/scripts/vision_mirror.sh')
    // Checkout cleans the workspace, so it must come before the downloaded result.
    expect(mirror.indexOf('actions/checkout')).toBeLessThan(mirror.indexOf('actions/download-artifact'))
  })
  it('still publishes the artifact the app expects, even when the run fails', () => {
    expect(wf).toContain('name: image-analysis-${{ inputs.invocation_id }}')
    expect(wf).toContain('if: always()')
  })
})

describe('browser-automation', () => {
  const wf = read('.github/workflows/browser-automation.yml')
  it('runs a CommonJS script, because package.json is "type": "module"', () => {
    expect(JSON.parse(read('package.json')).type).toBe('module')
    expect(existsSync('scripts/browser-automation.cjs')).toBe(true)
    expect(existsSync('scripts/browser-automation.js')).toBe(false)
    expect(wf).toContain('node scripts/browser-automation.cjs')
  })
  it('the script parses', () => {
    const r = spawnSync('node', ['--check', 'scripts/browser-automation.cjs'], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })
  it('installs Playwright with an exact pin outside the app dependencies', () => {
    expect(wf).toMatch(/npm install --no-audit --no-fund playwright@\d+\.\d+\.\d+/)
    expect(wf).toContain('NODE_PATH=$RUNNER_TEMP/pw/node_modules')
    expect(wf).not.toMatch(/^\s*-?\s*(run:\s*)?npm ci/m)  // a comment may mention it; a step may not
    expect(read('package.json')).not.toMatch(/"playwright"/)
  })
  it('reports failures as annotations and keeps uploading results on failure', () => {
    expect(read('scripts/browser-automation.cjs')).toContain('::error title=browser-automation')
    expect(wf).toContain('if: always()')
  })
})
