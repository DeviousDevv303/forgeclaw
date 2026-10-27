# Audit of the operator's corpus seed files against `main` @ `1ee0026`

Files received 2026-10-27 (not stored in the repo; they are operator data): `forgeclaw-corpus-candidates.jsonl` (35 rows:
`{id, type, domain, claim, source, status}`) and `forgeclaw-verified-corpus-seed.md` (a labelled project-knowledge document).
Checked read-only against git. Nothing from either file was used for training, evaluation or the tokenizer.

## What they are, and are not
- **Knowledge claims for CORPUS, not behaviour traces.** They have no `input`/`result` pair, no integrity hash, no run id, no
  admission record. The exporter (`exporter/FORMAT.md`) cannot read them, and they are **not** the app-store export the standing
  directive says the operator will provide.
- **Unadmitted.** Admission needs the separate authorization in `src/lib/corpusAdmissionAuth.ts`; no lane can grant it. Per the
  design law (behaviour in weights, facts in CORPUS) these belong in CORPUS retrieval after the operator admits them in the app, not in weights.
- Credential-shape scan of both files: 0 matches.

## Conflicts with the repo (escalation, directive §9)
1. **Licence.** The seed says the repo is "MIT-licensed" (`.md` line 16, marked USER-REPORTED). `LICENSE` at `1ee0026` is the
   *ForgeClaw Proprietary Source-Available License, All Rights Reserved*; `package.json` says `SEE LICENSE IN LICENSE`. They cannot both be
   current. This matters for any commercial plan. **Owner to resolve; not changed by any lane.**
2. **Pinned commits are not in `main`'s history.** `cb33bbc` exists in this clone but is **not an ancestor** of `main`; it is reachable only
   from `origin/claude/web-search-fetch-failures-zr66bk` (2026-09-26, "MANUS — propose shared agent runtime"). `main`'s history starts
   2026-10-23 (54 commits). `dfe13f0` does not exist in this clone. So the eight `repo_verified` claims describe an older line of history, not `main`.

## Claim-by-claim: the `repo_verified` rows that are stale at `1ee0026`
| Claim | Verdict at `1ee0026` | Evidence |
|---|---|---|
| FC-002 `ProviderId` is exactly `corpus|anthropic|local|nexus` | **Stale** (true at `cb33bbc`) | `providerDefaults.ts:4`: 8 ids incl. `moonshot`, `deepseek`, `muse`, `openrouter`; default is `deepseek` |
| GD-001 `executeTool` has no gate; `requiresCoSign` only at the App loop | **Stale, and dangerous to ingest** | `forgeTools.ts:1033` calls `requiresCoSign(normalizedCall, posture)` inside `executeToolCore`; J-01 (draft PR #327) enforces offered tools in `runSubAgent` |
| GD-002 `tier1Active` is `useState(false)` | **Stale** | `App.tsx:938` `guardianPosture` state, `DEFAULT_GUARDIAN_POSTURE` = `autonomous` |
| GD-003 `runSubAgent` is 63 lines | **Stale** | `managedAgent.ts` is 263 lines |
| ST-001 coding state key is global, no agentId | **Stale** | `codingAgentState.ts:10,15` `STATE_KEY` is now wrapped by `stateKey(agentId)` |
| NX-004 browser WebGPU/NEXUS = `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | **Stale** | `nexusWebGpuProvider.ts` exists at `cb33bbc`, absent from `src/` at `1ee0026`; `@mlc-ai/web-llm` remains only in `package.json` |
| FC-003 on-device tokens/s; PR-005 Brave API CORS | **Not checkable** here | device measurement; external API behaviour |

**NX-004 resolves the MLC-premise discrepancy:** "Qwen2.5-1.5B is already the WebGPU model" was true on the older line of history and is
not true on `main`. Step 6 (MLC conversion) must pin a real model id and cannot assume the old runtime exists.

## Why this matters
`nexusGuidanceForDeepSeek` injects **approved** corpus records into DeepSeek's context. Admitting GD-001 as written would teach the
router that `executeTool` has no Guardian gate. Recommendation: before admission, set `applies_to_commit` on every `repo_verified` row and mark
the six stale rows above `superseded`/`historical`, as the seed's own ingestion policy (§9, items 3 and 10) says.

## Options for the operator (nothing done)
- Admit the `stated` principle/governance rows after review; hold or supersede the stale `repo_verified` rows.
- If you want these in the app as *unadmitted candidates*, a converter can emit app-shaped candidate records (with the correct integrity hash)
  for you to paste; admission would still be yours. Not built.
