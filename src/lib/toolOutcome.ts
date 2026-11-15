// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * True when a tool's output reports that the action did not succeed.
 *
 * attempted != completed != verified: `✗ VERIFICATION FAILED …` is a tool that ran and
 * returned a negative result, and it used to be labelled COMPLETE with MISSION_COMPLETE
 * because only [TOOL ERROR] / [GUARDIAN …] prefixes counted as failures.
 */
export function isToolFailureOutput(output: string): boolean {
  return output.startsWith('[TOOL ERROR]')
    || output.startsWith('✗')
    || /^\[GUARDIAN (?:BLOCKED?|REJECTED)\]/i.test(output)
}
