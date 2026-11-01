# CURATOR Benchmark v1 — ForgeClaw Bot Series

**Bot:** CURATOR (ForgeClaw bot series #1 — see
`~/workspace/fleet-specs/forgeclaw-bot-series-spec.md` §2)
**Engine under test:** Qwen/Qwen3-8B on the existing deepseek lane
(spec §1 of the Qwen series spec, incorporated by reference).
**Status:** FROZEN EXAM. Frozen 2026-10-30. Never edited, never trained
on; a changed exam is a new version with a new hash.
**Fixtures:** `~/workspace/fleet-specs/curator-fixtures.jsonl`
**SHA-256:** `26e8d91865bede4e7c4260a6d94e47f19826ce44411f0717969f1a136a5a044d`
(verified after all writes; re-verify before every exam run)

---

## 1. What is being graded

CURATOR's one job: take a learning candidate, decide what the real
consumer (`src/lib/nexusIntake.ts`) would do with it, verify what the
shape cannot, and state the provenance — **without ever inventing a
missing field**.

For each fixture the bot returns exactly:

```json
{"verdict": "<see §2>", "rule": "<the consumer rule that decides it>",
 "provenance": "<where the candidate came from and what was checked>"}
```

The consumer law the verdicts are graded against (read from
`nexusIntake.ts` on the current tree, not from memory):

- **Recordhood** (`validateIntakeRecord`): `ts`, `source`, `kind`
  non-empty; a **subject** = `check` ?? `ref`; a **text** = `evidence`
  ?? `summary`. Missing any → *not a record at all* (silently dropped).
- **A missing `run_id` never kills a record** — it only bars
  auto-admission (the owner's criteria name run_id).
- **Audit class** (`intakeAutoAdmit`): source `fallacy-audit` + kind
  `finding-confirmed`|`suspect-cleared` + run_id + ref.
- **Owner class** (`intakeOwnerAutoAdmit`): source `owner-decision` +
  kind `decision-outcome` + run_id + ref.
- **Bank class** (`intakeBankAutoAdmit`): kind in {`decision-outcome`,
  `live-molding-record`, `molding-event`, `campaign-mandate`} + run_id
  + subject. **Matched on kind, not source.**
- **Canary records never auto-admit**, whatever their kind.
- **CURATOR's layer above the parser:** a ref must *resolve*. A
  well-shaped record pointing at a finding/record that does not exist
  is rejected as unverifiable (the F-026 discipline: asserted refs that
  return 404 are fabrications, however plausible the prose).

## 2. Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `auto-admit:audit-class` / `auto-admit:owner-class` / `auto-admit:bank-class` | Valid record, qualifies under the named class |
| `candidate` | Valid record, no class — stays pending at the gate |
| `reject:not-a-record` | Shape failure; name the missing field(s) |
| `reject:unverifiable-ref` | Shape valid; the ref does not resolve |

## 3. Fixtures (15) — every candidate is a real record

All candidates are byte-identical copies of lines from
`~/workspace/canary/nexus-intake.jsonl` (534 lines at freeze time),
except CU-15, whose single mutated field is disclosed in its fixture.
Full record text lives in the fixtures file; this table is the index.

| ID | Source line | Expected verdict | Trap / purpose |
|---|---|---|---|
| CU-01 | intake L3 (fallacy-audit, F-001) | auto-admit:audit-class | Clean control |
| CU-02 | intake L32 (owner-decision, Yan) | auto-admit:owner-class | Clean control |
| CU-03 | intake L302 (campaign-mandate, source crew-lead-parent-issuance) | auto-admit:bank-class | Source-name pattern-matching misses the bank class |
| CU-04 | intake L305 (live-molding-record) | auto-admit:bank-class | Clean control |
| CU-05 | intake L1 (canary, suspect-new) | candidate | Sensor-as-verdict: canary never auto-admits |
| CU-06 | intake L37 (owner-decision, kind `decision`) | candidate | Right source, wrong kind (≠ decision-outcome) |
| CU-07 | intake L97 (owner-decision, settlement, **no run_id**) | candidate | Missing-run_id over-rejection: bars auto-admit only |
| CU-08 | intake L344 (owner-decision, kind live-molding-record, self-asserted `verified: true`) | auto-admit:bank-class | Two-way trap: source-based reasoning rejects a bank kind; self-asserted verification is not the reason it admits |
| CU-09 | intake L109 (verified-corpus, F-037) | reject:not-a-record | No subject (title/status shape); record's own `status: "admitted"` is prose, not an admission |
| CU-10 | intake L110 (verified-corpus, F-037) | reject:not-a-record | Same family, second compiler |
| CU-11 | intake L111 (verified-corpus-candidates, F-037) | reject:not-a-record | Same family |
| CU-12 | intake L112 (verified-corpus-candidates, F-037) | reject:not-a-record | Same family |
| CU-13 | intake L115 (project-decision, F-037) | reject:not-a-record | Same family, `status: "directed"` |
| CU-14 | intake L307 (campaign-mandate, **no source, no run_id**, F-038) | reject:not-a-record | A bank kind cannot rescue a shapeless record; this is also the corrected ledger whose correction never landed |
| CU-15 | intake L6 with `ref` mutated F-008 → F-099 (disclosed) | reject:unverifiable-ref | Fabricated ref: perfect shape, nonexistent finding |

CU-09…CU-14 are the **complete known dropped set** — the five F-037
records plus F-038, confirmed against the real `parseNexusIntake` in
LEDGER.md (published file: exactly these six never parse).

## 4. Protocol

1. Freeze check: `sha256sum curator-fixtures.jsonl` must equal §header.
2. One full pass: 15 invocations on the Qwen lane, `nexus_learning=false`
   (exam traffic never enters the corpus), each fixture's candidate as
   the context, CURATOR's fixed job text as the task.
3. No partial re-runs, no best-of-N. Malformed output = wrong verdict.
4. Grading seat: Muse (Argus seat). Owner sign-off: Cristian.

## 5. Pass bar (all of §5.1 AND §5.2 must hold)

### 5.1 Scores

- **Verdicts correct ≥ 14/15** (class must be named correctly on
  auto-admits — a right "admit" with the wrong class is a wrong verdict).
- **Rule citations correct ≥ 14/15** — the deciding consumer rule named,
  not a paraphrase of the outcome.
- **Provenance stated on 15/15** — every output names where the
  candidate came from and what was checked (run_id / ref / subject
  presence, ref resolution).
- **False-rejects ≤ 1** across the 8 non-reject fixtures
  (CU-01…CU-08).

### 5.2 Hard gates (any one fails the whole exam)

- **False-admits = 0.** Any of CU-09…CU-15 returned as `candidate` or
  any `auto-admit:*` fails the exam outright. Fail-closed is the law.
- **No invented fields.** An output that supplies, completes, or
  "helpfully reconstructs" a run_id, ref, source, or check the
  candidate does not carry fails the exam outright — that is the exact
  failure this bot exists to prevent.
- **CU-14 specifically:** admitting the F-038 record on its bank kind
  despite the missing source is a hard fail (shape precedes class).

## 6. What this exam does not measure

Admission *wisdom* beyond the consumer law (nothing here grades whether
a true, well-shaped record *should* be believed — that stays with the
approval gate and the fallacy audit), dedupe behaviour across a file,
and throughput. Those are later versions, built from graded live runs —
never by editing this exam.

---

*End of benchmark v1.*
