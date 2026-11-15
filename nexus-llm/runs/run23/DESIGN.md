# Nexus LLM — Run 23: fourteenth real-data run (continuous-loop turn 14)

Program: `~/workspace/nexus-llm/multidomain-training-program.md` §§5–6, §9. Loop end condition (2026-11-05): DONE is a run that MEETS and SURPASSES, or Run 25 being graded, whichever comes first. Two runs remain after this one (24, 25).

Run 22 was **BELOW BAR** (v1 71.4%, domains-v1 76.6% counted 36/47 — meet fails on domains by ONE item a third time in four runs; fabrication 0.0% both; closed loop 16/18 flat; unrestriction Axis H PASS 0/12 16th straight, restriction events 1/36 primary / 0/36 alternate, Axis F total 5/6 ties best, Axis U FULL 10/30). Run 23's additions are run 22's full 14,400 targeted rows **held at full size** plus **2,000 new rows in seven classes U1–U7 rebuilt from run 22's graded diagnosis** (`~/workspace/run22/verdict.md`):

- **U1 final-segment content carriage (400)** — sibling-verb substitution treatment: approve wording, `/funds add` surface form, paper wording, and exact `$X.00` figures carried whole in the answer segment (domains 001/005/010 mechanic, counted in run 22's verdict diagnosis 1).
- **U2 single-term argument fidelity (300)** — one-word queries (markets/code/web, 50 each) and one-noun image subjects (150) copied character-for-character at graded length (trd-1 "fed" / img-1 "pickup" mechanic; fresh terms only).
- **U3 v1 evidence singles formation (300)** — 200 single-step final-segment-only rows + 100 blocked-only contrasts (blocked is for the Guardian-stopped shape only; addresses run 22's 012 overshoot and the six fresh-call singles).
- **U4 owner surface cross-suite (400)** — owner-price 150, gmail_send 80, WhatsApp 60, spawn_agent 60, browser 50, all closed calls (owner 0/5 in run 22's unrestriction; domains 023/024 zero of two).
- **U5 settle discrimination with prefixes (250)** — settle/status pairs interleaved WITH their result prefixes: status-then-settle sequences vs status-only rows (025's seventh-straight wrong-partner residue treated as discrimination, not form).
- **U6 closure on captures (200)** — capture-shaped prompts answered with the right door's short closed call (shell 50, gmail 50, code-search 100; run 22's two unclosed runaways were both captures).
- **U7 framework figure fidelity (150)** — mandate stake/goal figures repeated whole three times per answer (f-02's figure-garble mechanic).

**Standing queue:** both over-ctx episodes train as run 11's faithful splits, unchanged. Re-check this turn: traces-v1 files byte-unchanged (tool-use-v1 `8e23d474…`, context-v1 `b22827d4…`, same as run 22's check); no newly shaped real records exist.

## Configuration (run 9's recipe, replicated)

| Item | Value |
|---|---|
| Preset | `small-copy-ind` — 4 layers, d_model 256, ctx 640, copy head + induction |
| Parameters | 4,479,234 |
| Rows | 42,987 in `data.jsonl` (encode pre-check: max length 641, **1 base row over ctx 640** — disclosed deviation: that single base row will be dropped by the trainer; all addition and real rows are within ctx) |
| Data seed | 39 |
| Steps | 5,000 |
| LR | 6e-4 |
| Batch | 32 |
| Init | from scratch |
| Copy-loss weight | 2.0 |
| Tokenizer | run 8's training bytes — SHA-256 `323458df24247b695690f7fc25fa78fdbfd65ace44c8867fbf973d5fb8eb935a` (unchanged) |
| Incumbent for the gate | run 8's predictions, as runs 9–22 |

## Dataset composition (counted by `build_dataset.py`; `build-report.json` is the record)

| Class | Rows in | Kept | Share |
|---|---:|---:|---:|
| Base — generator re-run, seed 39, N=25,000 | 25,000 | 24,724 | 57.5% |
| Real — traces-v1 reshaped (48 unique) × 39 | 1,872 | 1,872 | 4.4% |
| All run-22 targeted classes, held at full size | 14,400 | 14,391 | 33.5% |
| U1–U7 new classes | 2,000 | 2,000 | 4.7% |
| **Total** | **43,272** | **42,987** | real 4.4% / synthetic 95.6% |

Repetition reasoning (×39): unchanged mirror value; real share 4.4% sits just below the ~5–10% band — disclosed deviation, as in run 22, because both the multiplier and held additions are fixed by the recipe.

**Validation:** all 16,400 addition rows pass `validateTranscript`, evidence tokens equal `canonicalEvidence(steps)`, `encodeTranscript` reproduces each row byte-for-byte (16,400 validated, 0 failures). Build deterministic: re-run reproduced `data.jsonl` byte-for-byte (SHA-256 `db1c8ada…` both times).

## Leakage

Full-dataset pass (same calibration as runs 10–22): **285 drops — 276 from base** (215 frozen-shingle overlaps, 61 frozen-ticker matches) **and 9 addition rows** (the standing `mem23_intake_list` frozen-prompt variant family, dropped as designed). **No U1–U7 row was dropped.** Calibration: identical checks over run 9's shipped data drop 342/30,000 (1.14%); run 23's base rate is 276/25,000 (1.10%).

**Frozen-hash verification (after build): all 9 recorded hashes match program §1 exactly** — v1 `079df97b…`, domains-v1 `da429fa8…`, CAPBENCH `ca1bbc75…`, CAPBENCH heldout `b77f2307…`, UNRESTRICTION `92ade216…`, UNRESTRICTION heldout `92cb0be0…`, trading `fb7bd205…`, Watcher-Q `293db891…`, Curator `26e8d918…`.

## Gate (program §6.2)

- **MEET:** domains-v1 > 76.6% with v1 ≥ 70.2%, fabrication 0.0% both.
- **SURPASS:** domains-v1 ≥ 78.6% and v1 ≥ 72.2%, fabrication 0.0%, no suite regressing > 1.0 pt vs run 22 (v1 71.4%, domains 76.6%, closed loop 16/18), shell evidence not below run 22 (domains tool_choice 73.1%; unrestriction shell_exec 8 attempts / 3 FULL).
- **Shell blocker (§9.3):** shell-v1 not yet frozen — blocker stays open by name.
- **Loop end:** DONE is meet+surpass or Run 25 graded.

## Compute

Run 9's ruler ≈4.3 h wall for 5,000 steps; run 23 is the same recipe at 42,987 rows, same order expected (estimate, not a promise). The pipeline resumes after a restart by re-running the identical command (finished stages skip; training resumes from `ckpt/resume.pt`).

## Launch command

```
setsid nohup bash ~/workspace/run23/run-pipeline.sh > ~/workspace/run23-pipeline.log 2>&1 &
```
