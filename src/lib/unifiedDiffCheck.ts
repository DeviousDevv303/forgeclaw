// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.

/**
 * Pre-flight for shell_patch. `git apply` rejects a hunk whose body contradicts its own `@@ -a,b +c,d @@` header
 * with "corrupt patch" (run 39561708765: a model-written diff, found only after a runner job). This reads the
 * hunks and reports that contradiction before dispatch, in words the model can act on.
 *
 * Deliberately conservative: a false rejection would block a valid repair, so only the unambiguous case is
 * reported (a hunk that is cut short, or runs past its declared counts). It does not judge whether a patch
 * would apply to the current files; `git apply` in the workflow stays the authority for that.
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const DIFF_HEADER = /^diff --git a\/(.*) b\//

function preview(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat
}

/** Returns null when every hunk matches its header, otherwise a one-paragraph reason (with file, hunk and counts). */
export function checkUnifiedDiff(patch: string): string | null {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  // A trailing newline produces one empty final element that is not part of any hunk.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let file = '(unknown file)'
  let hunkNo = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const diffHeader = DIFF_HEADER.exec(line)
    if (diffHeader) { file = diffHeader[1]; hunkNo = 0; i += 1; continue }
    if (line.startsWith('+++ ') && !HUNK_HEADER.test(line)) {
      const name = line.slice(4).split('\t')[0].replace(/^b\//, '')
      if (name !== '/dev/null') file = name
      i += 1
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (!header) { i += 1; continue }

    hunkNo += 1
    const oldDeclared = header[2] === undefined ? 1 : Number(header[2])
    const newDeclared = header[4] === undefined ? 1 : Number(header[4])
    const declared = `-${header[1]}${header[2] === undefined ? '' : `,${header[2]}`} +${header[3]}${header[4] === undefined ? '' : `,${header[4]}`}`
    let oldSeen = 0
    let newSeen = 0
    i += 1
    // Consume body lines until both declared counts are met.
    while (oldSeen < oldDeclared || newSeen < newDeclared) {
      if (i >= lines.length) break
      const body = lines[i]
      const lead = body[0]
      if (lead === '\\') { i += 1; continue } // "\ No newline at end of file"
      if (lead === ' ' || body === '') { oldSeen += 1; newSeen += 1 } // an empty line is a blank context line
      else if (lead === '-') oldSeen += 1
      else if (lead === '+') newSeen += 1
      else break // a header or prose line before the hunk is complete
      i += 1
    }
    const found = `${oldSeen} old / ${newSeen} new lines`
    if (oldSeen < oldDeclared || newSeen < newDeclared) {
      const stop = i < lines.length ? ` The hunk ended early at patch line ${i + 1} ("${preview(lines[i])}").` : ' The patch ended inside the hunk.'
      return `hunk ${hunkNo} of ${file} declares ${declared} (${oldDeclared} old / ${newDeclared} new lines) but its body has only ${found}.${stop}`
    }
    // Counts met: skip "\ No newline" markers, then any further body line means the hunk runs past its header.
    while (i < lines.length && lines[i][0] === '\\') i += 1
    if (i < lines.length) {
      const next = lines[i]
      const lead = next[0]
      const isFileHeader = next.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')
      if (!isFileHeader && (lead === ' ' || lead === '+' || lead === '-')) {
        return `hunk ${hunkNo} of ${file} declares ${declared} (${oldDeclared} old / ${newDeclared} new lines) but has too many lines: patch line ${i + 1} ("${preview(next)}") is extra.`
      }
    }
  }
  return null
}
