# Monte Carlo engine — canonical description (owner record, 2026-11-04)

Stated by Muse in chat 2026-11-04 20:38 CST; endorsed by the owner the same
evening as the engine's canonical description, with the two honesty rules below
hardened as standing rules.

## Standing honesty rules

1. **Trust the orderings and exchange rates, never the point values.**
2. **Offline evidence, never a live signal.**

The engine's product is decisions, not predictions. Its limits are its
credentials: every number prints with its error model attached, and every
verdict is provisional until the tick layer confirms it.

## What it is

A replay engine for the Bank's own trades. It takes the frozen 20 real
crew-lead fills — actual tickers, sides, entry prices, contract counts, fees —
and replays each one 10,000 times under resampled BTC price paths, running a
policy (HOLD, the shipped composite (g), the peak-exit overlay (h)) identically
on every path. One realized trade says what did happen; 10,000 replays say
what the policy does — mean, 5th-percentile tail, max drawdown, ruin
probability, per-window expectancy.

Internals:
- Paths are block-bootstrapped from real Binance BTCUSDT 1-minute returns
  (Oct 28–Nov 5 2026, 11,524 returns, contiguous 20-minute blocks, so
  volatility clustering is preserved) — never a synthetic Gaussian fan.
- Spot paths convert to binary prices through a lognormal map; σ calibrated
  walk-forward on Oct 28–31 (σ = 0.000567 primary), validated on held-out
  November minutes at 5.41¢ mean absolute error; a sensitivity run at
  σ = 0.00040 reproduced every ordering.
- Exit slippage is drawn from the Bank's own 12 measured fill-vs-decision
  deltas. The settlement rule reproduces 15 of 15 recorded market results.
- Reproduce gate: before any sim number exists, the engine must re-derive the
  deterministic grades exactly — every anchor to 0.1¢, entry fees summing to
  exactly 115.64¢, the (g) fire set trade-for-trade. Passed twice, the second
  time from a from-scratch rebuild after a VM replacement wiped the first
  working set.

## What it found (milestone 1, 2026-11-04)

- The (g)-vs-(h) question became an exchange rate: shipping (g) over (h)
  trades +187¢ of mean for +58¢ of left tail (primary calibration). The
  owner's 19:42 keep-(g) tap ran on that price.
- (h) peak-exit+stop-10: best left tail in every cut under both calibrations
  (all-20 p5 −680.3 vs (g) −738.6), worst November sim mean (−238.9) — its
  deterministic November crown (+374.7) was friendly tape, not expectancy.
- HOLD: best sim mean (+430.7), worst tail (p5 −928.6, ruin 0.462) — its
  +771.4 deterministic print was a tail bet that landed.
- Both active exit policies are negative-mean in the November subset while
  HOLD sits at ~0 — the finding that reframed the evening from exit choice
  to exposure, and sent the regime question to milestone 2 (verdict: no
  causal gate found in this data).

## Limits (stated, never hidden)

- Price-map error ~5.4–6.5¢ per candle-minute; recorded NO fills sit
  systematically rich to the map.
- Paths are drawn independently per window; real windows correlate, so
  aggregate tails are optimistic.
- 1-minute granularity is biased against active exits: intra-minute crosses
  are invisible and exits price at the triggering minute's close, while the
  live watch polls in seconds. Active policies' sim means are biased down by
  an amount this data cannot measure — the reason milestone 3 re-grades at
  tick granularity before any exit verdict is final.
- Reversal-class rows price tail geometry, not reversal events.

## When and how it is used

The ladder is three deep: deterministic grade → Monte Carlo → owner's tap.
Reach for the engine whenever a policy question outruns one tape: a new exit
or entry variant, a gate change, a sizing/exposure question (ruin and
drawdown live here), or re-testing an old decision against new data. Never
for in-the-moment trade calls. Milestone 2 (regime gating) reused the same
machinery; milestone 3 (time-stop, scale-out, OFI veto) will too, with the
tick re-grade sharpening this middle rung.

## Staleness rule — when a re-run is due (owner record, 2026-11-04 20:42 CST)

The engine runs on evidence changes, never on a clock. A re-run is due when
any of these fires:
1. A new policy variant is proposed (it needs its own print before ship talk).
2. The graded population grows by its own size (~20 new graded fills since
   the last print — the frozen set doubles).
3. A new era starts: new mandate, new month, or a vol-regime break (σ is
   calibrated walk-forward per era; a stale σ invalidates the price map).
4. A ship decision leans on the sim (the print behind a tap must be fresh
   against the current population, reproduce gate re-passed on current
   grades).

Automate the question, never the verdict: a weekly due-check counts fills
since the last print and reads era/σ status, reporting due / not due. The
re-run itself stays a dispatched, reproduce-gated job (sequenced around
training load), and its output remains an input to the owner's tap — never
an auto-ship (frozen in the milestone-1 spec).
