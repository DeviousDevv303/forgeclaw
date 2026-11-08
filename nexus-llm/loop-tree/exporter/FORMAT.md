# NEXUS store export: format and exporter contract (step 3)

Status: PROPOSED. Written against the app source at `1ee0026`; the operator produces the file, the exporter reads it.

## 1. Input file: `nexus-store-export.json` (produced by `dump-nexus-store.js`)

```json
{ "format": "nexus-store-export", "version": 1, "exportedAt": "ISO-8601", "origin": "https://…",
  "keys": { "<localStorage key>": "<the raw string value, unparsed>", … } }
```

- Only keys starting `forgeclaw_nexus_` are allowed (the parser rejects anything else).
- By default the file holds only the **approved knowledge records** (`forgeclaw_nexus_record_v1:<id>`) and the **candidate with the same
  integrity hash** (`forgeclaw_nexus_candidate_v1:candidate-<integrity>`). Chat history, provider keys, tokens and un-admitted
  candidates are not read. The script aborts if any value looks like a credential.
- Values are the raw strings the app stored, so the exporter can verify integrity hashes itself.

## 2. Why both records are needed (verified in `src/lib/corpus.ts`)

`admitCandidate` writes the approved `knowledge-<integrity>` record with only `{input, runtime, model, sourceInteractionId}`. The
`outcome`, `tool`, `channel`, `actor` and the app's run id live only in the candidate's `context` string
(`channel=…; outcome=…; origin=…; actor=…; tool=…`) and `metadata.run`. The two are joined on `integrity`.

## 3. What counts as "admitted by the operator"

| Knowledge record | Class | Exported? |
|---|---|---|
| no `metadata.admittedBy` | `operator-signed` (written by `admitCandidate` after signature verification) | yes |
| `admittedBy = nexus-convergence` | `converged`: NEXUS admitted its own record | **no**, unless `--include-converged` |
| any other `admittedBy` | `other` | no (listed in `rejected.jsonl`) |

**Limitation:** the export carries no signature, so `operator-signed` is inferred from the code path, not proven by the file.

## 4. Transcript assembly

Events are joined by `metadata.run`: the app's own learning run id (`run-<base36>-<rand>`), **not** a GitHub Actions run id.
Per run the exporter needs exactly one admitted chat/voice event (the prompt and final answer) and zero or more admitted
tool/shell events (the calls, in timestamp order). A tool event's `input` must parse as `<tool_name> <json>`; the app truncates
tool fields at 1,200 characters, so long calls are rejected as `unparseable_or_truncated_call`, never repaired.

Evidence label = the app's recorded chat `outcome` mapped to a grammar token (`verified→verified`, `completed→completed` or
`not_verified` when no call backs it, `blocked`, `failed`, `attempted`), then **checked by `validateTranscript`**; a label the rules
reject (for example `verified` backed only by `deepseek_reason`) is dropped as `label_conflict`. Result status uses a classifier that
includes `[GUARDIAN BLOCK]` (finding J-08 in `src/lib/toolOutcome.ts`).

Direct (tool-less) answers are excluded unless `--allow-direct`: a tool-less run in the export cannot be told from a run whose tool
events simply were not admitted.

## 5. Outputs (written OUTSIDE the repo by default)

`sft.jsonl` rows: `{id, synthetic:false, prompt, transcript, text, provenance:{run, candidateIds, integrities, admission,
recordedOutcome, model, runtime, firstAt, storeExportedAt, storeExportSha256}}`. `text` is the canonical grammar string
(`encodeTranscript`). `rejected.jsonl`: `{id, run, reason}`. `manifest.json`: counts, rejection reasons, sha256 of the input and each
output, and the token budget. Output is deterministic for a given input. Rows whose prompt matches the frozen eval set are dropped
(`prompt_in_frozen_eval_set`).

## 6. Known limits (UNVERIFIED unless stated)

- Row quality depends on how many runs have **all** their events admitted. I could not see your store, so the real yield is unknown.
- Tool results are truncated and redacted by the app before storage (`redacted_or_truncated`); the model learns from the truncated form.
- The exporter cannot verify who signed an admission (see §3).
- Synthetic data: never mixed in. Anything synthetic is a separate file with `synthetic:true`.
