# Trading performance review: read-only design (NO CODE, nothing placed)

Status: **PROPOSED**. Against `main` @ `1ee0026`. Operator decision (2026-10-27): trading is **propose-only** for all agents; the performance-review design comes
first, scoped against `kalshiExecution.ts` and `fundsLedger.ts`; the dollar-loss number is pending and does not block this.

## 1. Why a review comes first
Nothing in the repository shows the model has an edge: no backtest, no settled-trade record. Raising any limit (or building a placement path) before that
is autonomy without evidence. The review is the evidence engine every later rung climbs on.

## 2. What the ledger already records (verified, `fundsLedger.ts:40-90`)
Per position: `mode` (paper/real), `venue`, `market`, `side`, `price` (proposed), `probability` (the model's own P(side wins)), `contracts`, `stake`, `feeEstimate`,
`rationale`, `sources`, `status`, `approvedAt`, `placedAt`, `fillPrice`, `feePaid` (real fee when ForgeClaw placed it), `clientOrderId`, `runId`, `settledAt`, `outcome`, `pnl`,
`settledBy` (owner|kalshi), `sentiment`. Already computed: bankroll, realized and paper P&L, `settledToday`, per-category records (`settled`, `won`, `netPnl`) driving a stake multiplier.
Persisted in browser storage under `forgeclaw_funds_v1`; the whole state is one JSON blob (`FundsState`).

## 3. Metrics (computed from settled positions only; open ones are listed, never scored)
| Metric | Definition | Why |
|---|---|---|
| Market-relative Brier | Brier(model `probability`) minus Brier(market `price`) on the same bets | **The decisive one.** A model that does no better than the price it was shown has no edge |
| Calibration | reliability table in 10 bins of `probability`; Brier decomposition | Is "70%" right 70% of the time? |
| Net ROI | sum(pnl) / sum(stake), fees included (`feePaid`, else `feeEstimate`, labelled) | Money outcome |
| Fill slippage | `fillPrice - price` | Cost of acting late |
| Drawdown | max peak-to-trough of cumulative realized P&L | Survivability |
| Hit rate with 95% interval | won / settled, Wilson interval | Never shown without its interval |
| By category / venue / mode / settledBy | same metrics per slice, slices with fewer than 30 settled bets flagged "too few" | Where the edge is or is not |
| Rationale/evidence quality | share of positions with sources and a recorded falsifier (the plan view already reports "falsifier: missing") | Process, not outcome |
Paper and real are **never pooled**. Positions settled by `owner` are reported separately from `kalshi`-settled ones (different evidence quality).

## 4. How much data it takes (computed; one-sided alpha 0.05, power 0.8, a ±100% binary return)
| True edge | Settled bets needed |
|---|---|
| +20% ROI | 155 |
| +10% ROI | 619 |
| +5% ROI | 2,475 |
| +3% ROI | 6,873 |
| Hit rate 60% vs 50% | 153 |
| Hit rate 55% vs 50% | 617 |
| Hit rate 53% vs 50% | 1,717 |
The 95% interval on a hit rate is about ±18 points at 30 bets, ±10 at 100, ±6 at 300, ±3 at 1,000. Any statement made on fewer than about 100 settled bets
must say "not enough evidence". Whether the owner's bet rate reaches these counts in a useful time is unknown.

## 5. Pre-registered decision rules (PROPOSED; the operator sets the numbers BEFORE seeing results)
- **Report only** until at least 100 settled paper bets. No limit changes on any result below that.
- **Eligible to discuss raising `autoapprove` from 0** only if, on at least 300 settled bets in one mode: market-relative Brier is better than the market with its 95% interval excluding zero; net ROI after fees is positive with its interval excluding zero; max drawdown is under a limit the operator names; and no single category carries the whole P&L.
- **Automatic reversal:** one failed check on a rolling 100 bets sets `autoapprove` back to 0 (an owner action; no tool may change limits).
These thresholds are placeholders for the operator to replace; they are not recommendations to trade.

## 6. Where it would live
An **offline analyzer** under `nexus-llm/` is not the right home (it is not NEXUS-model work). Proposed: a pure module `src/lib/fundsReview.ts` plus a read-only `/funds review` command, reading `loadFunds()` only. It must not write, approve, place or call the network. Offline alternative with no app change:
a console script that exports `forgeclaw_funds_v1` and a standalone analyzer, the same pattern as the NEXUS store export. Touches no protected file in the offline form; the in-app form touches `src/App.tsx` only if a command is wired there (the command parser is in `fundsLedger.ts`).

## 7. Tests required
Golden-file tests on hand-built ledgers with known answers (perfectly calibrated, always-wrong, equal-to-market, too few bets); Wilson interval against published values; paper and real never pooled; open positions never scored; fee fallback labelled; the analyzer performs zero writes and zero network calls; an empty or corrupt ledger returns "no data", never a number.

## 8. Existing gaps this review will expose (verified, not fixed)
- The daily loss stop counts **realized** (settled) losses only (`dailyLossHit`, `fundsLedger.ts:322-327`). Unsettled exposure up to `maxExposurePct` (30%) is not in it, and the halt triggers after settlement, i.e. after the loss.
- Fills and fees are only exact for orders ForgeClaw placed; owner-placed positions rely on the owner's confirmation.
- `probability` is the model's stated number; nothing checks that it was recorded before the market moved.

## 9. Unverified
Whether any settled real or paper bets exist in the owner's browser; the real bet rate; whether `pnl` for owner-settled positions includes fees.

## 7. Operator decision, 2026-10-27 (supersedes the §5 rule on when `autoapprove` may rise above 0)
Cristian: "Wagers: approval line is a PHASE, not a wall. Set my autoapprove threshold once I give the number; below it the machine runs
hands-free, no tap. Evidence (619 settled bets minimum) widens the mandate until the tap is gone for good. Autonomous wagering runs on
regulated API venues only (Kalshi-class) — never sportsbook bots. Kill switch armed, daily stop on, bankroll ring-fenced. The number is
coming — everything else proceeds."

What the code at `1ee0026` already does for each clause (read, not run):
| Clause | Exists? | Where / how |
|---|---|---|
| Threshold, hands-free below it | yes | `/funds limits autoapprove=<N>`; `autoApprovePreconditions` (kalshiExecution.ts): real mode, status proposed, Kalshi venue, stake ≤ N in cents; one order per market; approval re-reads the live price and refuses past `tolerance`. Owner command only: no tool, model or lane can set it. |
| Regulated API venues only | yes, Kalshi only | `isKalshi(position.venue)` in the same precondition; no sportsbook path exists. |
| Daily stop on | yes, by default | `dailyLossPct` 10 (DEFAULT_LIMITS); halts real proposals and approvals until `/funds resume`. It counts SETTLED losses, so it stops new risk; it does not cancel open positions. |
| Bankroll ring-fenced | yes, owner-set | `/funds limits cap=<dollars>`; `/funds add` requires a cap first. |
| Kill switch | **partial** | There is no one-command manual halt. Today: `/funds limits autoapprove=0` stops new automatic orders; the loss-stop halts on its own. A `/funds halt` command is NOT built (new trading code: needs the operator's go). |
| 619 settled bets widens the mandate | **not built** | 619 is §4's count to detect a +10% ROI edge; a smaller true edge needs more (2,475 at +5%). Widening is a mandate change; no code does it. |

Stated plainly, so the record holds it: with `autoapprove` above 0 before any evidence, orders under N are placed on an unproven edge.
The daily stop is not the bound on a bad day: it counts SETTLED losses only, so everything open can settle against you before it acts.

**Correction (same day, after reading the approve path):** `exposure` is NOT a hard ceiling either. It is applied when a proposal is
SIZED (`sizePosition`), against positions already approved or placed; a merely-proposed position does not count. The approve step
(`applyFundsCommand` case `approve`) checks only `available` (bankroll minus open stake), not `exposure`. So:
- several proposals sized one after another and then approved together can exceed `exposure`, up to the whole available bankroll;
- on the autoapprove path, two `funds_propose` calls in the same model turn run concurrently (tool calls in one turn are dispatched with
  `Promise.all`), and the second can be sized while the first's approval is still in flight, so it too can exceed `exposure`.
The hard bound today is therefore the bankroll the cap allows, not `cap × exposure`. Read, not executed: no test reproduces this yet.
A small fix exists (re-check `exposure` at approval, counting in-flight approvals); it is new trading code and is not built without the
operator's go. Until then, setting `exposure=10` lowers the typical case but does not make "worst day = 10% of cap" true.
`N` (autoapprove) is a per-order stake limit; it does not bound a day by itself.
