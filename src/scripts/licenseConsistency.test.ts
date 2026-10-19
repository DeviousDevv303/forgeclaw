// @vitest-environment node
// LICENSE is authoritative. The README used to say "MIT" while LICENSE and every source header
// said proprietary source-available (Manus license audit, 2026-10-19).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('license statements agree with LICENSE', () => {
  const license = readFileSync('LICENSE', 'utf8')
  const title = license.split('\n')[0].trim()
  const readme = readFileSync('README.md', 'utf8')

  it('README names the same license as LICENSE and never claims MIT', () => {
    expect(title).toBe('ForgeClaw Proprietary Source-Available License')
    expect(readme).toContain(title)
    expect(readme).not.toMatch(/\bMIT\b/)
  })

  it('package.json defers to LICENSE', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { license?: string }
    expect(pkg.license).toBe('SEE LICENSE IN LICENSE')
  })
})
