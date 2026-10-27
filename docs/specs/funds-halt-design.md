# `/funds halt`: the kill switch (stop-only)

Status: DESIGN, written before the code it describes. Operator amendment 2026-10-27 to the 00:01 design-only ruling, verbatim:
"halt: YES — confirmed, my conscious amendment to the 00:01 design-only ruling. Build spec: /funds halt as stop-infrastructure ONLY.
A halt flag in the ledger; while halted, every order placement is refused and journaled with the reason; unhalt is my explicit
command and nobody else's. The design states what happens to open positions (settle as-is vs cancel) before any code. Small,
tested, Guardian-reviewed."

## What it is
One owner command, `/funds halt [why]`, that sets the ledger's existing `halted` flag (`FundsState.halted`, the same flag the daily
loss stop sets). Every path that already refuses while halted therefore stops at once. It never places, sizes, approves, cancels,
sells or moves anything.

## While halted
| Path | Behaviour | Where |
|---|---|---|
| New real proposal (`funds_propose`, mode real) | refused: `Not proposed: HALTED: …` | `proposePosition` (existing check) |
| Owner approval of a Kalshi proposal (`/funds approve`) | refused **before any Kalshi read**, nothing sent, proposal unchanged | `executeApproveInner` (new early check) |
| A halt typed while an approval's price/balance reads are in flight | refused at the ledger re-read, before the order key is saved or anything is sent | `executeApproveInner` step 3 → ledger `approve` (existing check) |
| Autoapprove | cannot fire: it only runs on a fresh proposal, and real proposals are refused; if reached, it goes through the same approve path | `maybeAutoApprove` → `executeApprove` |
| `/funds approve-all` | each approval refused as above | `executeApproveAll` → `executeApprove` |
| Ledger approval of a non-Kalshi proposal | refused (existing check) | `applyFundsCommand` case `approve` |
| Paper proposals | continue: no money moves | unchanged (the loss stop behaves the same) |

## Open positions: SETTLE AS-IS. Nothing is cancelled.
- ForgeClaw's Kalshi orders are immediate-or-cancel at the cross (`placedMessage`: "the rest was cancelled (immediate-or-cancel)"),
  so no resting ForgeClaw order exists for a halt to cancel.
- Getting out of a filled position means SELLING, which is a new order: a stop-only switch must not place one. Selling stays the
  owner's own action on Kalshi.
- Open positions keep settling from Kalshi's own result (`funds_settle`, `autoSettleKalshiPositions`), and owner settlement of other
  venues is unchanged, so the ledger stays true while halted.
- An order already sent before the halt completes; its result is recorded. A resumed approval (an earlier attempt that ended
  Unknown) only reconciles by lookup and never sends again, so the halt does not block it: blocking it would leave a possibly-live
  order unrecorded.

## Journaled with the reason
- An approval refused by the halt calls `onFailure` with stage `approve` and the halt's reason; the app routes that to its failure
  log (`emitFailure`, source `kalshi`), the log `error_report` reads.
- A proposal refused by the halt is a tool error whose text carries the reason (`[TOOL ERROR] Not proposed: HALTED: …`).
- The halt itself is recorded in the ledger (`halted.at`, `halted.reason` = "Stopped by the owner with /funds halt (why)."), shown by
  `/funds` and `funds_status` until lifted. A second halt changes nothing and keeps the first reason.

## Unhalt: the owner's command only
`/funds resume` (existing) lifts it, and lifts the loss stop's halt too. `/funds` commands run only from text the owner types in the app
(`App.tsx` → `runFundsCommandWithExecution`); no tool, model or lane can run them, and the usage text says so.

## Not in scope
Exposure enforcement at approval (withdrawn by the operator), any change to sizing, limits, autoapprove or placement logic.

## Tests (required before review)
Fresh approval refused before any read; loss-stop halt honoured on the Kalshi path; halt typed mid-approval stops the send;
autoapprove and approve-all place nothing; resume restores approval; the refusal is journaled with its reason; parse; open positions
untouched and still settle; double halt keeps the first reason; paper continues; usage text.
