# REVIEWER Benchmark v1 — run 1 dispatch pre-registration

**This file is not part of the frozen exam and changes nothing in it.** It pins the two free parameters the frozen protocol (§4.2) names but does not fix, plus the per-dispatch cleanliness check, **before any exam dispatch is sent**. Written by the Claude lane (builder) on 2026-11-01 under the owner's blanket approval (#235 comment 6555552563) and the grading seat's dispatch instruction (#235 comment 6564670317). Grading is the grading seat's, not this lane's.

## Anchors

| Field | Value |
|---|---|
| Frozen-at commit | `c8d6cc53bf18c94e85966b20e76f2c3e68568cb8` |
| `reviewer-fixtures.jsonl` SHA-256 (at that commit) | `5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb` |
| `reviewer-benchmark-v1.md` SHA-256 (at that commit) | `64aeeb356d956dd84f05cfb25b0ebbbd028992a2af40cfbd100b84cbc7cfd064` |
| `AMENDMENTS-post-freeze.md` SHA-256 (bar of record) | `9895f91370a212560e6a786c74db5ee9f9563f21f30158f56392e37cb735c217` |
| Bar applied | final pre-run bar (asymmetric form, amendment 2) |
| Workflow + ref | `.github/workflows/deepseek-16b.yml` on `main` at `4382e09f6c2a8d7bc734acf4fb111b4dfc868514` |
| Composition anchor | dry run at pin `b9004ca`; `git diff b9004ca 4382e09 -- .github/workflows/deepseek-16b.yml .github/scripts/` is empty |

## P1. The job text (the `task` of every dispatch)

The frozen doc's own words, nothing added: lines 13–21 (§1: the job sentence, "For each fixture the bot returns exactly:" and the JSON output block) and lines 25–35 (§2 heading and the verdict vocabulary table) of `reviewer-benchmark-v1.md` at the frozen commit, joined by one blank line, then stripped. Line 23 (the harness note naming the grader keys) is left out: it addresses the harness, not the bot. **SHA-256 of the job text: `547f9fb1120bb2165566790c58152448e7aa7c0883c415dabe8695d38b23025a`** (1281 chars). Built by `nexus-llm/eval/harness/reviewer_v1_run1_payloads.py` from the git objects, never from the working tree.

## P2. The context of every dispatch

The row's `input` object, serialized `json.dumps(input, sort_keys=True, separators=(',', ':'), ensure_ascii=False)`, as the **entire** `context`. No guidance block, no grader key, no other text. Per-row SHA-256 is in the payload manifest (SHA-256 `2416cc9a10dd9718b1c9caa55651852e3e7ea0619653bfeba7b49ba9e0aff3da`; the builder rebuilds it byte-identical).

## P3. Dispatch inputs (all nine identical except `context`, `invocation_id`, `exam_forbidden`)

- `nexus_learning=false`, `mirror=true`, `profile` left at its default (`chat`), `exam_leak_canary` empty.
- `invocation_id=reviewer-v1-run1-RV-NN`. Seeds follow from it (`sampling_seed`, #353), so the run is reproducible.
- `exam_forbidden`: base64 JSON of the guidance markers (`NEXUS GUIDANCE`, `NEXUS APPROVED KNOWLEDGE`, `NEXUS LEARNED KNOWLEDGE`, `[END NEXUS GUIDANCE]`) plus every grader-only string of that row (`trap`, `provenance_label`, `source_citation`, `rule`; 12 chars or longer) that does not already occur in the job text or the row's input. This is a tripwire on top of P4's equality check, not the check itself.
- Each fixture is dispatched **once**. No re-run of a row, no best-of-N (frozen §4.3). Malformed output is a wrong verdict.

## P4. "Shown clean", per dispatch (A5 and Amendment 2 item 4)

Checked by `nexus-llm/eval/harness/reviewer_v1_run1_clean.py` from the mirrored `<invocation_id>.prompt.txt` and `.meta.txt` on `deepseek-results`. A dispatch is clean iff **all** hold:
1. `context_sha256` equals SHA-256 of the mirrored prompt; basis `fitted_prompt`; `prompt_calls=1`.
2. prompt == pre + task + mid + context + post, where task is the P1 job text and context is the P2 serialization **byte for byte**, and the three segment hashes equal the meta's.
3. pre, mid and post equal the dry run's clean anchors: pre `60743ab5b41b18ace3a2419c0faa320e1d9475166d45b655d9fa375ecd1e7892`, mid `e5f0d8355b064c90af06231a11b0ea5bbd9b49e3070edeabe188e01ccfaa673f`, post `391ff1d82cb528176b92470ae3a412f463f3f78d53516b9e1c77bf79dc6fd1e0`.
4. `context_check=clean`, `prompt_trimmed=false`, `sampling_seed_applied=true`, `degraded=false`, `workflow_commit` equals the ref above.

**Any dispatch not clean voids run 1** (A1): the remedy is a fresh complete pass named run 2, never a re-run of one row.

## P5. Known limits, stated before the run

- Token check (Qwen3-8B tokenizer, vocab only): the largest row, RV-02, is 3115 tokens plus 322 for the job text, against a fit budget of 7408 minus the system scaffold. No row is expected to be trimmed, and P4.4 voids the run if one is.
- The workflow's system prompt invites tool-call output. A dispatch that answers with a tool call instead of the JSON verdict is graded as malformed, which counts as a wrong verdict. The lane is tested as it stands.
- `profile=chat` caps output at 768 new tokens. An answer cut off by that cap is graded as it stands.
