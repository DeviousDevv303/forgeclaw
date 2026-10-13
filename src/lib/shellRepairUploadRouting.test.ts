import { describe, expect, it, vi } from 'vitest'
import {
  buildRepairPatchPrompt,
  createShellRepairDispatchInputs,
  dispatchShellRepair,
  extractUnifiedDiff,
  getUnifiedDiffPaths,
  isRepairUploadRequest,
  resolveRepairSourcePath,
} from './shellRepairUploadRouting'

describe('shell repair upload routing', () => {
  it('routes supported patch, diff, and source attachments only for explicit repair intent', () => {
    expect(isRepairUploadRequest('Please repair this change', 'fix.patch')).toBe(true)
    expect(isRepairUploadRequest('Fix the attached regression', 'fix.diff')).toBe(true)
    expect(isRepairUploadRequest('Repair this file', 'Widget.tsx')).toBe(true)
    expect(isRepairUploadRequest('Analyze this file', 'Widget.tsx')).toBe(false)
    expect(isRepairUploadRequest('Repair this file', 'notes.pdf')).toBe(false)
  })

  it('leaves ordinary attachments on the existing chat path and resolves only safe source paths', () => {
    expect(isRepairUploadRequest('Summarize this', 'Widget.tsx')).toBe(false)
    expect(isRepairUploadRequest('Repair this', 'photo.png')).toBe(false)
    expect(resolveRepairSourcePath('Please repair src/components/Widget.tsx', 'Widget.tsx')).toBe('src/components/Widget.tsx')
    expect(resolveRepairSourcePath('Please repair this file', 'Widget.tsx')).toBe('Widget.tsx')
    expect(() => resolveRepairSourcePath('Repair ../secrets.ts', 'secrets.ts')).toThrow(/safe repository-relative path/)
  })

  it('builds a source-repair prompt against the current main file and extracts a fenced unified diff', () => {
    const prompt = buildRepairPatchPrompt('Fix the null check', 'src/widget.ts', 'uploaded version', 'current version')
    expect(prompt).toContain('Use the current main-branch file as the patch baseline')
    expect(prompt).toContain('uploaded version')
    expect(prompt).toContain('current version')
    const patch = extractUnifiedDiff('Here is the repair:\n```diff\n--- a/src/widget.ts\n+++ b/src/widget.ts\n@@ -1 +1 @@\n-old\n+new\n```')
    expect(patch).toBe('--- a/src/widget.ts\n+++ b/src/widget.ts\n@@ -1 +1 @@\n-old\n+new\n')
    expect(getUnifiedDiffPaths(patch ?? '')).toEqual(['src/widget.ts'])
    expect(extractUnifiedDiff('No code change is needed.')).toBeNull()
  })

  it('generates the requested timestamp branch and all four workflow inputs', () => {
    const timestamp = 1_797_000_000_000
    const inputs = createShellRepairDispatchInputs('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n', 'Fix the bug\nwith two lines', timestamp)
    expect(inputs).toEqual({
      repair_branch: `forge/repair/${new Date(timestamp).toISOString().replace(/\D/g, '')}`,
      patch: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
      reason: 'Fix the bug with two lines',
      invocation_id: 'upload-1797000000000',
    })
    expect(Object.keys(inputs).sort()).toEqual(['invocation_id', 'patch', 'reason', 'repair_branch'])
  })

  it('dispatches shell-repair.yml on main with all required inputs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const inputs = createShellRepairDispatchInputs('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n', 'Fix bug', 1_797_000_000_000)
    await dispatchShellRepair('test-token', 'owner', 'repo', inputs, fetcher)

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/shell-repair.yml/dispatches')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('token test-token')
    expect(JSON.parse(String(init?.body))).toEqual({ ref: 'main', inputs })
  })
})
