import { describe, expect, it } from 'vitest'
import { formatUserFacingError, sanitizeChatText } from './userFacingErrors'

describe('user-facing chat response boundary', () => {
  it('removes internal identity/context and tool retry protocol from visible text', () => {
    const output = sanitizeChatText([
      'I found a promising lead in Oklahoma City.',
      '[APPLICATIONIDENTITY application="ForgeClaw"] internal context and tool instructions',
      '[TOOLFAILURE] deepseek-run-discovery GET timed out',
      '[RETRY:YES] try again',
    ].join('\n'))

    expect(output).toBe('I found a promising lead in Oklahoma City.')
    expect(output).not.toMatch(/APPLICATIONIDENTITY|TOOLFAILURE|RETRY/i)
  })

  it('turns DeepSeek discovery timeouts into an actionable response', () => {
    const output = formatUserFacingError('deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs: GitHub read timed out after 30000ms')

    expect(output).toContain('couldn’t reach GitHub Actions in time')
    expect(output).toContain('TEST GITHUB READ')
    expect(output).not.toContain('deepseek-run-discovery')
    expect(output).not.toContain('30000ms')
  })

  it('keeps auth guidance concise and avoids duplicating raw provider errors', () => {
    const output = formatUserFacingError('GitHub workflow dispatch failed: 401 Unauthorized')

    expect(output).toContain('GitHub rejected the saved credential')
    expect(output).toContain('Settings')
    expect(output).not.toContain('401')
  })
})
