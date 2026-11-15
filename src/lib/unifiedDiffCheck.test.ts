// @vitest-environment node
// checkUnifiedDiff is a conservative pre-flight for shell_patch: it only rejects a hunk whose body
// contradicts its own @@ header (the shape of `git apply`'s "corrupt patch" error, run 39561708765).
// A false rejection would block a valid repair, so valid forms are pinned as hard as invalid ones.
import { describe, expect, it } from 'vitest'
import { checkUnifiedDiff } from './unifiedDiffCheck'

const head = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n'

describe('checkUnifiedDiff: accepts valid diffs', () => {
  it('a one-line change with omitted counts (@@ -1 +1 @@)', () => {
    expect(checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n+b\n`)).toBeNull()
  })
  it('a multi-hunk change with context', () => {
    const patch = `${head}@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n@@ -10,2 +10,3 @@\n ten\n+ten-and-a-half\n eleven\n`
    expect(checkUnifiedDiff(patch)).toBeNull()
  })
  it('a new file, a deleted file and a pure rename (no hunks)', () => {
    expect(checkUnifiedDiff('diff --git a/n.ts b/n.ts\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n')).toBeNull()
    expect(checkUnifiedDiff('diff --git a/o.ts b/o.ts\ndeleted file mode 100644\n--- a/o.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n')).toBeNull()
    expect(checkUnifiedDiff('diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n')).toBeNull()
  })
  it('the "\\ No newline at end of file" marker does not count as a line', () => {
    expect(checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n`)).toBeNull()
  })
  it('removed or added lines whose text starts with dashes or pluses', () => {
    // Body lines "--- a rule" (removes "-- a rule") and "+++ a heading" (adds "++ a heading") look like file headers.
    expect(checkUnifiedDiff(`${head}@@ -1 +1 @@\n--- a rule\n+++ a heading\n`)).toBeNull()
  })
  it('a blank context line written without its leading space (git apply tolerates it)', () => {
    expect(checkUnifiedDiff(`${head}@@ -1,3 +1,3 @@\n a\n\n-c\n+d\n`)).toBeNull()
  })
  it('a patch with no trailing newline, and CRLF line endings', () => {
    expect(checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n+b`)).toBeNull()
    expect(checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n+b\n`.replace(/\n/g, '\r\n'))).toBeNull()
  })
  it('two files in one patch', () => {
    const patch = `${head}@@ -1 +1 @@\n-a\n+b\ndiff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-c\n+d\n`
    expect(checkUnifiedDiff(patch)).toBeNull()
  })
})

describe('checkUnifiedDiff: rejects a hunk that contradicts its header', () => {
  it('a hunk cut short (declares 3 old lines, supplies 2)', () => {
    const out = checkUnifiedDiff(`${head}@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n`)
    expect(out).toMatch(/hunk 1/)
    expect(out).toContain('src/x.ts')
    expect(out).toMatch(/body has only/)
    expect(out).toMatch(/ended inside the hunk/)
  })
  it('a hunk followed by the next header before its counts are met', () => {
    const out = checkUnifiedDiff(`${head}@@ -1,5 +1,5 @@\n a\n-b\n+c\ndiff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-x\n+y\n`)
    expect(out).toMatch(/hunk 1/)
  })
  it('a hunk with more lines than it declares', () => {
    const out = checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n+b\n+extra\n`)
    expect(out).toMatch(/extra|too many/i)
  })
  it('names the right hunk when only the second one is wrong', () => {
    const out = checkUnifiedDiff(`${head}@@ -1 +1 @@\n-a\n+b\n@@ -20,4 +20,4 @@\n x\n-y\n+z\n`)
    expect(out).toMatch(/hunk 2/)
  })
  it('reports the declared and the found counts so the model can correct them', () => {
    const out = checkUnifiedDiff(`${head}@@ -1,4 +1,4 @@\n a\n-b\n+c\n`)!
    expect(out).toContain('-1,4 +1,4')
    expect(out).toMatch(/2 old/)
    expect(out).toMatch(/2 new/)
  })
})
