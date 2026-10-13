// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Narrow routing for explicit code-repair requests with a supported attachment.

export const MAX_SHELL_REPAIR_PATCH_CHARS = 60_000

const SOURCE_EXTENSIONS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'html', 'java', 'js', 'jsx', 'json',
  'kt', 'mjs', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'svelte', 'swift',
  'ts', 'tsx', 'vue', 'yaml', 'yml',
])

const REPAIR_INTENT = /\b(?:repair|fix(?:es|ing)?|patch)\b/i
const REPO_PATH_PATTERN = /(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g

export interface ShellRepairDispatchInputs {
  repair_branch: string
  patch: string
  reason: string
  invocation_id: string
}

export function isRepairSourceFile(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SOURCE_EXTENSIONS.has(extension)
}

export function isRepairUploadRequest(instruction: string, fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const supported = extension === 'patch' || extension === 'diff' || SOURCE_EXTENSIONS.has(extension)
  return supported && REPAIR_INTENT.test(instruction)
}

function isSafeRepositoryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.includes('\0')
    && normalized.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Use an explicit repository-relative path from the repair request when present; otherwise use the upload's name. */
export function resolveRepairSourcePath(instruction: string, fileName: string): string {
  const candidates = instruction.match(REPO_PATH_PATTERN) ?? []
  const uploadName = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName
  const explicit = candidates.find(candidate => candidate.split('/').pop() === uploadName) ?? candidates[0]
  const path = (explicit ?? uploadName).replace(/\\/g, '/').replace(/^\.\//, '')
  if (!isSafeRepositoryPath(path) || !isRepairSourceFile(path)) {
    throw new Error('The attached source file needs a safe repository-relative path and a supported source-file extension.')
  }
  return path
}

export function buildRepairPatchPrompt(
  instruction: string,
  filePath: string,
  uploadedSource: string,
  currentRepositorySource: string,
): string {
  return [
    'Produce only a valid unified diff that applies the requested repair to this one repository file.',
    `Target path: ${filePath}`,
    'Use the current main-branch file as the patch baseline. Modify only the target file; do not modify workflows, package manifests, or unrelated files.',
    'Return the diff with standard --- a/<path>, +++ b/<path>, and @@ hunk headers. Do not include explanations or markdown fences. If no change is needed, return exactly NO_CHANGES.',
    '',
    'Repair request:',
    instruction.trim(),
    '',
    'Uploaded source file content:',
    '```source',
    uploadedSource,
    '```',
    '',
    'Current file content from main:',
    '```source',
    currentRepositorySource,
    '```',
  ].join('\n')
}

/** Extract and validate a unified diff from raw patch text or a model response. */
export function extractUnifiedDiff(responseText: string): string | null {
  const fenced = responseText.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i)?.[1] ?? responseText
  const lines = fenced.replace(/\r\n/g, '\n').split('\n')
  const firstDiffLine = lines.findIndex(line => line.startsWith('diff --git ') || /^--- (?:a\/|\/dev\/null)/.test(line))
  if (firstDiffLine < 0) return null

  const patch = lines.slice(firstDiffLine).join('\n').trim()
  if (patch.length === 0 || patch.length > MAX_SHELL_REPAIR_PATCH_CHARS) return null
  const patchLines = patch.split('\n')
  const hasOldFile = patchLines.some(line => /^--- (?:a\/|\/dev\/null)/.test(line))
  const hasNewFile = patchLines.some(line => /^\+\+\+ (?:b\/|\/dev\/null)/.test(line))
  const hasHunk = patchLines.some(line => line.startsWith('@@ '))
  if (!hasOldFile || !hasNewFile || !hasHunk) return null
  return `${patch}\n`
}

export function getUnifiedDiffPaths(patch: string): string[] {
  const lines = patch.split(/\r?\n/)
  const paths: string[] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const oldMatch = /^--- (.+)$/.exec(lines[index])
    const newMatch = /^\+\+\+ (.+)$/.exec(lines[index + 1])
    if (!oldMatch || !newMatch) continue
    for (const rawPath of [oldMatch[1], newMatch[1]]) {
      if (rawPath === '/dev/null') continue
      const path = rawPath.replace(/^[ab]\//, '')
      if (!paths.includes(path)) paths.push(path)
    }
    index += 1
  }
  return paths
}

export function createShellRepairDispatchInputs(
  patch: string,
  reason: string,
  now = Date.now(),
): ShellRepairDispatchInputs {
  if (!patch.trim() || patch.length > MAX_SHELL_REPAIR_PATCH_CHARS) {
    throw new Error(`The repair patch must contain 1-${MAX_SHELL_REPAIR_PATCH_CHARS} characters.`)
  }
  const timestamp = new Date(now).toISOString().replace(/\D/g, '')
  const oneLineReason = reason.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  return {
    repair_branch: `forge/repair/${timestamp}`,
    patch,
    reason: oneLineReason || 'Repair uploaded source file',
    invocation_id: `upload-${now}`,
  }
}

export async function fetchMainFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!isSafeRepositoryPath(path)) throw new Error('The source file path is not a safe repository-relative path.')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=main`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    signal,
  })
  if (response.status === 404) {
    throw new Error(`Could not find ${path} on main. Include its repository-relative path in the repair request and try again.`)
  }
  if (!response.ok) throw new Error(`Could not read ${path} from main (GitHub ${response.status}).`)
  const file = await response.json() as { type?: string; encoding?: string; content?: string }
  if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error(`GitHub did not return ${path} as a readable text file.`)
  }
  const binary = atob(file.content.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export async function dispatchShellRepair(
  token: string,
  owner: string,
  repo: string,
  inputs: ShellRepairDispatchInputs,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  if (!token.trim()) throw new Error('A GitHub token is required to dispatch the guarded repair workflow.')
  const response = await fetcher(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/shell-repair.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs }),
      signal,
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Guarded shell-repair dispatch failed (GitHub ${response.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`)
  }
}
