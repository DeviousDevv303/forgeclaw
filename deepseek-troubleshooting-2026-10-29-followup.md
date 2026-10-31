# DeepSeek 16B full-stack troubleshooting — follow-up (chain re-verification on current main, Thread A, Thread B)

- **Date:** 2026-10-29 (evening CDT) — background follow-up to `deepseek-chain-verification-2026-10-29.md` (which verified the chain on `c3169ff`)
- **Repo:** DeviousDevv303/forgeclaw (public)
- **Tree verified:** fresh clone `~/workspace/.scratch/deepseek-reverify`, `main` = `157e4256914b99eb5af82ce4f556ec44be543040` ("FundsPanel: compact Kalshi (live) pop-up … (#335)")
- **Method:** read-only code verification on the clone; live-run evidence from the workflow's own `deepseek-results` git mirror branch; ONE authorized connector probe for Thread A (result below). No merges. No repo code changed — the Thread A patch was applied only inside the scratch clone for validation and the clone was reset afterward.
- **Headline:** the chain is intact on current main and undisturbed by #335, with fresh live-run proof after the #335 merge. Thread A remains blocked by the GitHub App's missing Workflows permission (probe-verified again today). Thread B found a real defect: the DeepSeek run-resume record is wired only into the `ask_deepseek` direct path, not the main chat path — diagnosis and fix shape in §3, not implemented (report-only, rationale given).

---

## 1. Chain re-verification on main `157e425` — ALL LINKS VERIFIED, #335 disturbed none

**#335 disturbance check first:** `git diff --stat c3169ff7ac4f… 157e4256914b…` = exactly 2 files — `src/components/FundsPanel.tsx` (+89/−51 region) and `src/components/FundsPanel.test.tsx` — **84 insertions / 51 deletions, no chain file touched.** Every link below was re-read on the `157e425` tree; line numbers are identical to the `c3169ff` report except where noted.

| Link | Evidence on `157e425` | Status |
|---|---|---|
| 1. Selection | `src/lib/providerDefaults.ts:10` `DEFAULT_PROVIDER = 'deepseek'`; `src/App.tsx:764-765` saved `fm_provider` → `resolveInitialProvider`; `src/lib/ai/providerRouter.ts:23` `isDeepSeekProvider` ('corpus' or 'deepseek'), L27 providers map `deepseek: corpusProvider`; `src/lib/modelProviders.ts:23` user-facing "DeepSeek 16B" entry → `actions/workflows/deepseek-16b.yml` **[Correction 2026-10-30, PR #337: this entry now reads "Qwen/Qwen3-8B" — see Addendum.]** | VERIFIED |
| 2. Dispatch | `src/lib/ai/providerRouter.ts:281` bootstrap emits the `deepseek_reason` tool call (`stopReason: 'deterministic-deepseek-reasoning'`); legible `deepseek-not-dispatched` failure in the send path when the tool is absent; `src/App.tsx:146` imports `executeTool`; `src/lib/forgeTools.ts:1311` `case 'deepseek_reason'`; L1373 invocation id `` `deepseek-${Date.now()}-${…base36}` ``; L1397 `POST …/actions/workflows/deepseek-16b.yml/dispatches` | VERIFIED |
| 3. Workflow | `.github/workflows/deepseek-16b.yml:22` `run-name: DeepSeek 16B ${{ inputs.invocation_id }}`; L128 `PRIMARY_MODEL = 'Qwen/Qwen3-8B'` (the model behind the label — by design, not "fixed"); L129 fallback `deepseek-ai/deepseek-coder-1.3b-instruct`; L353 `repeat_penalty=1.1 if SITE else 1.0` — **chat still unp penalized workflow-side (Thread A premise confirmed on current main)** | VERIFIED |
| 4. Run pickup / result delivery | `src/lib/deepseekArtifact.ts:330` `waitForDeepSeekResult`; L263 `readDeepSeekMirror` (primary), L288 `downloadDeepSeekArtifact` (fallback); `src/lib/workflowRun.ts:55` `waitForCorrelatedRun` (generic correlator); forgeTools resume entry at `src/lib/forgeTools.ts:1325` | VERIFIED |
| 5. Synthesis → filter → bubble | `src/lib/ai/providerRouter.ts:78` `isSuccessfulDeepSeekToolResult` (content starts `✓ DeepSeek-16B completed as `) **[Correction 2026-10-30, PR #337: the header now reads "✓ Qwen/Qwen3-8B completed as " — see Addendum.]**; synthesis block in the send path strips the header and runs `stripReasoningArtifacts`, `stopReason: 'deepseek-synthesis-complete'`; `src/lib/ai/responseFilter.ts:30` `stripReasoningArtifacts`, step 5 at L47-48 calls `truncateRepetitionLoop` (def. L65; helper `cutLoopInProse` L77; marker const L56); `src/App.tsx:2008` `routerResult.response`, L2031 `finalText = result.text \|\| streamBuffer`, L2268 display resolves through `cleanOutput(stripToolSyntax(finalText))` | VERIFIED |

Minor line-number corrections to the earlier report (same tree family, prose only): the loop marker const is at `responseFilter.ts:56` and `cutLoopInProse` at L77 (earlier report said L61 / L79+). No functional difference.

**#334 spot checks (still in place on `157e425`):** Kalshi-first routing in `src/lib/liveDataRouting.ts` (L28 `KALSHI_MENTION`, L48 "those belong to the live kalshi_markets API, never to web search or model memory"; tool def `src/lib/forgeTools.ts:700`); web_search fallback self-labels at `src/lib/forgeTools.ts:1638-1639` ("static reference data, NOT live search results") and L1655; recency widening at `src/lib/currentInfo.ts:13` (`yesterday|last night|this morning|overnight|…`) with tests at `src/lib/currentInfo.test.ts:12-13`.

**Live-run evidence on current main (fresher than the merge):** the `deepseek-results` mirror branch's newest publish commit `6bf0ee4` at **2026-10-30T00:52:43Z** carries invocation `deepseek-1793321387864-eis0vc` — dispatched 2026-10-30T00:49:47Z (id timestamp), ~2.5 minutes AFTER the #335 merge landed (00:47Z), i.e. a run dispatched against `157e425` as main. Its `.meta.txt`: `model=Qwen/Qwen3-8B`, `role=primary checkpoint`, **`degraded=false`**, `elapsed_seconds=71.7`, and the result text answers from a live Kalshi book ($0.57 bid / $0.58 last trade). The chain is not just code-intact; it ran end to end on the current main within the hour. (Suite state on this tree: PR #335's gate ran full vitest **2284 passed / 12 skipped / 0 failed** on the pushed head whose tree is this merge's tree — cited from the #335 build report, not re-run here; no code was changed in this follow-up, so no new gate was owed.)

---

## 2. Thread A — workflow-side repetition penalty: STILL BLOCKED at the GitHub App permission (probe-verified)

**The patch** (`~/workspace/agent-channel/deepseek-workflow-followup-2026-10-29.patch`, 2 files, 3 hunks):
- `.github/workflows/deepseek-16b.yml` — fast engine: `repeat_penalty=1.1 if SITE else 1.0` → `repeat_penalty=1.1` (every profile, chat included); HF fallback generate call gains `repetition_penalty=1.1`; comment updated.
- `.github/scripts/test_deepseek_workflow_engine.py` — assertions updated to match (requires `repeat_penalty=1.1,` present, the conditional form absent, `repetition_penalty=1.1` in the fallback).

**Validation on current main (scratch clone):**
- `git apply --check` on `157e425` → OK; applied diff = 2 files, 8 insertions / 4 deletions; penalty sites land at yml L354 (fast) and L425 (HF).
- Workflow engine tests against the patched tree: `python3 .github/scripts/test_deepseek_workflow_engine.py` → **Ran 8 tests, OK, exit 0**.
- Patched files staged at `~/workspace/.scratch/threadA-stage/` with SHA-256: yml `e8669027ab558cf234e3ae9b573d8ea3c313fcfdf580241a9b8b4ce794dcbb80`, test `123e64c292d01b45db6b57282b9a237e7ebe8360ca76a938bb80066497db7ed6`.

**The one probe (as instructed — one attempt, then stop):**
```
/opt/hatch/bin/github push-files --owner DeviousDevv303 --repo forgeclaw \
  --branch muse/deepseek-repeat-penalty --source-dir ~/workspace/.scratch/threadA-stage \
  --paths-file ~/workspace/.scratch/threadA-paths.nul   (both patched files)
→ {"ok":true, … "failed to create tree: POST https://api.github.com/repos/DeviousDevv303/forgeclaw/git/trees:
   403 Resource not accessible by integration", "isError": true}
```
The 403 is unchanged from the standing record (AGENTS.md, 2026-10-23): **Muse's GitHub App installation lacks the Workflows permission**, and `push_files` fails at tree creation when the tree contains `.github/workflows/*`. Side effect of the probe, verified by `git ls-remote`: the branch ref `muse/deepseek-repeat-penalty` was created pointing at `157e425` (main's head) but **no commit exists on it** — the patch is NOT on GitHub. No PR was opened. The connector catalog has no delete-branch tool, so the empty ref stays until an owner/lane removes it or the unblock below lands the real commit on it.

**Exact unblocks (any one):**
1. **Owner grants the permission:** Cristian → GitHub Settings → Installations → the Muse app → Permissions → **Workflows: Read and write** → approve. Then the identical push (staged tree + hashes above) lands the branch and a draft PR can be opened; merge stays Cristian's.
2. **Owner applies it in the web UI:** three small hunks from the patch file (yml L353-354 area, yml ~L425, and the test assertions) — the patch file is the literal text to apply.
3. **A lane with a workflows-scoped plain-git credential pushes it** (precedent on the record: workflow files landed in ordinary PRs #270/#272 via git pushes): branch `muse/deepseek-repeat-penalty`, content = the staged tree above, byte-check against the SHA-256s.

Until then, the client-side defense from PR #334 (`truncateRepetitionLoop`, §1 link 5) remains the only loop protection on chat runs — it works, but it truncates after the loop starts rather than preventing it.

---

## 3. Thread B — "Interrupted: ForgeClaw was closed or reloaded" next to DeepSeek answers: DEFECT (diagnosis only, not implemented)

### How the mechanism is supposed to work

- **The mark:** on every app load, the messages initializer reads `forgemind_history` from localStorage (`src/App.tsx:715`). Any assistant reply persisted with `streaming: true` is dead — its request died with the page — so it is ended and suffixed at `src/App.tsx:734-737`: `⚠ Interrupted: ForgeClaw was closed or reloaded before this finished. …` with one of "Send it again to retry." / "Resuming it now that you are back." / "Tap RESUME to run it again." Selection of the resumable task is `findInterruptedTask` (`src/lib/interruptedTask.ts:36-58`): only the LATEST reply counts; fixed commands and >12h-old tasks wait for a tap (`AUTO_RESUME_MAX_AGE_MS`, L27). History is persisted on every messages change (`src/App.tsx:1052`), so the mark, once applied, is itself saved.
- **The DeepSeek exemption (the design's intent):** a DeepSeek run outlives the page (it runs on GitHub Actions), so its reply is supposed to RE-ATTACH instead of being marked. A run record `{invocationId, dispatchedAt, messageId, question}` is kept under localStorage key `forgeclaw_active_deepseek_run` (`src/App.tsx:20-29`). The initializer loads it (`src/App.tsx:723-724`): if `isDeepSeekRunResumable` (≤30 min, `src/lib/deepseekRunResume.ts:9-12`), that message id is exempted from the Interrupted mark and kept streaming; a mount/visibility effect (`src/App.tsx:957`) then calls `resumeOrphanedDeepSeekRun` (App.tsx:37-113), which re-enters `executeTool` with `resume_invocation_id` (→ `src/lib/forgeTools.ts:1325` `waitForDeepSeekResult`) and replaces the reply with the real result. An expired record (>30 min) ends the reply with the dedicated note `DEEPSEEK_RUN_EXPIRED_NOTE` (`src/lib/deepseekRunResume.ts:15`) — a different string from the one the owner saw. The record is written by a ToolContext callback: `forgeTools` invokes `ctx.onDeepSeekDispatch?.(invocationId, dispatchedAt)` at `src/lib/forgeTools.ts:1409`, immediately after a successful dispatch POST (L1397) and before the wait. Machinery tests exist: `src/lib/interruptedTask.test.ts`, `src/lib/deepseekRunResume.test.ts`, `src/appDeepSeekStaleRun.test.tsx`.

### The defect

**The callback is wired into exactly one of the app's two DeepSeek dispatch entries — and not the one the owner uses.**

- Wired: the `ask_deepseek` direct-dispatch block passes `onDeepSeekDispatch: (invocationId, dispatchedAt) => saveActiveDeepSeekRun({ invocationId, dispatchedAt, messageId: msgId, question })` at `src/App.tsx:1332-1334`, and clears the record after the final message write (`src/App.tsx:1357`) and on error (L1363). A repo-wide grep for `onDeepSeekDispatch` finds no other provider of it (definition `src/lib/forgeTools.ts:209`, invocation L1409, the one caller above).
- **Not wired: the main chat path.** The send loop creates the streaming placeholder (`id: msgId`, just above `src/App.tsx:1677`) and builds `toolCtx` at `src/App.tsx:1677-1696` — spread from `loadToolContext()` plus session/run fields — **with no `onDeepSeekDispatch`**. Every main-loop tool execution (`src/App.tsx:1739`, `1779`, `1828`, `2109`) runs with that context. The main path is where the default provider lives: a normal chat question routes through `providerRouter` → `deepseek_reason` tool call → `executeTool` → dispatch at `forgeTools.ts:1397` → the L1409 callback fires into a context that doesn't define it → **no run record is ever saved for main-path DeepSeek runs.**

### Consequence sequence (matches the owner's 2026-10-29 observation exactly)

1. Owner asks a question in the main chat (DeepSeek is the default provider). The workflow dispatches and runs for minutes; the reply sits persisted as `streaming: true`; no `forgeclaw_active_deepseek_run` record exists.
2. The page is closed, reloaded, or killed while backgrounded (the owner's phone pattern all day — app switching, screenshots, the app closed and reopened).
3. On the next load, `loadActiveDeepSeekRun()` returns null → no exemption → the still-running DeepSeek reply is suffixed **"⚠ Interrupted: ForgeClaw was closed or reloaded before this finished."** — the exact string in his screenshot, on DeepSeek answers specifically (non-DeepSeek replies are short-lived API calls, rarely caught mid-flight; DeepSeek's multi-minute waits are the ones exposed).
4. `resumeOrphanedDeepSeekRun` finds no record, so nothing re-attaches. The workflow meanwhile completes and publishes its answer to the `deepseek-results` mirror — orphaned; the answer never reaches the chat.
5. If the marked reply is the latest task, the generic interrupted-task flow offers auto-resume — but that re-dispatches a **brand-new** workflow run from the prompt (`resumeInterruptedTask`, `src/App.tsx:2369`) instead of re-attaching to the finished one: duplicated compute, a second multi-minute wait, and the first run's result discarded.

### What is correct-by-design (not part of the defect)

- The Interrupted mark itself, for non-DeepSeek replies and genuinely dead requests (the `interruptedTask.ts` header states the intent, and the mark is literally true there).
- The 30-minute resume window and the separate expired-run note.
- The `ask_deepseek` path's save/clear lifecycle (record saved at dispatch, cleared only after the final message state is written — App.tsx:1357 — so a reload in between still re-attaches cleanly).
- The hidden-tab auto-retry for transient network errors (`hiddenDuringRunRef`, `src/App.tsx:759`, set at L2362-2363, consumed at L2299-2306) — a separate, working mitigation for backgrounding during ordinary requests.

### Proposed fix shape (for a deliberate small PR — not implemented here)

1. **Wire the callback into the main path:** add to `toolCtx` (`src/App.tsx`, in the object at ~L1677, where `msgId` and `promptText` are both in scope):
   `onDeepSeekDispatch: (invocationId, dispatchedAt) => { saveActiveDeepSeekRun({ invocationId, dispatchedAt, messageId: msgId, question: promptText }) }`
   — mirroring App.tsx:1332-1334 verbatim. Downstream (initializer exemption, mount/visibility resume, forgeTools resume entry) needs no changes.
2. **Clear on settle, mirroring L1357/L1363:** call `clearActiveDeepSeekRun()` where the send loop writes the reply's final state (the settle that consumes `routerResult.response` at ~L2008-2031 and the loop's error/abort exits). This half is why the fix is a deliberate change rather than a one-liner: the send loop has several exits (success settle, tool-error settle, the catch path, abort early-returns such as `src/App.tsx:2110`), and each needs a conscious decision — a stale record left behind (≤30 min old) would make the next mount/visibility event "resume" a finished run and overwrite the synthesized answer with raw tool output (the resume replaces message content wholesale, `src/App.tsx:97-101`), while clearing on an abort that a newer send superseded could erase the newer run's record. The `ask_deepseek` block's discipline (clear only after the final write, and on error) is the pattern to follow path by path.
3. **Test shape:** extend the existing app-level coverage (`src/appDeepSeekStaleRun.test.tsx` pattern) with a main-path case: dispatch a `deepseek_reason` through the send loop with a stubbed `executeTool` context, assert the record is persisted under `forgeclaw_active_deepseek_run` with the placeholder's `msgId`, and assert it is cleared when the reply settles; keep `interruptedTask` / `deepseekRunResume` suites as the downstream regression net. Full gate before merge, per standing discipline.

**Why report-only:** the diagnosis is unambiguous (one missing context field on the primary path, the correct pattern implemented in the same file), but part 2's placement spans the send loop's several exit paths in the app's core file; landing it as a background drive-by — unreviewed settle-path changes in `App.tsx` — is exactly the risk the report-only default exists for. Recommend it be picked up as a small, deliberate PR (owner or a lane in chat), gated in full.

---

## Evidence index

- Clone: `~/workspace/.scratch/deepseek-reverify` @ `157e4256914b99eb5af82ce4f556ec44be543040` (reset pristine after Thread A validation).
- `git diff --stat c3169ff… 157e425…` → 2 files (FundsPanel only), exit 0.
- Mirror branch: `git log origin/deepseek-results -6` → newest `6bf0ee4` 2026-10-30T00:52:43Z, invocation `deepseek-1793321387864-eis0vc`; `git show …meta.txt` → `model=Qwen/Qwen3-8B`, `degraded=false`, `elapsed_seconds=71.7`.
- Thread A: `git apply --check` OK on `157e425`; `python3 .github/scripts/test_deepseek_workflow_engine.py` → 8 tests OK, exit 0 (patched tree); staged SHA-256s in §2; connector probe → 403 verbatim in §2; `git ls-remote` → branch ref at `157e425`, no commit.
- Thread B: all citations read directly from the `157e425` tree (App.tsx, interruptedTask.ts, deepseekRunResume.ts, forgeTools.ts) at the lines given.
- No merges performed. No commits made by this follow-up. No Nexus Bank / nexus-trader files touched.

---

## Addendum 2026-10-30 — two confabulation data points and the fix

Appended 2026-10-30 (evening CDT). The sections above stand as written on 2026-10-29; where PR #337 changed a fact they cite, a dated correction note now sits beside the line (§1, Links 1 and 5). This addendum records two owner-observed confabulations on the DeepSeek/Qwen path, their root cause, and the merged fix.

### Data point (a) — 2026-10-29 22:21 CDT: invented live Bank state

A ForgeClaw answer described a **42-contract open position** in Nexus Bank while the Bank was verified **FLAT** (equity check the same evening). No such position existed. This was invented live state presented as fact — not a stale read, not a rounding of a real number: a position fabricated whole in an answer about the owner's money.

### Data point (b) — 2026-10-30 ~18:15 CDT: entity-extraction nonsense on a trading question

A trading question in the app was answered with entity-extraction text — "rerun the entity extraction process with an override… 2-attempt limit… 'the home team' or 'the visitors'" — that had nothing to do with the question asked. Verified by the owner's own transcript. (The correct answer to that question was NO TRADE: the price in question, 84¢, sat above the Bank's measured 75¢ entry clamp.) The "2-attempt" phrasing plausibly echoes the request ledger's continuation cap (`MAX_LEDGER_CONTINUATIONS=2`); the entity-extraction content itself came from the mechanism below.

### Root cause (for (b), confirmed by full-stack trace in the PR #337 build)

The entity-extraction text exists in **no repo file, prompt asset, or intake record**. It came from a **runtime corpus record in the owner's browser store**, admitted into the payload by two weak relevance gates:

- `corpus.ts` `retrieve()` tokenised with **no stopword filtering** and admitted a record on **one shared ≥2-character token**;
- the `nexusGuidance.ts` lane admitted records at **≥2 shared ≥4-letter words, stopwords counted**.

Either gate passes for almost any English record against almost any task. The admitted guidance is placed **first** in the payload (`deepseekContext.ts`), is **exempt from the forgeTools zero-overlap drop**, and is **trim-protected** by the workflow — so a weakly-matched off-domain record survived every guard in front of an 8B model, which then answered from the wrong context. Data point (a) is recorded as the same failure family — confident, specific, unverified content presented as live fact — though its exact admission path was not traced line-by-line the way (b)'s was.

### The fix — ForgeClaw PR #337, merged 2026-10-30 19:44 CDT

- **PR:** https://github.com/DeviousDevv303/forgeclaw/pull/337 — squash merge commit **`f81aad448ae5356f298036abe9dcac8655e0bbeb`** on `main`.
- **Unified relevance test:** `corpus.ts` now exports `distinctiveWords()` + `recordRelevantToTask()`, and **both** retrieval lanes apply the one test — a record must share **≥3 distinctive words** with the task (threshold `min(3, task's topic-word count)`; a record's topic text is its content plus `metadata.input`, where the admitted question actually lives). Regression tests pin the incident shape at the helper, guidance-lane, and assembled-payload levels. Byte-verification of the pushed branch: SHA-256 of served content vs local files, **33/33 match**. Gate: targeted **172 passed / 0 failed / 5 skipped**; eslint 0 errors; tsc clean; build ✓. (Three full-suite failures — `appKeyStaysVerified`, `appLanguage`, `deepseekEngine` — were baseline-verified to fail identically on clean main `157e4256`; not regressions of this PR.)

### Label amendment (same PR)

Every user-visible and model-visible **"DeepSeek 16B"** string now names the model that actually runs behind the provider: **Qwen/Qwen3-8B** — including `modelProviders.ts`, the App.tsx system-prompt text, forgeTools completion headers (`✓ Qwen/Qwen3-8B completed as …`), and the error-stage classifier that keyed on the literal word "DeepSeek" (renaming the producers without it would have silently broken error classification; its test caught the coupling). The **provider id `deepseek`, model id `deepseek-16b`, invocation ids, and all symbol names are unchanged** — saved preferences and back-compat are load-bearing. The model itself did not change; the label stopped lying about it.

**Still staged:** the workflow file's display name — `.github/workflows/deepseek-16b.yml` lines 21–22 (`name:` / `run-name:` → Qwen/Qwen3-8B) — was **not** in PR #337. The Muse GitHub App's push fails with 403 on `.github/workflows/*` (missing Workflows permission), so the rename is staged as a patch at `~/workspace/.scratch/fc-label-fix-staged/`, behind the **same permission wall as Thread A** (§2 above): it lands when the owner grants the App "Workflows: Read and write", applies the hunks in the web UI, or a workflows-credentialed lane pushes it.

### Thread status re-verified at this addendum (2026-10-30)

- **Thread A (§2): unchanged.** The patch file (`~/workspace/agent-channel/deepseek-workflow-followup-2026-10-29.patch`) and the staged tree (`~/workspace/.scratch/threadA-stage/`) are present as recorded; PR #337 touched no workflow file, so the repetition-penalty fix remains blocked on the GitHub App Workflows permission, with the same three unblocks.
- **Thread B (§3): unchanged, fix not yet built.** PR #337 changed strings only on the forgeTools path — no logic. A grep of the post-#337 tree still finds `onDeepSeekDispatch` at exactly one site, `src/App.tsx:1332` (the `ask_deepseek` direct path); the main chat path's `toolCtx` still omits it, so the defect and the proposed fix shape in §3 stand exactly as diagnosed.
