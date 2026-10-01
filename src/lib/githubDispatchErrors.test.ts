// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeGithubDispatchFailure } from './githubDispatchErrors'

describe('describeGithubDispatchFailure', () => {
  it('explains that 401 means credentials were rejected, not merely that permission is missing', () => {
    const message = describeGithubDispatchFailure(401)
    expect(message).toContain('401 Unauthorized')
    expect(message).toContain('invalid, expired, revoked, or malformed')
    expect(message).toContain('Replace it privately')
    expect(message).toContain('Actions: Read and write')
    expect(message).toContain('repo scope')
  })

  it('gives separate permission and organization-policy guidance for 403', () => {
    const message = describeGithubDispatchFailure(403)
    expect(message).toContain('403 Forbidden')
    expect(message).toContain('Actions: Read and write')
    expect(message).toContain('SSO approval')
  })

  it('points 404 errors toward repository/workflow access without claiming the token is invalid', () => {
    const message = describeGithubDispatchFailure(404)
    expect(message).toContain('.github/workflows/shell-exec.yml')
    expect(message).not.toContain('401')
  })

  it('does not include caller-provided credentials or response bodies', () => {
    const message = describeGithubDispatchFailure(401, 'ghp_secret-value')
    expect(message).not.toContain('ghp_secret-value')
    expect(message).not.toContain('response body')
  })
})
