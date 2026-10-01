// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Explain GitHub workflow-dispatch failures without exposing credentials or
 * returning request bodies that might contain sensitive data.
 */
export function describeGithubDispatchFailure(status: number, statusText = ''): string {
  if (status === 401) {
    return 'GitHub rejected the saved token (401 Unauthorized). The token is invalid, expired, revoked, or malformed. Replace it privately in ForgeClaw Settings; never paste it into chat. After replacing it, a fine-grained token needs this repository selected and Actions: Read and write; a classic token needs the repo scope.'
  }

  if (status === 403) {
    return 'GitHub authenticated the token but denied workflow dispatch (403 Forbidden). Check that the token can access this repository and has Actions: Read and write (fine-grained) or repo scope (classic). Organization policy or SSO approval may also be required.'
  }

  if (status === 404) {
    return 'GitHub could not access the repository or shell workflow (404 Not Found). Verify the configured owner/repository, that the token can access it, and that .github/workflows/shell-exec.yml exists on main.'
  }

  const detail = statusText.trim()
  return `GitHub workflow dispatch failed (HTTP ${status}${detail ? ` ${detail}` : ''}). Check the repository and GitHub Actions status.`
}
