// A DeepSeek reasoning run outlives the page (it runs on GitHub Actions), so its reply stays "running" across a
// reload and is re-attached. That is only true while the workflow can still be running: after the window below it has
// timed out, and a reply left "running" shows "Still working" forever.

/** The DeepSeek workflow's own timeout; a saved run older than this can no longer be re-attached. */
export const DEEPSEEK_RESUME_WINDOW_MS = 30 * 60_000

/** True while a saved DeepSeek run can still be re-attached. */
export function isDeepSeekRunResumable(run: { dispatchedAt: number }, now: number): boolean {
  return now - run.dispatchedAt <= DEEPSEEK_RESUME_WINDOW_MS
}

/** The reply text for a DeepSeek run that can no longer be re-attached. */
export const DEEPSEEK_RUN_EXPIRED_NOTE =
  '⚠ Interrupted: this DeepSeek run was left running for more than 30 minutes and can no longer be reconnected. Send it again to retry.'
