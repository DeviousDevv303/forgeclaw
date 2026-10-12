// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/** Remove internal model/runtime protocol text before content reaches the normal chat bubble. */
export function sanitizeChatText(text: string): string {
  const withoutInternalTail = text
    // Application identity and verified-context blocks are runtime instructions,
    // not user-facing answer content. They commonly appear after a useful answer.
    .replace(/\[APPLICATIONIDENTITY[\s\S]*$/i, '')
    .replace(/\[TOOLFAILURE\][^\n]*/gi, '')
    .replace(/\[TOOLFAILURE\][\s\S]*$/gi, '')
    .replace(/\[RETRY:(?:YES|NO)\][^\n]*/gi, '')
    .replace(/\[ERROR\]:\s*/gi, '')
    .replace(/\[SYSTEM(?:_NOTICE)?\][\s\S]*$/gi, '')
  return withoutInternalTail
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Convert technical runtime failures into concise, actionable chat responses. */
export function formatUserFacingError(rawMessage: string): string {
  const message = rawMessage.trim()
  if (/deepseek-run-discovery[\s\S]*(?:timed out|timeout)|GitHub read timed out/i.test(message)) {
    return 'I couldn’t reach GitHub Actions in time while starting the DeepSeek job. Your request was not completed. Please try again in a moment; if it keeps happening, open Settings and run “TEST GITHUB READ” to check the connection.'
  }
  if (/shell execution dispatched but correlated run|correlated run .* not found/i.test(message)) {
    return 'GitHub accepted the shell request, but its workflow run was not visible yet. Nothing was reported as completed. Please try again in a moment; the execution panel will keep the technical run details.'
  }
  if (/401|403|unauthorized|authentication|invalid.*(?:token|key)|token.*(?:invalid|rejected)/i.test(message)) {
    return 'GitHub rejected the saved credential, so I couldn’t complete that request. Check the GitHub token in Settings, then try again.'
  }
  if (/network|failed to fetch|econnrefused|enotfound|etimedout|timeout/i.test(message)) {
    return 'I hit a temporary connection problem while processing that request. Please try again in a moment.'
  }
  if (/guardian|co-sign|approval/i.test(message)) {
    return 'That action is waiting for the required approval. Review the Guardian Gate in the execution panel before trying again.'
  }
  return 'I couldn’t complete that request because an internal tool failed. The detailed failure is available in the execution panel; please try again.'
}
