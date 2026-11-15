// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim())
    const parts = u.pathname.replace(/^\//, '').split('/')
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') }
  } catch { return null }
}

export interface RepoTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

export async function ghFetch(path: string, token: string, opts: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(opts.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`https://api.github.com${path}`, { ...opts, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `GitHub ${res.status}`)
  }
  return res.json()
}

export async function fetchRepoTree(owner: string, repo: string, token: string): Promise<RepoTreeItem[]> {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, token) as { tree?: RepoTreeItem[] }
  return data.tree || []
}

export async function fetchFileContent(owner: string, repo: string, path: string, token: string): Promise<{ content: string; sha: string }> {
  const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token) as { content: string; sha: string }
  const decoded = atob(data.content.replace(/\n/g, ''))
  return { content: decoded, sha: data.sha }
}

export async function pushFile(owner: string, repo: string, path: string, content: string, message: string, sha: string | undefined, token: string): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(content)))
  const body: Record<string, string> = { message, content: encoded }
  if (sha) body.sha = sha
  await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function triggerWorkflow(owner: string, repo: string, workflowId: string, ref: string, token: string): Promise<void> {
  await ghFetch(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  })
}
