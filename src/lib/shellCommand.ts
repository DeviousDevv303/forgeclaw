// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

// These are the built-in command names admitted by ForgeClaw's explicit-shell
// shortcut. Normalize only this known set; preserve casing for custom executables
// and all arguments because Linux command names and arguments can be case-sensitive.
const CANONICAL_SHELL_EXECUTABLES = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'npx', 'node', 'python', 'python3',
  'pwd', 'ls', 'cd', 'cat', 'head', 'tail', 'find', 'grep', 'sed', 'awk',
  'sort', 'uniq', 'mkdir', 'cp', 'mv', 'test',
])

/** Normalize known Unix command names without changing flags, paths, or arguments. */
export function normalizeKnownShellExecutable(command: string): string {
  const match = /^(\s*)(\S+)([\s\S]*)$/.exec(command)
  if (!match) return command

  const [, leadingWhitespace, executable, remainder] = match
  const canonical = executable.toLowerCase()
  if (!CANONICAL_SHELL_EXECUTABLES.has(canonical)) return command
  return `${leadingWhitespace}${canonical}${remainder}`
}
