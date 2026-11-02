# Nursery probe partition and training denylist — DRAFT (not governing; the freeze is the grading seat's)

Source: the owner's learning-loop direction (#235 6569403289, item 2 and item 4), the owner's Nursery direction (#235 6567858465, item 2), and the owner's trigger ruling (#235 6569925723). The Claude lane drafts; nothing here governs until the grading seat freezes it on #235. Nothing here touches a protected path or any existing frozen object.

## 1. Three sets, never mixed

| Set | May enter training? | Purpose | Changes |
|---|---|---|---|
| **Frozen exam rows** (REVIEWER v1 `5fb658b9…ceb`, CURATOR v1, the swarm exam, and v1.1 once frozen) | **Never** | The promotion gate. | Immutable. A new version is a new set with a new hash. |
| **Held-out probes** | **Never** | The health metric (flag-rate decay) and the second promotion gate, beside the exams. | Additions only, each version-stamped. |
| **Curriculum probes** | Yes, through intake | Regressions from the failure record and fresh cases. Negatives enter **only paired** with the graded-correct output (or as the rejected arm of a preference pair). | Free, with Route C on positives. |

A row belongs to exactly one set, and a row's set never changes in place. A held-out probe moves to curriculum only by an **owner-admitted, journaled move** that also removes it from the metric's denominator for every later version. It never moves automatically.

## 2. Partition by family, not by row
A held-out row and a curriculum row built from the same PR or finding teach the same fact, so a row-level split leaks. The partition key is the **source family**: every probe derived from one underlying object (one PR, one finding, one chat failure) shares a `family_id` and lands on one side of the line.
- `family_id` = SHA-256 of the canonical source reference (e.g. `pr:241`, `finding:F-025`).
- A new probe whose family already exists inherits that family's set. A family with rows in a frozen exam is **frozen-family**: its new probes go to curriculum or held-out only by explicit assignment, never by default.
- Held-out membership of a **new** family is assigned by a deterministic rule on `family_id` (proposed: first byte of the hash < 0x40, about a quarter), so the assignment is reproducible and can't be steered by hand. The grading seat may override by freezing an explicit list.

## 3. The denylist (mechanical, applied at two points)
- **Entries:** the canonical input of every frozen-exam row and every held-out probe, as (a) an exact SHA-256 of the canonical form and (b) a shingle set for near-duplicate matching.
- **Canonical form:** the row's input as JSON with sorted keys and compact separators (the form REVIEWER v1's harness already pins), with whitespace runs collapsed and Unicode normalized (NFKC).
- **Near-duplicate check (proposed parameters, to be calibrated on the canaries below):** 8-word shingles, flagged when ≥ 30% of a candidate's shingles occur in a single denylisted input. Calibration target: the canaries must catch a paraphrase-free near-copy and pass an unrelated record. If one threshold can't do both, the seat decides the tradeoff, and a **false block is cheaper than a leak**.
- **Applied at both points** (owner note, dual-point): at **intake** into the pool, and at **run assembly**, when the Nexus loop builds the next run's data. A record blocked at either point is journaled with the matching entry's id, never silently dropped.
- **Canaries, red on purpose:** the check must (i) block an exact copy of every frozen row, (ii) block a near-copy, (iii) pass an unrelated record. A denylist check that passes everything fails its own test, the same rule as the REVIEWER checks (#357).
- **Version change:** adding held-out probes or freezing a new exam version updates the denylist **before** the run it could contaminate starts (the build condition recorded on #235 under 6569403289).

## 4. Probe record (proposed schema)
`{ id, bot, set: "heldout"|"curriculum", family_id, class_tag, input (canonical), reference, provenance, created, version }`
- `class_tag` uses the Nursery's failure-class tags (e.g. `verification-missing`, `fabrication-temporal-stale`, `denomination-verbatim`).
- `reference` is the graded-correct output, or the reality-check specification that decides correctness. **No reference means no probe.** A raw failure without a correct pairing can be logged as a record but not used as a probe or as training data.
- `provenance` names the objects the row was read from (commit, PR, comment ID, API read). Rows whose source object isn't reachable from the building lane are marked `unverified-source` and can't be frozen until the grading seat stages the object.

## 5. Size and the metric
The metric is the held-out flag-rate per bot. With a binomial standard error near 9 points at n = 30 and 50% rate, small sets can't show a trend. **Proposal:** at least 40 held-out probes per bot before the decay chart carries any claim, reported over rolling windows with the count shown, and a series restart at each probe-set version. Until then the chart shows its n and no trend line. These numbers are proposals; the grading seat sets them at freeze.

## 6. Seeds and what is missing
- REVIEWER v1's nine rows are **frozen exam rows, not probes**: they seed the denylist, not the held-out set.
- Candidate held-out families from the night's failure record, **sources to be staged by the grading seat** (this lane can't reach them): the "UFC last night" recap (#355's origin), the Munguia recap (Oct 31), D-018's mirrored NO-fill denomination (#235 6567535380), the Route C self-admission case.
- The per-bot reality-check sets (the Nursery's main detector) exist for REVIEWER only (#357). CURATOR and RESEARCHER probes need their check sets before their `reference` can be a check, not a hand-graded answer.

## 7. Open questions for the grading seat
1. Family key and the 0x40 deterministic rule, or an explicit frozen list from the start?
2. Near-duplicate threshold: accept a false-block bias, and who calibrates?
3. Minimum n per bot, and whether the chart waits for it.
4. Retirement: is an owner-admitted move of used held-out probes into curriculum acceptable, or should a held-out set only ever grow?
5. Who stages the failure-record sources for the held-out seed families?
