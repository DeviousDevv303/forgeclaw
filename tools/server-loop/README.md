# ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
# Proprietary source-available license. Commercial use requires written permission. See LICENSE.

# Server loop — Stage 1

ForgeClaw's agent cycle, running server-side in GitHub Actions. The app only
acts when a turn reaches it; this loop does not need the app. On a schedule,
the workflow (`.github/workflows/forgeclaw-loop.yml`) checks out this
directory and runs one tick of `runner.mjs`:

1. Fetch the channel thread (issue #235), the open PRs with their check
   runs, main's HEAD, and the deployed `version.json` — all live, that run.
2. Find unanswered channel calls (v1 marker, owner-authored, `watch-*` ids
   excluded — those belong to the app listener).
3. Act on at most ONE call, oldest first:
   - **Report-class** (asks for state / a summary / a verification): answer
     it with the assembled live state, signed, naming the call id.
   - **Guardian-class** (asks for a merge, a money movement / order, or
     credential handling): post a signed refusal. Never an execution.
   - **Anything else** (code work, Stage 2 territory): leave it untouched —
     no post, no marker — so a later stage can still pick it up.
4. A quiet board posts nothing.

State lives in the channel thread itself: calls, answers, and refusals are
all comments, and "answered" means a later comment names the call id (the
channel protocol) — a comment by the owner (every lane posts as him) or the
loop's own marked post (`github-actions[bot]`). Since the Channel Watch lets
agents reply on the channel as `github-actions[bot]`, a reply that only quotes
a call id cannot close that call. The runner keeps nothing between runs, so a duplicate
tick after an answer is a no-op, and removing the loop loses no bookkeeping.

## Why deterministic

Stage 1 makes **zero model calls** — the owner's token doctrine: no burning
tokens for no reason. The frequent light passes belong to the cheap
Qwen/DeepSeek Actions path (the "16B" canary), which becomes the execution
engine at Stage 2 after this channel reviews Stage 1. Everything Stage 1
posts is assembled by `lib.mjs` from state fetched that run; nothing is
remembered, inferred, or phrased by a model.

## @ForgeClaw mentions (Channel Watch)

`mention.mjs` answers an `@ForgeClaw` mention on any issue, PR or Discussion,
for `.github/workflows/channel-watch.yml`. It uses the same classifier and
Guardian policy as a channel call (`buildMentionReply` in `lib.mjs`): a report
ask gets live verified state, a merge / money / credentials ask gets a refusal,
anything else gets a plain "Stage 1 cannot do this". It prints the reply; the
Channel Watch posts it. No model call, and no loop marker: a mention is not a
channel call.

## Layout

- `lib.mjs` — pure logic: call parsing, answered tracking, the Guardian
  classifier, check rollups, state assembly, post builders, the tick
  decision. No I/O.
- `runner.mjs` — the I/O shell: GitHub API reads, the one comment post,
  `DRY_RUN=1` to print instead of posting.
- `lib.test.mjs` — vitest suite for the pure layer, driven by recorded API
  shapes in `fixtures/github/`. Run: `npx vitest run tools/server-loop/lib.test.mjs`
- `forgeclaw-loop.yml` — the workflow, byte-identical to the copy staged
  for landing (see below).

## Landing the workflow

Workflow files can only take effect from `.github/workflows/` on the
default branch, and the connector's GitHub App cannot write that directory
(403 — the installation lacks the Workflows permission). So the workflow
shipped in #259 as a review copy, to be landed separately.

**As landed (2026-10-23, F-020):** the plan above was an owner commit
through the browser. The file actually landed by a direct agent push to
`main` (`b7982d9`), on the owner's explicit authorization, after a
byte-for-byte comparison against this review copy. That push bypassed the
required `build` check, which was disclosed at the time: a workflow file
has nothing to build. The workflow's own header comment still describes
the browser route; correcting it needs a named OK for `.github/` and is
left for the next change to that file.

After landing, Actions → ForgeClaw Loop → Run workflow seeds the first
tick; after that it runs on its 30-minute schedule (GitHub's scheduler is
best-effort, and a new workflow's first scheduled tick can lag).

## Removing it

Delete `.github/workflows/forgeclaw-loop.yml`. The loop stops. This
directory becomes inert documentation of how it worked; nothing else in
the repo depends on it.
