# Regime gating — milestone 2: can an entry-time state separate (g)'s winners from its losers?

Ordered work (Cristian, 2026-11-04 ~19:42 CST; spec frozen at
[regime-gating-milestone-spec.md](sandbox://workspace/goals/nexus-bank-trader-agent/hidden_files/regime-gating-milestone-spec.md)).
Read-only: no Bank writes, no settings, no orders. Single process, `nice -n 10`, all pulls cached in
`regime2_work/` beside this report (scripts: `prep2.py`, `prep3.py`, `engine.py`, `analysis.py`;
results: `results.json`, `graded_with_features.json`). **Nothing here ships anything live** — milestone 2
prices the exposure lever; any gate is a canary proposal for the owner's tap.

Question, as frozen: can a regime state computed **only from data available at entry time** separate
entries into a bucket where policy (g) hold+stop-10 is positive-mean and a bucket where it is
negative-mean, on a walk-forward split (tune Oct 28–31, validate Nov 1–4)?

---

## 0. Reproduce gate — PASSED before any new number

Milestone 1's `/tmp` working set died with the VM, so the deterministic replay engine was rebuilt from
the three grade reports' stated conventions (side bid close: YES → `yes_bid` close, NO → 100 − `yes_ask`
close; **in-life scan only**, `entry < end_period_ts ≤ close_time`; a triggered exit prices at the
triggering candle's close; net = gross − actual entry fee − modeled exit fee
`ceil(0.07·p·(1−p)·contracts·100)`¢; settlements fee-free) and re-validated against every milestone-1
anchor on the frozen 20:

| anchor | rebuilt gross / net | printed | |
|---|---|---|---|
| HOLD | +887.0 / +771.4 | +887.0 / +771.4 | ✓ |
| (f) PEAK-EXIT G=3, in-life | +549.4 / +381.8 | +549.4 / +381.8 | ✓ |
| (f) PEAK-EXIT G=5, in-life | +561.4 / +395.8 | +561.4 / +395.8 | ✓ |
| (g) HOLD + STOP-10, no TAKE | +623.0 / +454.4 | +623.0 / +454.4 | ✓ |
| (h) OVERLAY G=5 | +321.4 / +114.8 | +321.4 / +114.8 | ✓ |
| (d) STOP-10 + TAKE | +234.4 / +13.8 | +234.4 / +13.8 | ✓ |

Plus the stronger checks: the 20 entry intents' recorded fees sum to **115.64¢** exactly, and the (g)
fire set reproduces the composite grade's §4 exactly (8 fires at 54 / 43 / 51 / 31 / 41 / 49 / 63 / 0).
Every number below comes off machinery that re-derives the deterministic book first.

**Populations.**
- **Frozen 20** (real fills): the first 20 confirmed `crew-lead-trigger` entries chronologically —
  5 from Oct 29–30 (7 contracts, tune) + 15 from Nov 4 (2–3 contracts, validation). Its (g) totals under
  this engine split **tune +430.0 / validation +24.3 net** — identical to the composite grade's era split.
- **Shadow population** (labeled as such everywhere): `shadow_candidates` rows recorded Oct 28–Nov 4
  (America/Chicago), graded in the journal: **728 rows**; **612 gradeable** (arm tick found in `decisions`
  at the row's exact `at_ms` with a full evaluation feature set) and graded under (g) here — tune 515 /
  validation 97. The combined grade's population was 613 of 715: the delta is the basis, not an error —
  this milestone freezes the population by CST calendar window, which adds Nov-4-evening arms the earlier
  pull (taken mid-afternoon) did not have, and excludes late-Oct-27-CST arms the earlier pull's basis
  included. The 116 ungradeable rows carry the combined grade's stated reasons (KXETH15M tickers with no
  decisions series, Oct 28 legacy-shape tickers, arm tick absent).
- **Shadow accounting provenance (verified, not assumed):** every journal row's implied entry price —
  recovered from its recorded `gross_cents` — equals its `bound_cents` on **728 of 728 rows**, and
  `fee_estimate_cents` equals the entry-fee formula at that price on 728 of 728. The journal grades
  candidates at their bound; the (g) extension below is that same accounting with the stop rule walked
  over the ticker's in-life candles. Journal arithmetic identities (net = gross − fee) hold on all 612
  graded rows, 0 failures. Shadow rows are **candidates the fleet journaled, not fills** — their entry
  price is a bound, their size is the variant's modeled contracts.

**Shadow (g) vs the journal's own hold grading, same 612 rows:** (g) net **−13,258¢** vs journal hold
net **−8,492¢**; the stop fired on **313 of 612** arms. At 1-minute granularity on arm-tick entries the
stop is a net cost on the realized tapes (the same direction as the frozen 20, where (g) +454.4 trails
HOLD +771.4): roughly half of all arms print a −10 close in-life, and the leakage exceeds the reversal
saves on these realized paths. (g)'s case was never the realized path — it is the distribution
(milestone 1) — but every bucket number below inherits this: they are (g) nets on realized tapes.

---

## 1. Frozen feature definitions (frozen before the November split was read)

- **Era split:** entry timestamp in America/Chicago — tune = Oct 28–31, validation = Nov 1–4.
- **Trailing realized volatility (vol60):** sample stdev (n−1) of the 60 Binance BTCUSDT 1-minute log
  returns whose intervals end in (t−3600 s, t], t = entry time. Buckets are **terciles of vol60 sampled
  at every minute mark of the tuning era** (5,760 samples): LOW < **0.000286** ≤ MID < **0.000529** ≤ HIGH.
  (Era-level cut points, identical for both populations — the thresholds a live gate would carry.)
- **Chop (pre-entry):** number of sign changes of (Binance 1-min close − K) over the closes in
  (t−3600 s, t], seeded by the last close ≤ t−3600 s; a close exactly at K inherits the previous sign;
  K = the entry window's strike (the Bank's own recorded strike for that window) in dollars.
  Buckets: **0 / 1–2 / ≥3** crossings.
- **Chop (first-half):** the same count over the entry window's own first half — closes in
  (window_start, window_start+450 s]. **Timing label:** causal only for a hypothetical decision made at
  the window's midpoint; for entries actually made before the midpoint it reads data from after the
  entry. Reported in the tables for the record; **never intervention-priced and never a gate candidate**,
  per the causality constraint.
- **Momentum disagreement:** on the entry tick's `lean` (for fills: the nearest evaluation tick to the
  intent, the milestone-1 convention): conflict iff `momentumShort × momentumLong < 0` (strict opposite
  signs; a zero on either side counts as agreement). Buckets: **agree / disagree**.
- **Distance at entry:** |d0| from the entry tick, recomputed `(spotCents − strikeCents)/strikeCents ×
  10,000` bps for fills; the journal row's recorded `distance_bps` for shadow (the combined grade
  verified recorded = recomputed on 613 of 613 arms). Buckets: **[0,6) / [6,8) / [8,11) / [11,∞)** — the
  [0,6) bucket sits below the owner's current 6.0 first-entry floor; it exists in the data (pre-floor-era
  entries and re-entries) and is reported, not hidden.
- **Time of day:** ET hour of entry in blocks **00–05 / 06–11 / 12–17 / 18–23**. Report only, never a
  gate candidate (per spec).
- **Hostile-bucket designation (frozen protocol):** per feature per population, the hostile bucket is the
  bucket with the lowest tune-split (g) net mean — shadow designations require tune n ≥ 10; frozen-20
  designations use n ≥ 1 and are labeled degenerate (its tune split is n=5) — and only if that mean is
  negative; otherwise the feature yields no candidate. The primary selection surface is the shadow
  population (the only one with tuning power); shadow-designated gates are additionally cross-applied to
  the frozen-20 validation split as a confirmatory read on real fills.
- **Interventions (validation split only):** (a) **STAND-DOWN** — skip the hostile bucket: Δ = saved
  losses − forgone wins, both shown; (b) **HALF-SIZE** — hostile bucket replayed at contracts/2
  (fractional contracts allowed in the model; entry fee halved in proportion; exit-fee formula evaluated
  at contracts/2).
- **A gate "works" only if** (spec, applied literally): the hostile bucket is negative-mean on **both**
  splits, the pooled friendly buckets are **non-negative-mean on validation**, and stand-down improves
  validation net by **more than the forgone-win cost** (Δ > forgone wins). Otherwise the verdict is "no
  causal gate found in this data."
- **Feature coverage:** 612/612 shadow rows and 20/20 fills carry every feature (0 missing anywhere).

---

## 2. Shadow population — per-bucket (g) net (¢): mean / p5 / n (sums in §2.1)

*Shadow-population numbers: journal candidates graded at their bound under (g) — not fills.*

### vol60 (terciles 0.000286 / 0.000529)
| split | LOW | MID | HIGH | all |
|---|---|---|---|---|
| tune | +3.0 / −38.0 / 13 | +11.2 / −245.0 / 117 | **−31.7 / −309.6 / 385** | −21.1 / 515 |
| validation | — / 0 | −7.6 / −63.9 / 44 | **−39.2 / −150.0 / 53** | −24.9 / 97 |

### chop, pre-entry crossings
| split | 0 | 1–2 | ≥3 | all |
|---|---|---|---|---|
| tune | −32.4 / −251.0 / 206 | **−32.5 / −315.0 / 135** | +1.3 / −276.0 / 174 | −21.1 / 515 |
| validation | −65.5 / −79.0 / 8 | +0.8 / −63.0 / 31 | −33.0 / −150.0 / 58 | −24.9 / 97 |

### momentum
| split | agree | disagree | all |
|---|---|---|---|
| tune | −20.4 / −288.0 / 507 | −60.6 / −231.3 / 8 | −21.1 / 515 |
| validation | −24.9 / −150.0 / 97 | — / 0 | −24.9 / 97 |

### distance |d0|
| split | [0,6) | [6,8) | [8,11) | [11,∞) | all |
|---|---|---|---|---|---|
| tune | −412.0 / −412.0 / 2 | −46.4 / −251.0 / 26 | **−72.2 / −335.0 / 49** | −12.1 / −276.0 / 438 | −21.1 / 515 |
| validation | — / 0 | +24.8 / −31.0 / 4 | −25.8 / −60.0 / 6 | −27.1 / −150.0 / 87 | −24.9 / 97 |

### chop, first-half (timing-labeled — hypothetical mid-window decision only; not a gate candidate)
| split | 0 | 1–2 | ≥3 | all |
|---|---|---|---|---|
| tune | −32.4 / −288.0 / 279 | +9.3 / −267.0 / 193 | −84.2 / −441.7 / 43 | −21.1 / 515 |
| validation | −25.2 / −150.0 / 71 | −27.9 / −111.2 / 19 | −13.1 / −60.0 / 7 | −24.9 / 97 |

### time of day, ET blocks (report only)
| split | 00–05 | 06–11 | 12–17 | 18–23 | all |
|---|---|---|---|---|---|
| tune | +7.2 / 66 | −17.1 / 162 | −16.3 / 137 | −42.1 / 150 | −21.1 / 515 |
| validation | — / 0 | −34.6 / 34 | −21.6 / 57 | −1.0 / 6 | −24.9 / 97 |

### 2.1 Bucket sums (¢), shadow
vol — tune: LOW +39, MID +1,306, HIGH −12,190 · val: MID −334, HIGH −2,079.
chop — tune: 0 −6,679, 1–2 −4,391, ≥3 +225 · val: 0 −524, 1–2 +25, ≥3 −1,914.
momentum — tune: agree −10,360, disagree −485 · val: agree −2,413.
distance — tune: [0,6) −824, [6,8) −1,207, [8,11) −3,536, [11,∞) −5,278 · val: [6,8) +99, [8,11) −155, [11,∞) −2,357.
Era totals: tune **−10,845** (515 arms), validation **−2,413** (97 arms).

**Read of the shadow tables.** Validation has **no non-negative bucket in any feature** — the friendliest
validation cells are chop 1–2 (+0.8, n=31) and distance [6,8) (+24.8, n=4), both ~zero on small counts.
November's journal is not a good book with a hostile corner; under (g) it is negative everywhere
(−24.9¢/arm overall). One structural absence: the LOW-vol tercile never prints in validation (0 rows) —
November's minutes were all mid/high vol by the October ruler, which is itself regime information.

---

## 3. Frozen 20 — per-bucket (g) net (¢): mean / p5 / n

*Tune n=5: every tune cell is 0–5 positions. These tables are the record, not a selection surface.*

### vol60
| split | LOW | MID | HIGH | all |
|---|---|---|---|---|
| tune | — / 0 | — / 0 | +86.0 / −200.8 / 5 | +86.0 / 5 |
| val |
...[truncated 13867 chars]