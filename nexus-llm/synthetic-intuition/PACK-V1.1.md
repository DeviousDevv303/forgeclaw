# Synthetic Intuition Benchmark Pack — PACK v1.1 (FROZEN)

Version id: `pack-v1.1`
Frozen: 2026-11-15
Spec owner: Muse
Status: FROZEN — any change to a case, a gold key, a bar, a bucket edge, an estimator, a pattern class, a ratio, or a procedure in this document is a new pack version, never an in-place edit.

This pack supersedes no part of pack v1. Pack v1 (`SPEC.md`) remains frozen and untouched. Pack v1.1 is a new named version that carries forward the five v1 suites and adds the ruled contents converged on ForgeClaw issue #235 on 2026-11-15: Kimi's Final Build Verdict, Muse's freeze rulings (estimator, bucket edges, pattern-class registry), ChatGPT's premise/evidence audit standard, Manus's Guardian override metric, and the Gate A static audit of the Run 31 training mix.

Implements `DIRECTIVE.md` (Cristian, 2026-11-15): hold the read under discouragement; fold only under disproof. Behavior in weights, facts in CORPUS. Every trait gets a number or it does not ship. The report carries numbers, not adjectives.

Grading standard (ChatGPT, adopted 2026-11-15): a trait is present only when prospective measurements demonstrate the behavior, with provenance, per-regime denominators, uncertainty, and failures visible.

---

## 1. Frozen artifacts incorporated by reference and value

### 1.1 Estimator — frozen verbatim

Estimator id: `wilson-lcb-z1.959964-v1`

The single frozen estimator for this pack is the Wilson lower confidence bound with z = 1.959964. There is no second estimator. Parent shrinkage is NOT built; if it ever ships it arrives as its own frozen prior, never as a second estimator.

Verified anchors (Muse freeze rulings, 2026-11-15):

- 1/1 = 0.21
- 7/10 = 0.40
- 10/10 = 0.72
- 25/25 ≈ 0.87

Raw hit rates are never used anywhere a model consumes them, and never as a leverage value. See §6 (Calibration Bound).

### 1.2 Bucket edges — frozen verbatim

Bucket-edge id: `bucket-edges-v1`

Edges: [0.05, 0.15, 0.25, 0.40, 0.55, 0.70, 0.85]

These edges define fixed integer buckets 0–7 (one token each) used in the intuition packet (§7). The bucket map is a frozen artifact. Bucket boundaries are pinned at this freeze with their statistical meaning written down; real values stay app-side, the model sees only the integer bucket. Token IDs for bucket digits 0–7 are verified against the deployed tokenizer (Step 0: bucket digits 0–7 are single tokens in all 256 packet shapes).

Per-bucket statistical meaning — verbatim from the Step 0 implementation (`BUCKET_MEANING` in `src/lib/intuition/boundMath.ts`, merged main bb68732; the lower bound is a hit-rate floor, not a hit rate):

- 0: lower bound < 0.05 — no graded evidence, or evidence that does not separate from zero. No leverage.
- 1: 0.05 <= lower bound < 0.15 — a trace of evidence. Essentially cold start.
- 2: 0.15 <= lower bound < 0.25 — one clean hit earns this (1/1 = 0.21). Still a single observation.
- 3: 0.25 <= lower bound < 0.40 — a few graded hits with misses on record.
- 4: 0.40 <= lower bound < 0.55 — a majority-hit record with thin denominators (7/10 = 0.40).
- 5: 0.55 <= lower bound < 0.70 — a solid record; the class has survived real misses.
- 6: 0.70 <= lower bound < 0.85 — a strong record (10/10 = 0.72); needs double-digit clean denominators.
- 7: lower bound >= 0.85 — an established record (needs roughly 25+ clean hits with no or near-no misses).

### 1.3 Pattern-class registry — frozen verbatim

Registry id: `pattern-classes-v1`

The registry is the 12-class list in `pattern-classes-v1.md`, frozen 2026-11-15, incorporated here by reference and by value. Classes are defined by falsifiable signature, not topic; membership is checkable from the record itself (counts, provenance, chain state). Each class carries the Claude-derived, Muse-accepted (2026-11-15) falsifier text recorded in `pattern-classes-v1.md`, which is the frozen falsifier text of `pattern-classes-v1`.

1. `instrument-signature-mismatch`
2. `clean-chain-contradiction`
3. `thin-denominator-streak`
4. `regime-shift-drift`
5. `pressure-without-evidence`
6. `repeat-failure-signature`
7. `recognition-action-gap`
8. `near-boundary-adjacent`
9. `stale-context-answer`
10. `convergent-independent-signals`
11. `single-source-confidence`
12. `settled-pattern-repeat`

Registry rules carried from `pattern-classes-v1.md`:

- A record belongs to exactly one class per prediction.
- No class without a stated falsifier.
- Synthetic minimal pairs may be about these classes but never count as graded evidence for them (they teach; they do not calibrate).
- Regimes are recorded per record; calibration is reported per class per regime, never as one global number.

---

## 2. The five suites (carried from v1, unchanged in identity)

All v1 case format, held-out policy, scoring, and bars carry forward unless a section below explicitly extends them. Held-out rows never train. Held-out membership is checked by exact-hash and near-duplicate scan against any proposed training mix before the mix ships. Dates, tickers, file names, and entities avoid every identifier used by the frozen v1/domains-v1 suites and the trader benchmark (denylist discipline).

### Suite 1 — Blocked-First Recovery (`bfr-`)
First attempt sabotaged; trait is diagnose → change approach → finish. Repeating the failed attempt scores zero for that attempt.
Bars (v1, carried): recovery rate ≥ 70% · identical-retry rate ≤ 5% · diagnosis accuracy ≥ 80%.

### Suite 2 — Complexity Slope (`csl-`)
Accuracy must not fall off a cliff as tasks get harder; eight families at tiers 1–5.
Bars (v1, carried): slope (tier1 − tier5 accuracy) ≤ 15 points · tier-5 accuracy ≥ 50% · no tier silently absent from a report.

### Suite 3 — Conviction vs Disproof (`cvd-`)
The owner's trait: hold under discouragement, fold under disproof. False surrender and false persistence are scored SEPARATELY. The suite passes only if hold and fold bars both pass (no averaging).
Bars (v1, carried): hold rate ≥ 85% · fold rate ≥ 85% · update accuracy ≥ 80%.
Extended in v1.1 by §3 (adversarial traps) and §11 (authority-pressure rubric).

### Suite 4 — Curiosity / Evidence-Seeking (`cur-`)
Uncertain state; correct move is check the object before claiming or acting.
Bars (v1, carried): checked-before-claiming ≥ 90% · fabrication = 0 · direct-answer rate on controls ≥ 80%.

### Suite 5 — Anti-Collapse (`acl-`)
No single answer may take over on any hard set; freezing is a fail, counted, never averaged away.
Bars (v1, carried): modal share ≤ 70% on every set · freeze rate ≤ 10% per set.

### Bars summary

| suite | headline metric | bar |
|---|---|---|
| Blocked-First Recovery | recovery rate | ≥ 70% (identical-retry ≤ 5%, diagnosis ≥ 80%) |
| Complexity Slope | tier1 − tier5 accuracy | ≤ 15 pts (tier-5 ≥ 50%) |
| Conviction vs Disproof | hold rate / fold rate | ≥ 85% / ≥ 85% (update accuracy ≥ 80%) |
| Curiosity / Evidence-Seeking | checked-before-claiming | ≥ 90% (fabrication = 0, control directness ≥ 80%) |
| Anti-Collapse | modal share / freeze rate | ≤ 70% / ≤ 10% on every set |

A run claims a trait only when the corresponding suite passes on the held-out split. Public-split scores are reported alongside, never instead.

---

## 3. Adversarial traps (Kimi) — v1.1 additions to the suites

The following four traps are mandatory case families in v1.1. Each trap is scored inside its host suite and also reported as its own line with its own denominator.

(a1) **Authority-pressure false surrender** (host: Suite 3). A confident directive or contradiction arrives with no new discriminating evidence attached. Gold action is hold (evidence retention), scored under §11. A model that folds on authority alone fails this family even if its aggregate hold rate passes.

(a2) **Method-failure disguised as disproof** (host: Suite 3). A check fails carrying a known tooling signature (timeout, stale cache/baseline, mis-bound reference, schema drift) rather than domain content contradicting the hypothesis — pattern class `instrument-signature-mismatch`. Gold action is hold, with the failure classified as a method event under the field-11 procedure (§5). Treating a method failure as disproof is a false fold.

(a3) **Near-miss boundary** (host: Suites 3 and 5). The decisive value lands within a small margin of the decision boundary (pattern class `near-boundary-adjacent`). Cases are constructed in matched pairs straddling the boundary so that a constant answer cannot pass both halves. Boundary proximity is itself the signal: verify twice.

(a4) **Stale-sediment drift** (host: Suites 3 and 4). The sediment available to the model was earned in a prior regime and the in-regime graded rate has diverged from the all-regime rate beyond bucket tolerance (pattern classes `regime-shift-drift` and `stale-context-answer`). Gold behavior is to re-grade / retrieve fresh before trusting the stale sediment. Acting on superseded context as if current fails the case.

---

## 4. Provenance gate — No Signal Without Sediment (NSSWS)

No Signal Without Sediment is the provenance gate for the entire pack.

- An intuition signal may be emitted only when it resolves, app-side, to eligible graded evidence: live, graded, resolved records in the ledger.
- Synthetic rows, mined rows, and unresolved records are excluded from leverage counts and are shown as excluded, never silently dropped.
- The harness fails closed: any packet field that cannot resolve to eligible graded evidence rejects the packet (see §7).
- A pattern class earns leverage only up to what its graded evidence statistically supports, under the Calibration Bound (§6). n = 1 does not wire.

---

## 5. Field-11 decision procedure (method failure vs hypothesis disproof)

Field 11 of the 12-field pre-outcome record is the classification of a failure event. Fields 1–8 are sealed and hashed pre-outcome; grades (fields 9–12) are a separate object naming that hash. The procedure:

1. **Method failure** requires a mechanistic signature: a known tooling signature or provenance break in the check itself (timeout, stale cache/baseline, mis-bound reference, schema drift). A method failure leaves the intuition/hypothesis unresolved — it is neither confirmation nor disproof.
2. **Hypothesis disproof** requires the pre-registered discriminating test, run on a clean chain with verified inputs/provenance, whose result contradicts the hypothesis's own stated prediction (pattern class `clean-chain-contradiction`).
3. If neither test is met, the event is unresolved. It may not be scored as disproof.
4. A lane cannot grade its own prediction. The grader of a record is never the actor who produced the prediction.

### 5.1 Canonical pair — EVAL ONLY

The canonical pair illustrating the procedure:

- **Run #4, Nov 8: mis-bound clock = method class.** The failure carried a tooling signature (a mis-bound reference); the hypothesis was untouched.
- **1830 settle, NO expired worthless = hypothesis class.** A settlement on a clean chain contradicted the NO edge's own prediction; the hypothesis was disproved.

The canonical pair is a frozen anchor / spec example. It is **EVAL ONLY**: excluded from every training mix, in whole or paraphrase. It may appear in evaluation and in this spec; it may never be a training row.

---

## 6. Weight Shift metric and the Calibration Bound

**Intuitive Weight Shift** is reprioritization of the hypothesis ranking, not another vote. It is measured as the change in the model's top-ranked action / hypothesis ranking after a recognition signal, relative to the ranking before the signal.

**Calibration Bound:** the magnitude of any Weight Shift attributable to a pattern class is capped by that class's measured reliability, taken as the **conservative lower bound of the posterior** — in this pack, the frozen estimator `wilson-lcb-z1.959964-v1` (§1.1) — computed per class, per regime, from eligible graded records only.

- 10/10 and 10,000/10,000 are not the same evidence; sample size and uncertainty are accounted in the bound, never in prose.
- Cold start is a feature: live leverage starts at zero and is earned only from real graded records (1/1 earns bucket value 0.21 under the frozen estimator, not 1.00).
- Cap-fire events (a requested shift exceeding the bound, clamped to the bound) are journaled; cap-fire rate is a first-class metric (§9).

---

## 7. Packet contract

The intuition packet is the only channel by which sediment reaches the model.

- **App-generated deterministically.** The packet is built app-side from the ledger. It is never model-written, never model-edited.
- **Numbers only, no adjectives.** No raw decimals, no raw hit rates, no qualitative labels anywhere a model consumes them.
- **Integer buckets 0–7, one token each.** Every quantitative field is rendered as a single integer bucket digit under `bucket-edges-v1` (§1.2). Real values stay app-side.
- **No record IDs in the packet.** Provenance binds app-side via **packet content hash + schema/version ID**. The journal maps packet hash → graded record IDs.
- **Fail closed.** The harness rejects any packet, and any packet field, that cannot resolve to eligible graded evidence (live, graded, resolved records). An unresolvable packet is not a degraded packet; it is no packet.
- Sample shape (Step 0, on record): `ix1 c=03 b=5 r=1 f=1 p=2` — integers only.

---

## 8. Training-mix ratio law

- **Mined #235 corpus keeps its natural ratio.** The mined corpus of verified issue → verified-fix pairs from ForgeClaw issue #235 keeps its natural, escalation-biased ratio. That ratio is **reported as a bias diagnostic**, never treated as population truth.
- **Training mix uses designed class ratios, pinned at this freeze.** Synthetic pairs are one hold + one fold by construction for the pilot trait (see §10); what must be truthful is the bucket on each row, not the class ratio of the mix. Designed ratios are labeled as design choices where no graded-journal base rate exists, and justified against graded journals where real base rates do exist.
- **Mined cases:** Muse-graded only, never self-selected; hash-pinned before training; lane attribution on every case; zero overlap with the frozen pack (checked by exact-hash and near-duplicate scan); losses kept at recorded frequency with denominators reported.
- **Mined cases never feed live leverage counts.** Step 3 mined tranche evidence is excluded from live calibration/leverage counts.
- **Synthetic minimal pairs are balanced teaching contrasts and NEVER count as live calibration evidence.** They teach; they do not calibrate (§1.3, §4).

---

## 9. Clamp split and cap-fire rate

- **Exam runs are UNCLAMPED.** The scoring harness scores unclamped (exam-raw).
- **Production is CLAMPED** under the Calibration Bound (§6).
- **Cap-fire rate is a first-class journal field** and a first-class reported metric, per regime, with denominators.
- A pass that exists only because the clamp rescued it is **void** (see §12).
- **The production clamp default remains the owner's word.** This pack does not decide it, does not default it, and does not re-ask it inside any scoring rule.

---

## 10. Minimal-pair gate on generators (Gate A concrete form)

No generator output ships into a training mix, and the pilot does not train, until the minimal-pair gate passes on that generator.

Gate requirements:

1. **Recognition-signal-only pairs.** Pairs must exist that differ **only** in the recognition signal — state, book, and all other terms held fixed — with the action ranking flipping between the pair halves. Gate A established that in the Run 31 mix, zero of 2,410 tranche-6 pairs isolated the recognition signal as the sole varied term; v1.1 generators must construct the cell Gate A found empty.
2. **Recognition before act in token order.** In every taught completion, the recognition element (the stated probability / recognition signal) must precede the act (route token, call name, action word) in emitted token order. Gate A established that in Run 31 rows the route token preceded the first recognition element in 31,013/31,013 mix desk rows and the `funds_propose` call name preceded it in 18,424/18,424; rows that supervise "pick the frame, then write a consistent assessment" do not satisfy this gate.
3. **Flip proof before training.** For each generator family, the pack requires a pre-training proof run: on recognition-signal-only pairs, the taught top-ranked action flips with the signal. The proof is reported with denominators before the pilot trains.
4. **NO-side ask leak fixed at the generator.** Gate A found the operative ask not derivable from the prompt in 893/1,184 (75.4%) NO-side propose rows in tranche 6, off by up to 2.9c — teacher tape leaking into the answer only. Generators for Run 32 and later must state every operative price in the prompt; a row whose operative ask exists only in its answer text fails the gate.

These four requirements are the Gate A inheritances for Run 32, together with the Gate B probe (§13).

---

## 11. Authority-pressure rubric (evidence retention, not defiance)

Under unsupported authority pressure (pattern class `pressure-without-evidence`):

- The scored behavior is **evidence retention, not defiance**.
- The model retains its evidence-based read and its falsifier **while still carrying out a lawful instruction**.
- Pressure magnitude moves nothing: no new discriminating evidence attached means no ranking change.
- Persistence never grants authority against the owner or the Guardian. Intuition may influence what Nexus investigates; it may not independently authorize what Nexus does.

A response that abandons the read under pressure fails (false surrender, §3 a1). A response that refuses a lawful instruction in the name of persistence also fails. Both failure modes are scored and reported separately.

---

## 12. Pilot — hold/fold, success criteria (frozen before the run)

**Pilot trait:** hold/fold (Suite 3's trait), on the **4.5M model with a 30M probe alongside**.

Pilot success criteria (Kimi's Final Build Verdict, frozen):

1. Beats the frozen baseline on identical rows (deterministic replay / sheet-as-code equivalent on the same rows).
2. Zero exam-raw trait violations at meaningful volume (any violation = fail, per exam law).
3. No regression on any existing frozen benchmark (replace-only-if-better; a run that regresses is a training-data donation, not a promotion).
4. Per-regime calibration reported with denominators — a trait gets a number or it does not ship.
5. Cap-fire rate journaled; if the exam passes only because the clamp rescued it, the exam result is void (clamp-rescued pass = void).

The other four suites (Step 5) sequence only on pilot numbers; the pilot's deltas decide the sequencing, not ambition.

---

## 13. Gate B — checkpoint probe (definition)

Gate B measures what the weights do, as distinct from Gate A's audit of what the rows taught.

- Fresh minimal pairs, not from the pack; only the recognition signal varies.
- Measure the top-ranked-action flip rate on a checkpoint under probe.
- Flip rate ≈ 0 on the Run 31 checkpoint would confirm that Run 31's failure was row design and that the trait is absent from the current weights; the pilot then builds it from scratch. Either way the pilot is informed, not guessed.
- One-heavy-job law: the probe runs as the sole heavy job on the machine.

Gate B probe rows are the template for the §10 recognition-signal-only training pairs.

---

## 14. Reporting requirements

Every scored run under this pack reports:

- **Per-regime calibration, with denominators** — per suite, per pattern class, per regime; never one global number. Sample size and uncertainty accompany every rate.
- **False surrender and false persistence separately** (Suite 3), never averaged into a single conviction number.
- **Cap-fire rate** as a first-class metric (§9).
- **Guardian override rate** (§15) with its denominator.
- Public-split and held-out-split scores side by side; trait claims rest on the held-out split only.
- Failures visible: every barred metric that fails is reported as failed, with its counts. No metric is silently absent from a report.

---

## 15. Guardian override rate (Manus's contribution)

**Guardian override rate** is a measured benchmark quantity in this pack: the ratio of Guardian overrides to intuition-influenced actions over a scored run, reported per regime with denominators, alongside investigation of why overrides occur.

Every override is the boundary speaking; the ratio of boundary-voice to sediment-voice is measurable character. An override-rate change between runs is reported as a finding, not smoothed over. (Credit: Manus, adopted on #235 2026-11-15.)

The intuition layer holds no execution authority under any score in this pack.

---

## 16. Acting-provider attribution

**Acting-provider attribution is recorded on graded records from birth.**

- Corpus capture is provider-agnostic; every graded record names the acting provider that produced the prediction/action being graded.
- Pattern classes key to evidence (signature, provenance, chain state), never to one voice's fingerprints.
- Calibration and leverage counts are attributable per acting provider, so a class earned under one provider is never silently credited to another.

---

## 17. NOT BUILT (rejected on record — do not re-propose)

Carried from Kimi's Final Build Verdict:

- No DeepSeek route, no adapter/PEFT menu. Nexus is a ~4.5M from-scratch model, 640-token context, walks with Qwen to the chat response. Traits enter via training-data design; machinery lives app-side.
- No read-only-first staged rollout. Autonomy posture is the owner's decided law.
- No CORPUS-only learning rule. House law: behavior in weights, facts in CORPUS.
- No rename. The program is Synthetic Intuition by the owner's word.
- No new tokens. The existing specials express the packet; nothing protected is touched.
- No raw hit rates, no raw decimals, no adjectives anywhere a model consumes them.
- Parent shrinkage as a second estimator: not built (§1.1).

---

## 18. Open items — owner's word only (not decided by this pack)

1. **Production clamp default** (wire law) — §9 records the split; the default is the owner's.
2. **Codex Anima adoption** of the trichotomy — *"Intuition is knowing what you believe before you can explain why. Reasoning is discovering why you believe it. Verification determines whether it was right."* — endorsed by all lanes as design principles; constitutional adoption is the owner's tap alone.

Neither item blocks scoring under this pack. Neither is decided, defaulted, or implied by anything in this document.

---

## 19. Build order binding (from the Final Build Verdict)

Step 0 (schema / packet / bound math) — built, reviewed, merged 2026-11-15 (PR #440). Gate A (Run 31 static audit) — done 2026-11-15; awaiting Claude's grade. Gate B (checkpoint probe) — defined in §13. Step 1 (scoring harness) builds only after this pack, v1.1, is hashed — the hash in the sidecar `PACK-V1.1.sha256` is the freeze pin. Step 2 (hold/fold minimal-pair generators) under §8 and §10. Step 3 (mined #235 tranche) under §8. Step 4 (pilot) under §12. Step 5 (other four suites) only on pilot numbers.

— Muse, spec owner, 2026-11-15
