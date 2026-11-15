// @vitest-environment node
// site-build.yml runs a model-written build command. These tests pin the isolation that makes that
// acceptable: the build job holds no write credential, the write-capable job runs no build code, and
// inputs never reach a run: script except through env.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const wf = readFileSync('.github/workflows/site-build.yml', 'utf8')
const buildJob = wf.slice(wf.indexOf('\n  build:'), wf.indexOf('\n  mirror:'))
const mirrorJob = wf.slice(wf.indexOf('\n  mirror:'))

function validateStep() {
  const start = wf.indexOf('        run: |\n', wf.indexOf('- name: Validate inputs')) + '        run: |\n'.length
  const end = wf.indexOf('      - name: Check out site source')
  return wf.slice(start, end).split('\n').map(line => line.slice(10)).join('\n')
}
const validate = (env: Record<string, string>) => spawnSync('bash', ['-e', '-c', validateStep()], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'DeviousDevv303/forgeclaw', SOURCE_REPO: 'me/app', SOURCE_REF: 'source', OUTPUT_DIR: 'dist', INVOCATION_ID: 'site-1', ...env },
})

describe('site-build.yml isolation', () => {
  it('gives the build job read-only contents and no persisted credential', () => {
    expect(buildJob).toMatch(/permissions:\n {6}contents: read/)
    expect(buildJob).toContain('persist-credentials: false')
    expect(buildJob).not.toMatch(/contents: write/)
  })
  it('runs no build command in the write-capable mirror job', () => {
    expect(mirrorJob).toMatch(/permissions:\n {6}contents: write/)
    expect(mirrorJob).not.toContain('BUILD_COMMAND')
    expect(mirrorJob).not.toMatch(/npm|bash -c/)
    expect(mirrorJob).toContain('builds/$INVOCATION_ID')
  })
  it('never interpolates workflow inputs into a run: script', () => {
    const offenders = wf.split('\n').filter(line =>
      line.includes('${{ inputs.') && !/^\s*(run-name|name):/.test(line) && !/^\s+[A-Z_]+: \$\{\{ inputs\./.test(line)
      && !/^\s+(repository|ref|path|name): /.test(line))
    expect(offenders).toEqual([])
  })
  it('is pinned and correlatable', () => {
    expect(wf.match(/runs-on: ubuntu-24.04/g)).toHaveLength(2)
    expect(wf).toContain('run-name: Site build ${{ inputs.invocation_id }}')
  })
})

describe('site-build.yml input validation', () => {
  it('accepts a normal build request', () => {
    expect(validate({}).status).toBe(0)
  })
  it.each([
    [{ INVOCATION_ID: 'a b' }, 'invocation_id'],
    [{ SOURCE_REPO: 'nope' }, 'source_repo'],
    [{ SOURCE_REF: 'a..b' }, 'source_ref'],
    [{ OUTPUT_DIR: '../x' }, 'output_dir'],
    [{ OUTPUT_DIR: '/etc' }, 'output_dir'],
    [{ OUTPUT_DIR: 'a//b' }, 'output_dir'],
    [{ SOURCE_REPO: 'DeviousDevv303/ForgeClaw' }, 'refusing to build this repository'],
  ])('rejects %o', (env, message) => {
    const r = validate(env)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(message)
  })
})
