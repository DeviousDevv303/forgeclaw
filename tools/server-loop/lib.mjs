// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// Built with love for Cristian Jr., Layla, and Jozae.

/**
 * Server loop, Stage 1 — pure logic.
 *
 * The loop is ForgeClaw's agent cycle moved server-side into GitHub Actions:
 * a scheduled workflow reads the channel (issue #235), finds unanswered calls,
 * and acts on ONE of them per run. Stage 1 is deterministic on purpose — it
 * makes zero model calls (the owner's token doctrine: no burning tokens for
 * no reason). The Qwen/DeepSeek Actions path becomes the canary engine at
 * Stage 2, after this channel reviews Stage 1.
 *
 * Everything in this file is pure: no network, no clock, no filesystem. The
 * runner (runner.mjs) fetches live state and hands it in; tests drive this
 * file against recorded API shapes. A claim the loop posts is assembled only
 * from the state it was handed — verified live at run time, never remembered.
 *
 * Call format (shared with the app listener in src/lib/channelCalls.ts and
 * the watch timer): a comment carrying `<!-- forgeclaw-call:v1 id=<id> -->`.
 * Only owner-authored comments count as calls. A call is answered when a
 * later comment names its id — the channel protocol every lane already uses.
 *
 * Guardian policy lives here, in the classifier, not in a prompt: a call
 * asking for a merge, a money movement / order placement, or credential
 * handling classifies as REFUSE and gets a signed refusal, never an
 * execution. Those three stay the owner's hands alone, on every surface.
 */

/** The v1 call marker, character-for-character the app listener's regex. */
export const CALL_MARKER_RE = /<!--\s*forgeclaw-call:v1\s+id=([A-Za-z0-9._-]+)\s*-->/g

/** Machine markers on the loop's own posts, so later ticks can see its work. */
export const loopAnswerMarker = (id) => `<!-- forgeclaw-loop:v1 answered=${id} -->`
export const loopRefusalMarker = (id) => `<!-- forgeclaw-loop:v1 refused=${id} -->`

/** Ids with this prefix are the watch timer's own wake calls — outputs, not inputs. */
export const WATCH_ID_PREFIX = 'watch-'

const short = (sha) => String(sha ?? '').slice(0, 8)

/**
 * Parse a thread of issue comments (GitHub REST shape) into calls, oldest
 * first. A call needs the v1 marker; when `owner` is given, only comments
 * authored by the owner count (every agent on the channel posts as the
 * owner, so this excludes nothing legitimate — it keeps a quoted marker in
 * a stranger's comment from becoming a call). Watch-timer ids are skipped:
 * they belong to the app listener and are never the loop's to answer.
 */
export function parseCalls(comments, { owner } = {}) {
  const sorted = [...comments].sort((a, b) => a.id - b.id)
  const calls = []
  for (const comment of sorted) {
    if (owner && comment.user?.login !== owner) continue
    const body = comment.body ?? ''
    for (const match of body.matchAll(CALL_MARKER_RE)) {
      const id = match[1]
      if (id.startsWith(WATCH_ID_PREFIX)) continue
      calls.push({
        id,
        commentId: comment.id,
        createdAt: comment.created_at,
        author: comment.user?.login ?? '',
        taskText: body.replace(CALL_MARKER_RE, '').trim(),
      })
    }
  }
  return calls
}

/**
 * Answered = a LATER comment names the id. "Later" is by comment id, the
 * thread's own order. The loop's answer/refusal posts name the id in plain
 * text and in a machine marker, so its own work counts here — that is what
 * makes a duplicate tick (a manual re-dispatch right after an answer) a
 * no-op instead of a double answer.
 */
export function isAnswered(call, comments) {
  return comments.some(
    (c) => c.id > call.commentId && (c.body ?? '').includes(call.id),
  )
}

/** Every call in the thread that nobody has answered yet, oldest first. */
export function findUnansweredCalls(comments, opts = {}) {
  return parseCalls(comments, opts).filter((call) => !isAnswered(call, comments))
}

/**
 * Guardian refusal patterns. These are verb-phrase shapes, not keywords: a
 * report ABOUT merges ("report which PRs are merge-ready", "the merge
 * commit that landed #255") must not trip them, so each pattern needs an
 * imperative verb aimed at a concrete object. The classifier checks refusal
 * FIRST — when a call mixes classes ("merge #12 and report status"), the
 * refusal wins and the whole call is refused; Stage 1 never partially
 * executes a mixed call.
 */
const REFUSAL_PATTERNS = [
  {
    guard: 'merge',
    patterns: [
      /\bmerge\s+(?:pr\s+|pull\s+request\s+)?#?\d+\b/i,
      /\bmerge\s+(?:the\s+|this\s+|that\s+)?(pull\s+request|branch|pr)\b/i,
      /\bmerge\s+it\b/i,
      /\bclick\s+(?:the\s+)?merge\b/i,
    ],
  },
  {
    guard: 'money',
    patterns: [
      /\b(?:place|submit|send|execute)\s+(?:an?\s+|the\s+)?(?:order|bet|trade)\b/i,
      /\b(?:buy|sell)\s+(?:\d|yes\b|no\b|contracts?\b)/i,
      /\btransfer\s+(?:funds|money|\$|usd|usdc)\b/i,
      /\bmove\s+(?:the\s+)?(?:money|funds)\b/i,
      /\bkalshi\b[^.]{0,60}\b(?:place|order|buy|sell|bet)\b/i,
      /\bwithdraw\s+\$/i,
      /\bdeposit\s+\$/i,
    ],
  },
  {
    guard: 'credentials',
    patterns: [
      /\b(?:paste|enter|type|provide|share|send|use|put|add)\b[^.]{0,40}\b(?:api\s*key|private\s*key|password|secret|token|credentials?)\b/i,
      /\b(?:api\s*key|private\s*key|password)\s*(?:is|=|:)\s*\S+/i,
    ],
  },
]

/** Report cues: the call asks for state, a summary, a list, a verification. */
const REPORT_CUE_RE =
  /\b(report|status|summar\w*|list|state|what|which|verify|check|show|tell|heads?|deploy\w*|version|open\s+prs?|ci|board)\b/i

/**
 * Classify one call's task text:
 * - { kind: 'refuse', guard } — a Guardian carve-out (merge / money /
 *   credentials). The loop posts a signed refusal and nothing else.
 * - { kind: 'report' } — asks for repo/channel state. Stage 1 executes it
 *   by assembling verified live state.
 * - { kind: 'other' } — everything else (code work, questions for the app,
 *   Stage 2's model-driven territory). Stage 1 leaves it untouched: no
 *   post, no marker, so a later stage can still pick it up.
 */
export function classifyCall(taskText) {
  const text = String(taskText ?? '')
  for (const { guard, patterns } of REFUSAL_PATTERNS) {
    if (patterns.some((re) => re.test(text))) return { kind: 'refuse', guard }
  }
  if (REPORT_CUE_RE.test(text)) return { kind: 'report' }
  return { kind: 'other' }
}

/**
 * Roll a PR head's check runs (GitHub REST shape) into one word. Failure
 * beats pending beats success: a head is only "success" when every run
 * completed green.
 */
export function rollupChecks(checkRuns) {
  const runs = checkRuns?.check_runs ?? []
  if (!runs.length) return 'none'
  if (runs.some((r) => r.status !== 'completed')) return 'pending'
  if (runs.some((r) => r.conclusion !== 'success' && r.conclusion !== 'neutral' && r.conclusion !== 'skipped')) return 'failure'
  return 'success'
}

/**
 * Adapt raw API responses into the state the report is assembled from.
 * Kept in the pure layer so the fixture tests exercise the same adapter
 * the runner uses live.
 */
export function stateFromApi({ mainCommit, pulls, checkRunsBySha, version }) {
  return {
    mainSha: mainCommit?.sha ?? '',
    prs: (pulls ?? []).map((pr) => ({
      number: pr.number,
      title: pr.title ?? '',
      draft: Boolean(pr.draft),
      headSha: pr.head?.sha ?? '',
      ci: rollupChecks(checkRunsBySha?.[pr.head?.sha]),
    })),
    deployed: version?.commit
      ? { commit: version.commit, builtAt: version.builtAt ?? '' }
      : null,
  }
}

/**
 * Assemble the report post body from verified state. Deterministic: same
 * state + same clock reading in, same text out. The deployment line states
 * the comparison it actually made (deployed commit vs main HEAD) instead
 * of asserting "deployed" from hope.
 */
export function assembleReport(state, { now, repoSlug }) {
  const lines = []
  lines.push(`Verified live repo state for **${repoSlug}**, assembled ${now}:`)
  lines.push('')
  lines.push(`- Main HEAD: \`${state.mainSha}\` (\`${short(state.mainSha)}\`)`)
  if (state.deployed) {
    const matches =
      state.mainSha.startsWith(state.deployed.commit) ||
      state.deployed.commit.startsWith(short(state.mainSha))
    lines.push(
      `- Deployed site: version.json reports commit \`${state.deployed.commit}\` (built ${state.deployed.builtAt}) — ` +
        (matches
          ? 'matches main HEAD.'
          : `does NOT match main HEAD (\`${short(state.mainSha)}\`) — a deploy is pending or behind.`),
    )
  } else {
    lines.push('- Deployed site: version.json was unreachable at run time — deployment state unknown, not guessed.')
  }
  lines.push(`- Open PRs: ${state.prs.length}`)
  for (const pr of state.prs) {
    lines.push(
      `  - #${pr.number} "${pr.title}" — head \`${short(pr.headSha)}\`, ${pr.draft ? 'draft' : 'ready'}, CI: ${pr.ci}`,
    )
  }
  return lines.join('\n')
}

const GUARD_WORDS = {
  merge: 'merging a pull request',
  money: 'moving money or placing an order',
  credentials: 'handling credentials',
}

/** The signed answer post for a report-class call. Names the id in plain
 *  text (the channel's answered rule) and in the loop's machine marker. */
export function buildAnswerPost({ call, state, now, repoSlug, runId }) {
  return [
    `Answering channel call \`${call.id}\` (server loop, Stage 1):`,
    '',
    assembleReport(state, { now, repoSlug }),
    '',
    '— ForgeClaw server loop · Stage 1 (deterministic runner — no model calls were made), ' +
      `run ${runId}. State above was fetched live this run; nothing here is remembered from a previous tick.`,
    loopAnswerMarker(call.id),
  ].join('\n')
}

/** The signed refusal post for a Guardian-class call. A refusal names the
 *  id, so the call counts as answered and is not re-refused every tick. */
export function buildRefusalPost({ call, guard, runId }) {
  return [
    `Refusing channel call \`${call.id}\` (server loop, Stage 1):`,
    '',
    `This call asks for ${GUARD_WORDS[guard]}. That stays the owner's hands alone — ` +
      'the loop never merges, never moves money or places orders, and never touches credentials, ' +
      'on any surface, including this one. Nothing was executed.',
    '',
    '— ForgeClaw server loop · Stage 1 (deterministic runner — no model calls were made), ' +
      `run ${runId}.`,
    loopRefusalMarker(call.id),
  ].join('\n')
}

/**
 * One tick's decision. At most ONE action per run: scan unanswered calls
 * oldest-first and act on the first one Stage 1 has an action for (report
 * → answer, Guardian class → refusal). Other-class calls are skipped over
 * and left exactly as they were for Stage 2 / the lanes.
 */
export function decide({ comments, state, now, repoSlug, runId, owner }) {
  const unanswered = findUnansweredCalls(comments, { owner })
  for (const call of unanswered) {
    const cls = classifyCall(call.taskText)
    if (cls.kind === 'report') {
      return { action: 'answer', call, post: buildAnswerPost({ call, state, now, repoSlug, runId }) }
    }
    if (cls.kind === 'refuse') {
      return { action: 'refuse', call, guard: cls.guard, post: buildRefusalPost({ call, guard: cls.guard, runId }) }
    }
  }
  return { action: 'quiet' }
}
