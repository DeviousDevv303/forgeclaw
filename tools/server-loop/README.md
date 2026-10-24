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
channel protocol). The runner keeps nothing between runs, so a duplicate
tick after an answer is a no-op, and removing the loop loses no bookkeeping.

## Why deterministic

Stage 1 makes **zero model calls** — the owner's token doctrine: no burning
tokens for no reason. The frequent light passes belong to the cheap
Qwen/DeepSeek Actions path (the "16B" canary), which becomes the execution
engine at Stage 2 after this channel reviews Stage 1. Everything Stage 1
posts is assembled by `lib.mjs` from state fetched that run; nothing is
remembered, inferred, or phrased by a model.

## Stage 2 — Kalshi price snapshot

The second loop job spends none of the owner's browser quota. The app's
Kalshi price reads originate from the owner's browser, and Kalshi
rate-limits that per-IP quota — the 429 wall that kept killing reads
mid-answer. So a scheduled workflow (`kalshi-snapshot.yml`, every 15
minutes) runs `kalshi-snapshot.mjs`: it reads Kalshi's **public**
market-data API — unauthenticated, no keys, no credentials — for the
watchlist in `kalshi-watchlist.json` (UFC/MMA and football game series by
default; add a series or a single ticker there, no code change) and
commits ONE JSON snapshot to the **`kalshi-snapshot-data`** branch:

```json
{ "fetched_at": "…", "source": "kalshi-public-api", "http_status": 200,
  "error": null,
  "markets": [ { "ticker": "…", "event_ticker": "…", "yes_bid": 0.5,
                 "yes_ask": 0.51, "no_bid": 0.49, "no_ask": 0.5,
                 "last_price": 0.51, "volume": 21623.88,
                 "open_interest": 20073.95, "close_time": "…" } ] }
```

The app (`src/lib/kalshiServerSnapshot.ts`) reads that file from the data
branch's raw URL and prefers it for listing reads when it is fresh
(15 minutes, the workflow's cadence) and covers the query's
ticker/event/series. The honesty rules are enforced by shape, not trust:
any drift — an unparseable `fetched_at`, a non-numeric price, a failed
fetch's `error` document — makes the whole snapshot unavailable, and the
listing falls back to the live read with all of its existing behavior
(spaced reads, 429 backoff, the local last-good snapshot). Absent quotes
stay absent: a market Kalshi listed without a price carries nulls, never
a guessed number. Money paths never touch the snapshot — settlement,
order-book, and the approve-time re-quote stay live-only, exactly as
before Stage 2.

Failure is data, not silence: if a fetch fails, the fetcher still writes
its snapshot — the `error` field naming what failed, only the markets
that really read — and exits non-zero *after* writing; the workflow
publishes it anyway, so the failure is visible in the file the app reads
(and the app fails closed on it) instead of a stale file posing as fresh.

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
- `kalshi-snapshot.mjs` — the Stage 2 fetcher: watchlist series/tickers →
  one JSON snapshot; writes an error snapshot and exits non-zero on
  failure, never fabricates a price.
- `kalshi-watchlist.json` — the series and tickers the snapshot covers.
- `kalshi-snapshot.test.mjs` — vitest suite for the fetcher. Run:
  `npx vitest run tools/server-loop/kalshi-snapshot.test.mjs`
- `kalshi-snapshot.yml` — the Stage 2 workflow review copy; it lands in
  `.github/workflows/` the same way Stage 1's did (Claude's lane or the
  owner — the connector cannot write workflow files), and the two copies
  must stay byte-identical. Until it lands, the data branch holds the
  bootstrap snapshot and the app simply finds it stale and reads live.

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
