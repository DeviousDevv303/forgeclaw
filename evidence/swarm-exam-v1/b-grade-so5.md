# B-GRADE — Kimi SO#5 vs the live composite, mandate m-1793910002683-161c732d (closed)

Offline replay only. Sources actually read: D1 `order_intents` + `settlements` for the mandate (35 intents, 5 settlements), `decisions` final ticks per ticker, `trigger_watch.log` (FORMATION / POSITION OPEN / EXIT STOP-10 prints), `book_polls.jsonl` (in-position book polls). Every live net below re-foots from D1 cashflows − fees (fees_micros/10000) and matches the verified population; the 18 positions sum to +12.91¢ vs the stated +12.93¢ (W3/W14 rounding at the cent level in the source figures). Cumulative fees from D1 intents foot to exactly 138.85¢ (entries + exits + the W9 partial).

**Headline verdicts**
- **A (stop-band rebuild): LOSES on the only reconstructable evidence; overall UNRESOLVED.** On the 2 of 11 stopped windows where the recordings can actually run the persistence test, A nets **−23.74¢ vs live**. The other 9 windows are UNRECONSTRUCTED (book recording stops at the live exit — see §A). Modeled bounds for those 9 are positive (+46 to +168), but they are carried entirely by hold-conversions on windows that happened to win, and the per-window worst case is a −223/−239/−231 hold where live lost −57/−82/−54.
- **B (momentum veto): BEATS live by +40.42¢ — on exactly one vetoed entry.** The veto fires once in 17 windows (W4 re-entry). Kimi's stated evidence basis for B (YES −217.6 over 7 vs NO +231.0 over 10) **does not foot** — verified side totals are YES −274.92 over 8 windows (9 positions) and NO +287.83 over 9 windows. Direction holds; counts and magnitudes do not.
- **C (slippage footing): the two totals measure different things and agree by offset, not by basis.** Muse's **161¢ foots exactly** as (stop trigger − bid at the first STOP-10 fire print) × contracts, summed over the 10 stop windows excl. W9. The journal-fill basis — (trigger − actual exit fill) × contracts over the 8 windows that filled through — is **160¢**. Kimi's **148¢ foots on neither basis** (nearest reconstructions 149 and 160−12; no stated rule produces it) → 148 is UNRECONSTRUCTED.

---

## §C first (the footing everything else uses)

Definitions: side entry price and side exit fill from D1 `avg_yes_price_micros` (NO side = 100 − yes price). Stop trigger = side entry − 10. "Through" = fill below trigger.

| Win | Side | n | Entry | Trigger | Log bid at first STOP-10 print | D1 exit fill | Trigger−fill (per contract) | × n (journal basis) | Trigger−print (per contract) | × n (print basis) |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 1600 | YES | 3 | 73 | 63 | 59 | 57 | 6 | 18 | 4 | 12 |
| W6 1715 | NO | 4 | 58 | 48 | 41 | 41 | 7 | 28 | 7 | 28 |
| W8 1745 | NO | 3 | 64 | 54 | 46 | 47 | 7 | 21 | 8 | 24 |
| W10 1815 | NO | 3 | 73 | 63 | 42 (2nd print 46) | 51 | 12 | 36 | 21 | 63 |
| W11 1830 | YES | 3 | 66 | 56 | 52 | 49 | 7 | 21 | 4 | 12 |
| W12 1845 | NO | 1 | 64 | 54 | 50 | 45 | 9 | 9 | 4 | 4 |
| W13 1900 | YES | 2 | 56 | 46 | 46 | 40 | 6 | 12 | 0 | 0 |
| W15 2045 | YES | 3 | 74 | 64 | 58 | 59 | 5 | 15 | 6 | 18 |
| W16 2100 | YES | 4 | 56 | 46 | 46 | 46 | 0 | 0 | 0 | 0 |
| W17 2115 | YES | 3 | 66 | 56 | 56 | 56 | 0 | 0 | 0 | 0 |
| **Total** | | | | | | | **59 (sum of per-contract values, 8 through-windows)** | **160** | | **161** |

W9 1800 is excluded from both totals, correctly: its blended exit fill was 78.91 (above its 65 trigger) under the amended blended rule, even though its first fire print was bid 58 and a 0.01-contract partial filled at 53.

**What each number is:**
- **161 (Muse census) = print basis.** It measures how far the tape had already fallen *at the moment the stop fired* (trigger → first print bid), not what the fill lost. Composition check: it loads 63 onto W10 (print 42, filled 51 — most of that "leak" was never paid) and 0 onto W13 (print at trigger, filled 6 through — real leak it misses).
- **160 (journal basis) = money basis.** Trigger → actual fill, per contract × contracts. This is the leak that actually left the book. Per-contract sum counted once per window is 59; the often-quoted "mean 7.75¢/contract" foots on neither basis (journal weighted mean = 160/22 contracts = 7.27; print mean = 161/29 = 5.55 over the 10 windows' contracts) — that mean is UNRECONSTRUCTED.
- **148 (Kimi) = UNRECONSTRUCTED.** Nearest misses: 149 = print basis with W10's *second* fire print (46) instead of the first; 148 = journal basis 160 − 12 (= W13's window leak, or W1 counted once instead of ×3). Both require an unstated rule change. Until Kimi names her basis, 148 governs nothing — and by the same discipline, 161 should be quoted as print-basis, not as fill leak. The fill-basis total that belongs in any SO#5 pricing is **160¢**.

## §A — SO#5 stop-band rebuild (persistence G(2) + stop-limit at trigger−3, 45 s deadline, else hold)

Method: replay `book_polls.jsonl` side-bid series per stopped window. Persistence arms only after **2 consecutive polls** with bid ≤ trigger. Limit fills modeled at the limit price (trigger−3) when a poll at/after arming shows bid ≥ limit within 45 s; exit fees carried from the live exit at similar size/price (labeled, not recomputed). Settlement results from D1 `decisions` final-tick distance sign (margin noted), except W13 (decisions recorder sparse that window — result taken from the log's shadow WINDOW-ROLL exit print of 89 on the YES side; medium confidence) and W17 (+0.8 bp at 18 s remaining; low-medium confidence).

**The structural data limit, stated once:** book recording is written by the in-position loop and *stops when the live exit fills*. For 9 of 11 stopped windows the recording contains exactly **one** sub-trigger poll — the fire tick itself. Whether a second consecutive sub-trigger tick occurred is therefore not in any of the three sources. Those windows are UNRECONSTRUCTED for the persistence step, and no honest total for A exists. What can be graded:

**Reconstructable windows (2):**
- **W9 (the blip-stop A was built to kill): persistence does NOT save it.** Polls: bid 58 at 22:56:06, then 63 at 22:56:33 — two consecutive polls ≤ trigger 65, so A arms. Limit 62 fills at the arming tick (bid 63 ≥ 62), modeled exit 62. A net ≈ 186 − 225 − 3.94 entry fee − 3.50 exit fee (carried) = **−46.44 vs live +4.30 → A loses 50.74 on W9.** At the ~8–27 s poll cadence, "2 consecutive ticks" is a ~30–55 s persistence, and W9's dip lasted longer than that. The blip class A targets is shorter than the tick grid A is specified on.
- **W10: persistence arms, limit beats the fill.** Polls 42 then 46 (both ≤ 63) arm A; limit 60 has no further polls (recording ends at the live fill), but `decisions` show the NO side strengthening monotonically to settlement (final distance −30.7 bp), so the NO bid necessarily crossed 60 en route to 100 — fill at the 60 limit modeled, timing unobserved. A net = 180 − 219 − 4.14 − 5.25 (carried) = **−48.39 vs live −75.39 → A gains 27.00 on W10.**
- **Reconstructable subtotal: A − live = −23.74¢ (n=2).**

**Unreconstructed windows (9) — bounds only:**
- If all 9 had armed and filled at trigger−3: Δ vs live = **+46.00** (W1 +9, W6 +16, W8 +12, W11 +12, W12 +6, W13 +6, W15 +6, W16 −12, W17 −9; the last two fill *below* their live fills because both live fills were exactly at trigger).
- If all 9 had failed the limit and held to settlement: Δ vs live = **+167.74** (hold nets: W8 +103.16, W11 +97.28, W13 +84.55*, W15 +73.95, W17 +97.28* vs W1 −223.14, W6 −238.83, W12 −65.62; * = confidence-flagged results above).
- A-total bounds: **+22.26 to +144.00** — positive in every modeled bound, and worthless as a certification: the sign is decided by the 9 windows the data cannot replay, and 7 of the 11 stopped windows settled in the position's favor, so *any* exit-delaying rule looks good on this population in hindsight (plain hold-to-settlement on all 11 = +386.75 vs live, with a −758.49 loss bucket underneath).

**Honest worst case (the price of A, per window):** on a true dump the 45 s deadline converts a bounded stop into hold-to-zero. Realized examples in this population: W1 live −57.29 → hold −223.14; W6 −81.61 → −238.83; W16 −53.86 → −230.90. That is ~4× the live loss on the windows where the stop was right, and it is not hypothetical — 4 of the 11 stopped windows (W1, W6, W12, W16) settled against the position.

**§A verdict:** A **loses** to the live composite on reconstructable evidence (−23.74, n=2) and its headline mechanism fails on the one blip-stop in the population. Per Kimi's pre-registration the replay holds veto rights where it contradicts — on the evidence that exists, it contradicts. A cannot be certified as beating the composite from these recordings; a fair re-grade needs tick recording that continues past the live exit.

## §B — SO#5 entry gate (momentum veto on YES entries)

Momentum source: the FORMATION prints in `trigger_watch.log` carry `ms`/`ml` (momentumShort / momentumLong signs) at each entry. `ml` is the only long-momentum field in any source; that it equals the specified *15-minute* momentum is **UNVERIFIED** — no source documents the lookback. Grades below are on `ml`, labeled as such. Side totals are journal all-in nets.

**Claim check (fails):** verified YES = **−274.92 over 8 windows / 9 positions** (W1 −57.29, W4 +37.04/−40.42, W11 −60.97, W13 −38.81, W14 +33.42, W15 −54.13, W16 −53.86, W17 −39.90); verified NO = **+287.83 over 9 windows** (W2 +112, W3 +185.01, W5 +114.96, W6 −81.61, W7 +112, W8 −61.08, W9 +4.30, W10 −75.39, W12 −22.36). Sum foots to the mandate total. Kimi's −217.6/7 and +231.0/10 foot on **no** subset of the journal windows (subset-sum checked): −217.63 is exactly the YES total *excluding W1*, with no stated rule for the exclusion, and no 10-window NO population exists (there are 9). The directional claim — YES bled, NO paid — is true and stronger on the verified numbers than on hers. Her magnitudes should not be quoted.

**Replay (veto = remove YES entries with ml < 0):**

| Entry | Side | ml at formation | Vetoed? | Live net |
|---|---|---|---|---|
| W1 | YES | 0 | no | −57.29 |
| W4 first | YES | 0 | no | +37.04 |
| W4 re-entry | YES | **−1** | **YES** | −40.42 |
| W11 | YES | 0 | no | −60.97 |
| W13 | YES | 0 | no | −38.81 |
| W14 | YES | 0 | no | +33.42 |
| W15 | YES | 0 | no | −54.13 |
| W16 | YES | 0 | no | −53.86 |
| W17 | YES | 0 | no | −39.90 |
| W2, W3, W5, W6, W7, W8, W9, W10, W12 | NO | — (W5, W8 ml −1, but the veto as specified binds YES only) | no | +287.83 total |

**§B verdict:** B **beats** the live composite on this population, +40.42 (mandate total would read +53.35 instead of +12.93) — entirely from vetoing the W4 re-entry, an entry that *also* filled at 88 (above the 85 no-chase cap) and re-entered after a discretionary exit (a class later banned by one-and-done). Evidence weight: n=1 veto, and it is not independent of those other defects. B matches live on 16 of 17 windows by construction (ml was never negative at a YES first entry). That is a pass on this population with the thinnest possible base — it is not evidence the veto prices the YES bleed, most of which (W11/W13/W15/W16/W17, −232.63) occurred at ml = 0, where B is silent.

---

## SHADOW ROW — not part of the 17-window replay population (added on Kimi's relay, 2026-11-05)

Window **KXBTC15M-26NOV052200-00**, ~20:47–20:54 CST, on the dark successor mandate — no entry fired, by design (mandate dark; nothing to veto in live size). Formation facts as reported by the crew lead (not journal-verified — no position existed, so no intents or book polls attach to this ticker in the grade's sources): BLOWOUT then SHELF prints for **YES**; distance **17.1 → 15.0 bp** (fading across the ticks); **momentumShort −1, momentumLong −1** — negative on both horizons against a YES arm; YES ask **77¢** on the first print, **85¢** (at the no-chase ceiling) on the shelf print; spot $76,141.45 → $76,125.45 vs strike $76,011.65.

**Bearing on the SO#5-B case: supports it, narrowly.** Under B as specified, this YES entry would have been vetoed had the desk been live — ml < 0 at a YES *first* entry, which never occurred inside the replay population (the population's only ml < 0 YES print was the W4 re-entry). It is therefore the veto's first live shadow point and proof the gate fires on the pattern it names, not just in replay. Two limits keep it a shadow row and out of the numbers: (1) no entry was taken and no settlement outcome is recorded in the grade's sources, so it carries **zero P&L evidence** — it shows the veto would have fired, not that firing would have paid; (2) it does not cure §B's base problem — inside the population the veto still rests on n=1, and the bulk of the YES bleed printed at ml = 0. It weakens nothing in the B case; it strengthens only the mechanical claim (the gate triggers correctly on live tape), not the expectancy claim.

### Bottom line for the wire decision (reporting only, per the grade's remit)
- A: **loses on reconstructable evidence (−23.74, n=2), unresolved in total; its anti-blip premise failed its one test (W9).**
- B: **beats live (+40.42) on a single, non-independent veto; its stated evidence basis does not foot (verified: YES −274.92/8, NO +287.83/9).**
- Slippage: quote **160¢ (journal fill basis)** as the money leak; **161¢ is the print basis** and foots exactly as such; **148¢ is UNRECONSTRUCTED** on any basis found in the data.
- UNRECONSTRUCTED, named: persistence outcomes for 9 of 11 stopped windows (recording ends at the live exit); the "mean 7.75¢/contract" figure on both bases; the 15-minute equivalence of the `ml` field; W13/W17 settlement results at full confidence (shadow-roll print / +0.8 bp at 18 s respectively).
