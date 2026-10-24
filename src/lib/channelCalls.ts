// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Channel calls: how the Channel Watch wakes ForgeClaw with work.
 *
 * A call is a comment on the Muse↔Claude channel (issue #235) whose body carries a
 * machine marker line — `<!-- forgeclaw-call:v1 id=<callId> -->` — next to a visible
 * `@ForgeClaw` address line for humans. The app polls the issue while it is open,
 * surfaces every call it has not seen before in the Activity surface, and records
 * how far it has read in a watermark. A static PWA cannot be woken while closed:
 * calls are picked up on open and on the poll interval, never pushed.
 *
 * Trust rule: only comments authored by the repo owner count, and only with the
 * marker — a stray "@ForgeClaw" in anyone's prose is not a call. The watermark is
 * written through the strict storage helpers and read back before it is believed:
 * a "seen" the browser never persisted must not be claimed (the F-001 disease).
 */

import { describeGithubHttpFailure, toolFetch } from './githubFetch'
import { strictGetItem, strictSetItem } from './storage'

export const CHANNEL_OWNER = 'DeviousDevv303'
export const CHANNEL_REPO = 'forgeclaw'
export const CHANNEL_ISSUE_NUMBER = 235
/** Only the owner's own comments can call the app — every agent on the channel posts as him. */
export const CHANNEL_CALL_AUTHOR = 'DeviousDevv303'
export const CHANNEL_CALL_WATERMARK_KEY = 'fc_channel_call_watermark'
/** Calls surfaced to the owner and not yet dismissed. Persisted so a reload cannot lose a call the owner never saw. */
export const CHANNEL_CALL_PENDING_KEY = 'fc_channel_calls_pending'
const MAX_PENDING_CALLS = 50

/**
 * 15 minutes: the channel is a human/agent loop that moves in minutes-to-hours, and
 * the GitHub API budget is shared with the app's own workflow polling.
 */
export const CHANNEL_CALL_POLL_MS = 15 * 60_000

/**
 * A poll reads at most this many 100-comment pages (2,000 comments), walking from the
 * newest page down. The watermark stop makes the common case a single page; the cap
 * bounds the work when the watermark is far behind.
 */
const MAX_PAGES_PER_POLL = 20

const MARKER_RE_GLOBAL = /<!--\s*forgeclaw-call:v1\s+id=([A-Za-z0-9._-]+)\s*-->/g

export interface ChannelCall {
  callId: string
  commentId: number
  createdAt: string
  taskText: string
}

/** The slice of a GitHub issue-comment object this feature reads. */
export interface GithubIssueCommentLike {
  id: number
  body?: string | null
  created_at: string
  user?: { login?: string } | null
}

/**
 * Pure parser: one raw issue comment → EVERY channel call it carries (possibly
 * none). A call needs BOTH the owner as author AND a v1 marker; the task text is
 * the body with every marker line removed, trimmed.
 *
 * F-027: call identity is the marker id, not the comment — the server loop
 * (tools/server-loop/lib.mjs parseCalls, matchAll) counts one call per marker,
 * so a comment carrying two markers is two calls there. This parser used to
 * take only the first marker (and mergeChannelCalls keyed its union by
 * commentId), so the second call was never surfaced here while the loop could
 * answer it — the header's "surfaces every call" did not hold. Both surfaces
 * now count calls the same way.
 */
export function parseChannelCallsInComment(comment: GithubIssueCommentLike): ChannelCall[] {
  if (comment.user?.login !== CHANNEL_CALL_AUTHOR) return []
  const body = comment.body ?? ''
  const taskText = body.replace(MARKER_RE_GLOBAL, '').trim()
  const calls: ChannelCall[] = []
  for (const marker of body.matchAll(MARKER_RE_GLOBAL)) {
    calls.push({
      callId: marker[1],
      commentId: comment.id,
      createdAt: comment.created_at,
      taskText,
    })
  }
  return calls
}

/**
 * The first call a comment carries, or null when it carries none. Kept for
 * callers that only need to know whether a comment is a call at all — the
 * full per-marker list is parseChannelCallsInComment.
 */
export function parseChannelCall(comment: GithubIssueCommentLike): ChannelCall | null {
  return parseChannelCallsInComment(comment)[0] ?? null
}

/** Parse a page (or the whole thread) of comments into calls, oldest first. */
export function parseChannelCalls(comments: readonly GithubIssueCommentLike[]): ChannelCall[] {
  const calls: ChannelCall[] = []
  for (const comment of comments) {
    calls.push(...parseChannelCallsInComment(comment))
  }
  return calls.sort((a, b) => a.commentId - b.commentId)
}

/** Pure watermark filter: only calls strictly newer than the watermark are new. */
export function filterNewChannelCalls(calls: readonly ChannelCall[], watermark: number): ChannelCall[] {
  return calls.filter(call => call.commentId > watermark)
}

/** The highest comment id the app has surfaced, read back from storage; 0 when none/unreadable. */
export function readChannelCallWatermark(): number {
  const read = strictGetItem(CHANNEL_CALL_WATERMARK_KEY)
  if (!read.ok || !read.value) return 0
  const parsed = Number.parseInt(read.value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Advance the watermark past every call in `calls` and prove the write landed:
 * strictSetItem reports a refused write, and the value is read back and compared
 * before true is returned. Returns false when storage would not hold the mark —
 * the calls then resurface on the next poll instead of being silently dropped.
 */
export function acknowledgeChannelCalls(calls: readonly ChannelCall[]): boolean {
  if (!calls.length) return true
  const next = Math.max(readChannelCallWatermark(), ...calls.map(call => call.commentId))
  const value = String(next)
  const write = strictSetItem(CHANNEL_CALL_WATERMARK_KEY, value)
  if (!write.ok) return false
  const back = strictGetItem(CHANNEL_CALL_WATERMARK_KEY)
  return back.ok && back.value === value
}

function isStoredCall(value: unknown): value is ChannelCall {
  const c = value as Partial<ChannelCall> | null
  return !!c && typeof c.callId === 'string' && typeof c.commentId === 'number' && Number.isFinite(c.commentId)
    && typeof c.createdAt === 'string' && typeof c.taskText === 'string'
}

/** Calls surfaced earlier and not dismissed, oldest first; empty when none, unreadable or corrupt. */
export function readPendingChannelCalls(): ChannelCall[] {
  const read = strictGetItem(CHANNEL_CALL_PENDING_KEY)
  if (!read.ok || !read.value) return []
  try {
    const parsed: unknown = JSON.parse(read.value)
    return Array.isArray(parsed) ? parsed.filter(isStoredCall).sort((a, b) => a.commentId - b.commentId) : []
  } catch {
    return []
  }
}

/**
 * Union by call id, oldest first. F-027: keying by commentId collapsed two
 * calls carried by one comment into one (last wins) — call identity is the
 * marker id, as in the server loop.
 */
export function mergeChannelCalls(existing: readonly ChannelCall[], incoming: readonly ChannelCall[]): ChannelCall[] {
  const byId = new Map<string, ChannelCall>()
  for (const call of [...existing, ...incoming]) byId.set(call.callId, call)
  return [...byId.values()].sort((a, b) => a.commentId - b.commentId)
}

/**
 * Persist the pending list (newest 50) and prove the write landed. A call is surfaced in
 * memory first, so the watermark may only advance past it once this returns true —
 * otherwise a reload before the owner looked would drop the call for good.
 */
export function savePendingChannelCalls(calls: readonly ChannelCall[]): boolean {
  const value = JSON.stringify([...calls].sort((a, b) => a.commentId - b.commentId).slice(-MAX_PENDING_CALLS))
  const write = strictSetItem(CHANNEL_CALL_PENDING_KEY, value)
  if (!write.ok) return false
  const back = strictGetItem(CHANNEL_CALL_PENDING_KEY)
  return back.ok && back.value === value
}

function lastPageFromLink(link: string): number {
  const match = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link)
  const parsed = match ? Number.parseInt(match[1], 10) : 1
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

async function getCommentsPage(token: string, page: number): Promise<{ items: GithubIssueCommentLike[]; link: string }> {
  const url = `https://api.github.com/repos/${CHANNEL_OWNER}/${CHANNEL_REPO}/issues/${CHANNEL_ISSUE_NUMBER}/comments?per_page=100&page=${page}`
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  // Same auth scheme as githubPublish: the owner's token when this browser has one;
  // unauthenticated reads still work (the repo is public), just rate-limited harder.
  if (token) headers.Authorization = `token ${token}`
  const res = await toolFetch({}, url, { headers })
  if (!res.ok) throw new Error(describeGithubHttpFailure('Channel calls', res.status, res.statusText))
  const items = (await res.json()) as GithubIssueCommentLike[]
  return { items, link: res.headers.get('link') ?? '' }
}

/**
 * Read the channel's comments, newest pages first, stopping as soon as a page is
 * entirely at or below `watermark` (older pages cannot hold newer calls).
 */
async function fetchChannelComments(token: string, watermark: number): Promise<GithubIssueCommentLike[]> {
  const first = await getCommentsPage(token, 1)
  const collected = [...first.items]
  const seenPages = new Set<number>([1])
  const lastPage = lastPageFromLink(first.link)
  for (let page = lastPage; page >= 2 && seenPages.size < MAX_PAGES_PER_POLL; page--) {
    const { items } = await getCommentsPage(token, page)
    seenPages.add(page)
    collected.push(...items)
    if (items.length && Math.max(...items.map(item => item.id)) <= watermark) break
  }
  return collected
}

/** Every call currently on the channel, oldest first. Throws a stage-labelled error on HTTP failure. */
export async function fetchChannelCalls(options: { token?: string } = {}): Promise<ChannelCall[]> {
  const comments = await fetchChannelComments((options.token ?? '').trim(), 0)
  return parseChannelCalls(comments)
}

/** Only the calls this browser has not surfaced yet (comment id above the stored watermark). */
export async function fetchNewChannelCalls(options: { token?: string } = {}): Promise<ChannelCall[]> {
  const watermark = readChannelCallWatermark()
  const comments = await fetchChannelComments((options.token ?? '').trim(), watermark)
  return filterNewChannelCalls(parseChannelCalls(comments), watermark)
}
