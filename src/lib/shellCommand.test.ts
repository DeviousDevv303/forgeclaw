// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeKnownShellExecutable } from './shellCommand'

describe('normalizeKnownShellExecutable', () => {
  it('canonicalizes case variants of recognized built-in command names', () => {
    expect(normalizeKnownShellExecutable('Pwd')).toBe('pwd')
    expect(normalizeKnownShellExecutable(' PWD')).toBe(' pwd')
    expect(normalizeKnownShellExecutable('NPM run build')).toBe('npm run build')
    expect(normalizeKnownShellExecutable('Git Status')).toBe('git Status')
  })

  it('preserves argument casing and whitespace after the executable', () => {
    expect(normalizeKnownShellExecutable('  PWD --Flag MixedCase')).toBe('  pwd --Flag MixedCase')
    expect(normalizeKnownShellExecutable('CAT README.MD')).toBe('cat README.MD')
  })

  it('does not rewrite custom commands, paths, or empty input', () => {
    expect(normalizeKnownShellExecutable('MyCustomTool --Arg')).toBe('MyCustomTool --Arg')
    expect(normalizeKnownShellExecutable('./Pwd')).toBe('./Pwd')
    expect(normalizeKnownShellExecutable('')).toBe('')
  })
})
