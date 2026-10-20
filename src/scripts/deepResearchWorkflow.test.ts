// @vitest-environment node
// deep-research.yml parses untrusted web pages. Pin: exact dependency versions, no persisted write
// credential, inputs only through env, and the offline Python tests of the evidence gatherer.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wf = readFileSync('.github/workflows/deep-research.yml', 'utf8')

describe('deep_research.py', () => {
  it('passes its offline python tests', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_deep_research.py'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  })
})

describe('deep-research.yml', () => {
  it('pins every research dependency exactly', () => {
    expect(wf).toContain('pip install ddgs==9.16.0 trafilatura==2.3.1 httpx==0.28.1')
  })
  it('leaves no write credential on disk while parsing web pages', () => {
    expect(wf).toContain('persist-credentials: false')
    expect(wf).toContain('http.https://github.com/.extraheader=$AUTH')
  })
  it('never interpolates workflow inputs into a run: script', () => {
    const offenders = wf.split('\n').filter(line =>
      line.includes('${{ inputs.') && !/^\s*(run-name|name):/.test(line) && !/^\s+[A-Z_]+: \$\{\{ inputs\./.test(line))
    expect(offenders).toEqual([])
  })
  it('is correlatable, pinned, and keeps the failures visible', () => {
    expect(wf).toContain('run-name: Deep research ${{ inputs.invocation_id }}')
    expect(wf).toContain('runs-on: ubuntu-24.04')
    expect(wf.match(/if: always\(\)/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
