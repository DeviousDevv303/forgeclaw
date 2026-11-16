# Gate A — Run 31 static audit (Synthetic Intuition, Final Build Verdict)

**Scope.** Read-only audit of the Run 31 training data, answering the three
Gate A questions from the Final Build Verdict on ForgeClaw #235: (1) does
recognition precede the action in the row text; (2) do minimal pairs exist;
(3) what is the marginal action distribution. No training, no model runs.

**Files audited.**
- Full mix: `~/workspace/run31/data.jsonl` — 91,989 rows (instances, with
  repetitions), sha256 `b95abd92ecc6cb576c2d486f672c0e7bbc64f8529eea2c2f3515daaa23b31253`
  (per `~/workspace/run31/mix-report.json`).
- Tranche-6 component: `~/workspace/run31-campaign/data/desk-live-form-tranche6.jsonl`
  — 7,000 unique rows, sha256 `1acacc6a4b4cbe3d91b6c38e6f5d57e547ae34118db0710c9f5c4cb42252e6f6`.
- Pair linkage and generator facts: `~/workspace/run31-campaign/data/build-manifest.json`
  (the generator's own per-row fact record). Pair *membership* is taken from
  the manifest; every pair *property* reported below is re-verified from the
  row text itself, not from the manifest.
- Design intent: `~/workspace/run31-campaign/data/gen_tranche6.py` header
  (deviations C1–C5), `~/workspace/run31-campaign/AUDIT.md`,
  `~/workspace/run31-campaign/FORENSIC.md`, `~/workspace/run31/GRADE-REPORT.md`.

**Definitions.** "Desk rows" = kinds `propose`, `propose_fee`, `desk_pass`,
`assess_exit`, `assess_hold` (the desk-live-form classes). "Entry rows" =
`propose` + `propose_fee` + `desk_pass`. A "recognition signal" in a
completion = an explicit `P(YES)`/`P(NO)` figure or the `"probability"` key
of the propose call. "Decisive" = |distance| ≥ 3 bps (the grading
convention), with |d| ≥ 5 reported where it differs. Distances, books, and
stated edges are parsed from the prompt/text with fixed regexes
(`BTC is ([+-]?[0-9.]+) bps`, `edge ([+-]?[0-9.]+)c`, `P\(YES\)\s*([0-9.]+)`,
`vs (yes|no) ask ([0-9.]+)c`); every count below names its denominator and
its parse base. Two measurement corrections were made mid-audit and are
flagged where they bite: stated probabilities are compared at ±0.005
tolerance (the propose rationale prints 3 decimals, the pass answer 2), and
the "cap band" is measured on each row's *own stated side ask*, not on the
prompt-derived complement (see §3.3 — the derivation is wrong on NO-side
rows and initially produced phantom cap violations).

---

## 1. Recognition ordering

Recognition *inputs* are never the problem: the prompt states the distance
and the book before anything is generated in 3,800/3,800 tranche-6 entry
rows and 26,640/27,413 full-mix entry rows (the 773 unparseable mix rows
are Run-25-base rehearsal rows that share the kind names but use an older
dialogue dialect — market lookups, not desk-live-form rows). The question
is the order inside the taught completion. It is layered, and the layers
point in opposite directions:

| Layer | Measure | Tranche 6 (unique) | Full mix (instances) |
|---|---|---|---|
| Route token | `<\|route:…\|>` precedes the first recognition element | 5,000/5,000 rows that carry one (100%) | 31,013/31,013 (100%) |
| Call name | `funds_propose` (the act itself) precedes the first recognition element | 2,347/2,347 propose+fee rows (100%) | 18,424/18,424 (100%) |
| Call key order | `"probability"` before `"side"` inside the call | 2,347/2,347 (100%) | 12,485/18,424 (67.8%) |
| Call key order | `"side"` before `"probability"` (old dialect) | 0 | 5,939/18,424 (32.2%) — exactly tranche 4 (5,166) + Run-25 base (773) |
| Pass statement | `P(YES)` precedes "No trade" in `desk_pass` answers | 1,453/1,453 (100%) | 8,989/8,989 (100%) |
| Assess action | `EXIT`/`HOLD` word precedes `P(YES)` in `assess_hold` | 1,200/1,200 (100%) | 3,600/3,600 (100%) |
| Assess action | `assess_exit` rows carrying any probability signal | 0/1,200 (0%) | 0/3,600 (0%) |

**How many rows carry an explicit recognition signal at all:**
5,000/6,200 tranche-6 desk rows (80.6%) and 31,013/34,613 full-mix desk
rows (89.6%). The rows with none are exactly the `assess_exit` rows
(1,200 unique / 3,600 instances): their only recognition content is the
bid-vs-entry comparison, and `EXIT` is the first token of the answer.

**Reading.** The enter/pass decision is carried by the route token and,
for entries, the `funds_propose` call name — both emitted *before* any
recognition figure exists in the completion, in 100% of entry rows.
Recognition precedes an action only at two joints: the *side* choice in
the new-dialect key order (probability + rationale before side), and the
*pass statement* in the direct frame (P(YES) first, "No trade" last). In
the assess frame the action word precedes the probability in every HOLD
row, and EXIT rows state no probability at all. The old dialect still
supplies 32.2% of the mix's propose instances with side before
probability, e.g. tranche-4 row `r29e-0927`:

> `"side":"yes","price":0.83,"probability":0.915,"rationale":"P(YES) 0.915 at +12.5 bps vs yes ask 83.0c; edge +7.5c after fees."`

versus the tranche-6 order (`r31e-1764`):

> `"probability":0.965,"rationale":"P(YES) 0.035 at -15.9 bps vs no ask 78.4c; edge +16.9c after fees.","side":"no","price":0.784`

In both dialects the call that *is* the entry — `"name":"funds_propose"` —
opens before either figure appears.

## 2. Minimal pairs (tranche 6)

Pair linkage from the build manifest; all properties below re-verified
from prompt/text. **2,410 pairs exist. 4,820 of 6,200 desk rows (77.7%)
are pair halves; 1,380 desk rows are unpaired singles.** Every family
count matches the generator's design census in `AUDIT.md` exactly.

| Family | Pairs | Same state verified | What varies | Action flip |
|---|---|---|---|---|
| Conversion (`c*`) | 400 | same ticker 400/400, same distance 400/400, same stated P(YES) within ±0.005 400/400, books differ 400/400, edges in design bands (propose half ≥ +1.5c, pass half ∈ [−3, +0.5)c) 400/400 | the book | propose ↔ pass, 400/400 |
| Straddle (`e*`) | 160 | same ticker/distance 160/160, P within ±0.005 160/160 | the book (tight) | propose ↔ pass, 160/160; edges straddle the +0.5c desk minimum (high half ≥ +0.5 in 160/160; low half ∈ [−3, 0) in 94/160, ∈ [0, +0.5] in 66/160) |
| Sign-flip (`s*`) | 450 | same ticker 450/450, distance exactly mirrored 450/450 | distance sign | action does *not* flip (both propose); the **side** flips 450/450 |
| Near (`n*`) | 200 | same ticker, mirrored distance, \|d\| < 3 on generator facts 200/200 (197/200 on the printed 1-decimal distance) | distance sign | action constant — **both halves are `desk_pass`** 200/200; the aligned side flips |
| Assess (`a*`) | 1,200 | same position (ticker/side/entry) 1,200/1,200, held-side bid straddles entry 1,200/1,200 | the held-side bid | EXIT ↔ HOLD, 1,200/1,200 |

Sample conversion pair `c1` — identical assessment, opposite act, only
the book moved:

> propose half: `BTC is -9.7 bps … YES 43.5/45.5c` → `P(YES) 0.340 … vs no ask 56.5c; edge +7.8c` → propose NO
> pass half: `BTC is -9.7 bps … YES 33.1/35.1c` → `P(YES) 0.34 … the NO ask 66.9c leaves edge -2.4c … No trade.`

Sample assess pair `a1` — same position at +24.2 bps, entry 93.3c: bid
96.8c → `EXIT at 96.8c`; bid 92.8c → `HOLD — P(YES) 1.00; … (92.8 < 93.3)`.

**The negative finding.** In **zero of 2,410 pairs** is the recognition
signal itself — the stated probability or the distance — the sole varied
term with state and book held fixed. The varied term is the book
(conversion, straddle), the distance sign (sign-flip, near), or the
held-side bid (assess). This is structural, not an oversight: in this
generator the stated probability is a deterministic function of the state,
so a pair that varies *only* the recognition signal cannot be constructed
as a training row. The pairs force the action to depend on the book, the
sign, and the bid *given* the recognition — never on the recognition
alone. The Gate B probe design (fresh pairs where only the packet's
recognition signal varies) targets exactly the cell this data leaves
empty.

## 3. Action marginals

### 3.1 Marginals

| | Tranche 6 (unique) | Full mix (instances) |
|---|---|---|
| Desk rows | 6,200 | 34,613 |
| Entry rows | 3,800 | 27,413 |
| — entries (`propose` + `propose_fee`) | 2,347 (61.8% of entry rows) | 18,424 (67.2%) |
| — passes (`desk_pass`) | 1,453 (38.2%) | 8,989 (32.8%) |
| Assess rows | 2,400 | 7,200 |
| — EXIT / HOLD | 1,200 / 1,200 (50/50) | 3,600 / 3,600 (50/50) |

Mix desk rows by source (id-matched to component files, 34,613/34,613
attributed): tranche 6 ×3 = 18,600 (53.7%), tranche 5 ×2 = 7,600,
tranche 4 ×2 = 6,500, tranche 3 ×2 = 1,140, Run-25 base = 773.

### 3.2 Decisive states: taught action vs the row's own stated edge

Entry rows with |d| ≥ 3 bps, grouped by the edge figure the row itself
states (parse base: 3,248/3,800 tranche-6 entry rows are decisive;
26,640/27,413 mix entry rows parse, of which the decisive bands below):

| Stated edge band | Tranche 6 (unique) | Full mix (instances) |
|---|---|---|
| ≥ +1.5c | 2,048 rows → **100% propose**, 0 pass | 15,272 → **100% propose**, 0 pass |
| [+0.5, +1.5)c | 116 → 110 propose (94.8%), 6 pass | 1,022 → 960 propose (93.9%), 62 pass |
| [0, +0.5)c | 80 → **100% pass** | 1,376 → **100% pass** |
| [−3, 0)c | 746 → 564 pass (75.6%), 182 `propose_fee` attempts (24.4%), **0 propose** | 4,482 → 3,104 pass (69.3%), 1,378 fee attempts (30.7%), **0 propose** |
| Cap band (stated aligned ask > 85c) | 251 → **100% pass** | 765 → **100% pass** |

Summary: in decisive states where the row's own stated edge implies entry
(≥ +0.5c, sub-cap), the entry is taught in 2,158/2,164 tranche-6 rows
(99.7%) and 16,232/16,294 mix rows (99.6%). Where the stated edge implies
restraint ([−3, +0.5)c, sub-cap), no clean entry is taught anywhere — the
only non-pass behavior is the `propose_fee` class in the negative band,
which teaches *attempt the call and be rejected by fees*. The residual
passes at exactly +0.5c (17 across all tranche-6 entry rows, 6 of them
decisive) all carry an explicit floor/thin rationale — e.g. `r31e-0065`:
"P(YES) 0.65 — BTC is +1.4 bps … inside the desk's 3 bps entry floor; the
YES ask is 63.3c with edge +0.5c after fees. No trade." They are the
designed near/straddle classes at the boundary value, not label noise.

Assess consistency is exact: bid ≥ entry ⟺ EXIT in 1,200/1,200
tranche-6 rows (3,600/3,600 in the mix), bid < entry ⟺ HOLD in
1,200/1,200 (3,600/3,600). The boundary is densely taught: 570/1,200
EXIT rows (47.5%) sit within 1c of entry; 247/1,200 HOLD rows (20.6%)
sit within 1c below it.

### 3.3 A prompt-support defect the audit had to correct for

The cap band must be measured on each row's stated side ask. Deriving
the NO ask as 100 − printed YES bid (exact for conversion pairs, whose
books are complementary by construction) is wrong elsewhere: among the
2,347 tranche-6 rows whose rationale states a side ask, **0/1,163
YES-side rows** differ from the printed ask, but **893/1,184 NO-side
rows (75.4%)** state an ask differing by > 0.15c from the derivable
complement, by up to 2.9c (mix: 7,543/26,640 parseable entry rows,
28.3%). On those rows the operative ask — hence the exact edge — is not
computable from the prompt; it exists only in the answer text. (This is
the FORENSIC's tranche-5 "teacher prices off the hidden tape" point;
tranche 6's C1 fixed it inside conversion pairs only.) On the corrected
measure the cap band is clean: zero taught entries above the 85c cap in
either file (250 designed cap passes + 1 straddle pass half at a stated
ask > 85c, edge 0.0c, taught pass).

## 4. Verdict on the verdict's hypothesis

The hypothesis under test: *"if the action was never forced to depend on
the recognition signal, the trait was never trainable."*

**As a claim about label dependence, it is refuted by the counts.** The
taught action is a near-noiseless function of the recognition-derived
figures: 100% separation at the wide decisive band across 15,272 mix
rows, 100% bid/entry consistency across 7,200 assess instances, and the
action flips in 1,760/1,760 flip-designed pairs (400 conversion + 160
straddle + 1,200 assess). Label noise at the decision boundary is
confined to 17 designed +0.5c boundary rows in tranche 6. The
signal→action mapping was in the data, consistently.

**As a claim about causal order inside the completion — the reading the
verdict's Gate A question actually poses ("does recognition precede the
action in the row text") — it is confirmed.** In 100% of entry rows the
enter/pass decision is carried by tokens generated before any recognition
figure exists in the completion (route token first, then the
`funds_propose` call name). In the assess frame the action word precedes
the probability in 100% of HOLD rows and EXIT rows carry no probability
at all. Recognition textually precedes an action only where the action
is a *side* (new-dialect key order) or a *pass statement* (direct
frame) — never where the action is the *entry decision itself*. A model
generating left-to-right cannot have its route choice caused by a
probability it has not yet written; what these rows supervise is
"choose the frame from the prompt, then write an assessment consistent
with the choice." Compounding this, §2's negative finding: no pair in
any tranche-6 family varies the recognition signal alone, so no row
isolates recognition as the independent variable the action answers to.

**Net verdict: the hypothesis holds in its mechanism and fails in its
strongest literal form.** The action *labels* were forced to depend on
the recognition-derived edge — that half of the trait was trainable, and
Run 31's flawless stated probabilities (100% correct side of 0.5 on
every graded pool, per the grade report) show the assessment half was
in fact learned. What was never trainable from these rows is the
conversion itself — the model's own stated recognition reprioritizing
its act — because the act is always already chosen, one to two tokens
into the completion, before the recognition is written. Tranche 6 fixed
label consistency, complementary books, cap teaching, and key order; it
did not — and within this frame structurally could not — put the
recognition before the route token. The graded outcome (perfect
probabilities, zero entries, third consecutive constant-NONE) is exactly
the behavior this row structure predicts. This audit bounds what the
rows could teach; Gate B's fresh-pair checkpoint probe remains the
necessary measurement of what the weights actually do.

---

*Methods note for reproduction: all counts come from parsing
`data.jsonl` / `desk-live-form-tranche6.jsonl` row text and prompts
(regexes in the header), pair membership from `build-manifest.json`
`facts[*].pair` (prefixes c/s/n/e/a), source attribution by (id,
prompt-prefix) match against the five component files named in
`~/workspace/run31/build_mix.py`. Denominators are stated beside every
fraction; any number above can be recomputed or refuted from those
inputs alone.*
