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
  const deepSeek = formatDeepSeekStageError(message)
  if (deepSeek) return deepSeek
  if (/shell execution dispatched but correlated run|correlated run .* not found/i.test(message)) {
    return 'GitHub accepted the shell request, but its workflow run was not visible yet. Nothing was reported as completed. Please try again in a moment; the execution panel will keep the technical run details.'
  }
  if (/401|403|unauthorized|authentication|invalid.*(?:token|key)|token.*(?:invalid|rejected)/i.test(message)) {
    return 'GitHub rejected the saved credential, so I couldn’t complete that request. Check the GitHub token in Settings, then try again.'
  }
  if (/network|failed to fetch|econnrefused|enotfound|etimedout|timeout|timed out/i.test(message)) {
    return 'I hit a temporary connection problem while processing that request. Please try again in a moment.'
  }
  if (/guardian|co-sign|approval/i.test(message)) {
    return 'That action is waiting for the required approval. Review the Guardian Gate in the execution panel before trying again.'
  }
  return 'I couldn’t complete that request because an internal tool failed. The detailed failure is available in the execution panel; please try again.'
}

/**
 * One message per DeepSeek stage, keyed on the stage label the tool and router put on the error.
 * Each says what is known about the run, so a dispatch that never happened, a run that is still
 * executing on GitHub, and a reply the model gave never collapse into the same "can't reach" text.
 */
function formatDeepSeekStageError(message: string): string | undefined {
  if (/^deepseek-not-dispatched\b/i.test(message)) {
    return 'DeepSeek was not started for this message: ForgeClaw did not offer it the DeepSeek tool, so nothing was sent to GitHub Actions. This is a ForgeClaw routing error, not a connection problem.'
  }
  if (/deepseek-dispatch\b/i.test(message)) {
    const auth = /\b(?:401|403|404)\b/.test(message)
    return auth
      ? 'DeepSeek was not started: GitHub refused the workflow dispatch for the saved token. Nothing ran. Check the GitHub token in Settings (Actions: Read and write on this repository), then try again.'
      : 'DeepSeek was not started: the workflow dispatch did not reach GitHub. Nothing ran. Please try again in a moment.'
  }
  if (/deepseek-run-discovery[\s\S]*was not found within/i.test(message)) {
    return 'DeepSeek was dispatched, but its workflow run did not appear on GitHub within 2 minutes. It may still run: check GitHub Actions before asking again so it does not run twice.'
  }
  if (/deepseek-run-discovery[\s\S]*\b(?:401|403|404)\b/i.test(message)) {
    return 'DeepSeek was dispatched, but GitHub refused to list its workflow runs for the saved token. Check the GitHub token in Settings (Actions: Read on this repository).'
  }
  if (/deepseek-run-discovery/i.test(message)) {
    return 'DeepSeek was dispatched, but I couldn’t reach GitHub Actions in time to find its run. The job may still finish on GitHub. If it keeps happening, open Settings and run “TEST GITHUB READ” to check the connection.'
  }
  if (/deepseek-run-poll[\s\S]*timed out after/i.test(message)) {
    return 'DeepSeek’s workflow run was still not finished when ForgeClaw stopped waiting. Open the run in GitHub Actions to see whether it completed.'
  }
  const concluded = message.match(/deepseek-run-poll[\s\S]*concluded as "([^"]*)"/i)
  if (concluded) {
    return `DeepSeek’s workflow run finished as “${concluded[1]}” on GitHub, so there is no answer. The run log in GitHub Actions shows the failing step.`
  }
  if (/deepseek-(?:artifact|result)[\w-]*/i.test(message) && !/quality validation|empty response|without a non-empty result/i.test(message)) {
    return 'DeepSeek’s workflow run finished, but I couldn’t read its result from GitHub. The answer is stored with the run in GitHub Actions.'
  }
  if (/DeepSeek[\s\S]*(?:quality validation|empty response|without a non-empty result|empty or garbled)/i.test(message)) {
    return 'DeepSeek ran and replied, but its reply was empty or unusable, so there is no answer to show. Try rephrasing the question.'
  }
  return undefined
}
