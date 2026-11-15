// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * shell_patch preflight: run the real `git apply --check` on a runner BEFORE shell-repair.yml is
 * dispatched, so a malformed model-written patch fails in the app with git's own message instead of
 * dying inside the repair workflow (owner authorization, forgeclaw #235, 2026-11-12).
 *
 * The browser has no git, so the check runs through the ordinary shell_exec tool (same Guardian path,
 * same shell-exec.yml, same checkout of main that shell-repair.yml patches). The flags match
 * shell-repair.yml's own apply step (`--whitespace=error`).
 */

/** A dispatch input is capped near 65,535 characters in total; base64 adds a third. Larger patches skip the preflight and say so. */
export const SHELL_PATCH_PREFLIGHT_MAX_CHARS = 40_000

export function encodePatchBase64(patch: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(patch)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The command shell_exec runs. Base64 characters are safe inside single quotes; no pipe can mask git's exit code. */
export function buildGitApplyCheckCommand(patch: string): string {
  const file = '"${RUNNER_TEMP:-/tmp}/forge-patch-preflight.diff"'
  return `printf '%s' '${encodePatchBase64(patch)}' | base64 -d > ${file} && git apply --check --whitespace=error ${file} && echo "git apply --check: the patch applies cleanly to main"`
}

export type PreflightVerdict =
  | { kind: 'ok' }
  | { kind: 'skipped'; note: string }
  | { kind: 'refused'; message: string }

/**
 * Run the check through `run` (the app passes shell_exec) and classify the answer.
 * Fails closed: a check that cannot complete refuses the dispatch with a clear error instead of guessing.
 */
export async function preflightShellPatch(
  patch: string,
  run: (command: string) => Promise<string>,
): Promise<PreflightVerdict> {
  if (patch.length > SHELL_PATCH_PREFLIGHT_MAX_CHARS) {
    return {
      kind: 'skipped',
      note: `git apply --check was SKIPPED: the patch (${patch.length} characters) is too large to pass through a workflow input; shell-repair.yml still applies it with git apply.`,
    }
  }
  const output = await run(buildGitApplyCheckCommand(patch))
  if (!/^\s*\[TOOL ERROR\]/.test(output)) return { kind: 'ok' }
  const excerpt = output.replace(/^\s*\[TOOL ERROR\]\s*/, '').slice(0, 700)
  if (/Exit code:\s*[1-9]\d*/.test(output)) {
    return { kind: 'refused', message: `shell_patch refused before any repair run: git apply --check says this patch does not apply to main. Nothing was dispatched. ${excerpt}` }
  }
  return { kind: 'refused', message: `shell_patch could not verify the patch with git apply --check, so nothing was dispatched. ${excerpt}` }
}
