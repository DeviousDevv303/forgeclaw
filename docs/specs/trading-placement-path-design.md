# Trading placement path (agent-initiated orders): DESIGN ONLY, NOT TO BE BUILT

Status: **PROPOSED, build not authorized.** Per the operator (2026-10-27): propose-only for all agents now; this path is *design only*; building it is a wake-the-operator
decision. This document exists so that decision can be made on facts. Nothing in it changes behaviour.

## 1. What is true today (verified at `1ee0026`)
- **A bounded placement path already exists.** `/funds limits autoapprove=<dollars>` sets `autoApproveUnder` (default **0 = off**). A model-proposed *real Kalshi* bet at or under that stake
  is placed immediately by `maybeAutoApprove` (`kalshiExecution.ts:555-573`) through the same approve path as a typed `/funds approve` (re-quote, aggregate and per-shard balance gates, fail-closed).
  A sibling order on the same market in a live state holds the new one for the owner.
- Enforced limits: stake and exposure caps in sizing (`fundsLedger.ts:~296`), Kelly fraction, optional `capAmount` on deposits, and a **loss stop**: `halted` is set when settled losses reach `dailyLossPct`, blocks
  real proposals and approvals (`:343`, `:594`) and only the owner's `/funds resume` clears it ("no tool can").
- **Not present:** a mandate model, a manual kill switch, a journal entry written *before* the send (`onPlaced`, `kalshiExecution.ts:361`, fires after), and co-sign on limit changes (co-sign is per tool call).
- Under the default `autonomous` posture no tool call is co-signed; `funds_*` tools carry no extra gate beyond the above.

## 2. What a placement path for a swarm would have to add (requirements, not code)
| Requirement | Today | Gap |
|---|---|---|
| One owner of the purse | balance gates read Kalshi per shard | keep; agents may aggregate *exposure*, never balances |
| A mandate (what may be traded, how much, until when) | `autoApproveUnder` is a single dollar threshold | a mandate record owned by the operator, expiring, scoped by venue/category/stake/daily count |
| A kill switch independent of the model | `halted` (loss-triggered) | an owner-only `/funds stop` that halts proposals and approvals immediately; no tool may clear it |
| Journal before send | after | write an intent record (position id, client order id, run id, price, stake) *before* the POST, then reconcile; a send with no journal write must not happen (fail closed) |
| Unsettled-loss awareness | realized only | include open exposure marked to the quote in the daily stop |
| Limits not model-writable | `/funds limits` is an owner-typed command | assert by test that no tool path can change `limits`, `halted` or the mandate |
| Replayable provenance | `runId` on the position | add the execution reference to the journal; one row per order |

## 3. Constraints that do not move
`executeTool()` stays the only execution path; orders still go through `runFundsCommandWithExecution`; no swarm agent calls the exchange client directly. Fail-closed at every stage is never relaxed.
The existing Guardian posture semantics are the owner's (2026-10-25) and are not edited. Per-shard checks and read-only evidence boundaries stay as they are. Financial changes ship separately from every other change.

## 4. Preconditions before anyone proposes to build it
1. The performance review (`trading-performance-review-design.md`) has run and its pre-registered rules were met on at least 300 settled bets.
2. The operator has set the dollar loss number (`capAmount`) and the daily stop, in writing.
3. Ring-fenced risk capital: money whose loss changes nothing at home (the operator's rule, not enforceable in code).
4. A separate Guardian review of the mandate and kill-switch design, and the named per-file authorization (`forgeTools.ts`, `kalshiExecution.ts`, `fundsLedger.ts`) for the build.

## 5. Wagers (sports) are a separate, later step
Structural vig makes unproven edges lose by default, so the evidence bar is higher than for exchange trading. Kalshi is the only venue the code can place on. Other venues are owner-tracked and owner-settled. Terms-of-service risk of automated betting on any sportsbook is **not reviewed here**.

## 6. Unverified
No order has been placed by this path in any evidence I can see; whether `autoapprove` has ever been set above 0 is a browser-side fact no lane can read.
