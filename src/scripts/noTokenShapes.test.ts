// The deployed bundle is public. Manus's live-bundle safety scan (2026-10-20) stopped on a token-shaped
// string: the GitHub token field's placeholder "ghp_xxxx…" (20 x's). Harmless, but a scan can't tell a
// placeholder from a leak, so no shipped source may contain anything shaped like a credential.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TOKEN_SHAPES: Array<[string, RegExp]> = [
  ['GitHub classic token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{20,}/],
  ['sk- API key', /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

function shipped(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return shipped(path)
    return /\.(ts|tsx|js)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('no credential-shaped strings in shipped source', () => {
  it('src/ and relay/ contain nothing a secret scanner would flag', () => {
    const hits: string[] = []
    for (const file of [...shipped('src'), ...shipped('relay')]) {
      const text = readFileSync(file, 'utf8')
      for (const [kind, re] of TOKEN_SHAPES) if (re.test(text)) hits.push(`${file}: ${kind}`)
    }
    expect(hits).toEqual([])
  })
})
