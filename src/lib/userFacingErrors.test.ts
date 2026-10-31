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
    const output = formatUserFacingError('deepseek-run-discovery: DeepSeek dispatched, but GitHub could not be read to find run "deepseek-1-a" within 120s. Last read error: deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs: GitHub read timed out after 30000ms')

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

  it('gives every DeepSeek stage its own message, and keeps "couldn’t reach" for the reachability case only', () => {
    const raw = {
      notDispatched: 'deepseek-not-dispatched: the request reached the Qwen/Qwen3-8B provider (id \'deepseek\') without the deepseek_reason tool, so no workflow was dispatched and GitHub Actions was never contacted.',
      dispatchNetwork: 'deepseek-dispatch POST /actions/workflows/deepseek-16b.yml/dispatches: browser network/CORS failure — the request produced no HTTP response',
      dispatchAuth: 'deepseek-dispatch POST /actions/workflows/deepseek-16b.yml/dispatches: GitHub rejected the saved token (401 Unauthorized).',
      runNotFound: 'deepseek-run-discovery: DeepSeek dispatched but correlated run "deepseek-1-a" was not found within 120s.',
      discoveryUnreadable: 'deepseek-run-discovery: DeepSeek dispatched, but GitHub could not be read to find run "deepseek-1-a" within 120s. Last read error: GitHub read timed out after 30000ms',
      discoveryAuth: 'deepseek-run-discovery GET /actions/workflows/deepseek-16b.yml/runs: GitHub HTTP 403 Forbidden.',
      runTimedOut: 'deepseek-run-poll: DeepSeek timed out after 31m. Run #12 last status: in_progress.',
      runFailed: 'deepseek-run-poll: DeepSeek run #151 concluded as "failure". Run: https://github.com/DeviousDevv303/forgeclaw/actions/runs/39188909218',
      resultUnreadable: 'deepseek-artifact-download: browser network/CORS failure — the request produced no HTTP response',
      modelEmpty: 'Qwen/Qwen3-8B run https://github.com/DeviousDevv303/forgeclaw/actions/runs/1 finished but produced an empty response, so there is no answer to show.',
      modelGarbled: 'Qwen/Qwen3-8B generated an empty or garbled response. Please try rephrasing your question.',
    }
    const out = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, formatUserFacingError(v)])) as Record<keyof typeof raw, string>

    expect(out.notDispatched).toMatch(/not started[\s\S]*routing error/)
    expect(out.dispatchNetwork).toMatch(/not started[\s\S]*did not reach GitHub/)
    expect(out.dispatchAuth).toMatch(/not started[\s\S]*refused the workflow dispatch/)
    expect(out.runNotFound).toMatch(/dispatched[\s\S]*did not appear/)
    expect(out.discoveryUnreadable).toMatch(/dispatched[\s\S]*couldn’t reach GitHub Actions/)
    expect(out.discoveryAuth).toMatch(/refused to list its workflow runs/)
    expect(out.runTimedOut).toMatch(/still not finished/)
    expect(out.runFailed).toContain('finished as “failure”')
    expect(out.resultUnreadable).toMatch(/finished, but I couldn’t read its result/)
    expect(out.modelEmpty).toMatch(/ran and replied/)
    expect(out.modelGarbled).toMatch(/ran and replied/)

    // Only the case where GitHub was actually unreadable may say it couldn't reach GitHub Actions.
    for (const [k, v] of Object.entries(out)) {
      if (k !== 'discoveryUnreadable') expect(v, k).not.toMatch(/couldn’t reach GitHub Actions/)
      expect(v, k).not.toMatch(/internal tool failed|shell request/)
    }
    const categories = new Set(Object.entries(out).filter(([k]) => k !== 'modelGarbled').map(([, v]) => v))
    expect(categories.size).toBe(Object.keys(raw).length - 1)
  })
})

describe('errorDetail PEM scrubbing (PR #240 item 3)', () => {
  it('strips a PEM block from an error detail line', async () => {
    const { errorDetail } = await import('./userFacingErrors')
    const pem = '-----BEGIN PRIVATE KEY----- MIIBfakebase64payloadnotarealkey -----END PRIVATE KEY-----'
    const out = errorDetail(`signing failed for ${pem} at step 2`)
    expect(out).not.toContain('PRIVATE KEY')
    expect(out).not.toContain('MIIBfakebase64')
    expect(out).toContain('[redacted]')
  })
})
