<!--
ForgeClaw directive item: Item 3 handoff and cross-account continuation brief.
Decisions made: preserve the existing local llama.cpp path, reasoning trace, provider
architecture, and Guardian boundaries; implement Tier 0 as a dependency-free,
shadow-only module until Item 4 exists. The source-of-record spec file referenced
by the directive was unavailable, so tunable defaults are documented explicitly.
Unfinished or untested: Items 4–9; live-provider integration; Guardian admission;
promotion/eviction; cutover; corpus sync; concurrency; telemetry; and remote push.
-->

# ForgeClaw Dual-Tier Reflex Architecture — Manus Handoff

## Handoff state

This handoff is for the next Manus account. The approved work began at **Directive Item 3** after Items 1–2 had already been investigated and reviewed.

- **Repository:** `DeviousDevv303/forgeclaw`
- **Branch:** `fix/local-response-render`
- **HEAD:** `6f76a1038ad7872ef0b50ce8bf2953bd9665994d`
- **Remote state:** branch is one commit ahead of `origin/fix/local-response-render`; no remote push has been performed by this task.
- **Working tree at handoff creation:** clean.
- **Tracking issue:** [ForgeClaw Tier-0 Handoff Status #3](https://github.com/DeviousDevv303/forgeclaw/issues/3)
- **Issue state:** open.

The prior baseline was commit `50bfb6a2949d80143a2c7e63db122018dd191058`.

## What was completed before Item 3

The inherited investigation established the following:

1. Local runtime is **llama.cpp/llama-server**, not Ollama.
2. The verified local endpoint is `http://127.0.0.1:8080/v1`.
3. OpenRouter was removed from the runtime/provider path and must not be reintroduced.
4. The existing reasoning trace UI must remain intact.
5. The old Manus Live Think execution drawer was removed while preserving the separate reasoning trace.
6. Local response rendering was fixed so successful local responses can appear as ordinary assistant messages.
7. Context sanitization and local stream-preservation work landed in earlier commits.
8. The current branch baseline before Item 3 was `50bfb6a`.
9. Directive Item 1 investigation found the TRACE UI is a hybrid of regex parsing and metadata.
10. Directive Item 2 investigation found no Guardian policy write-path suitable for a Tier-0 admission gate; append-only audit/session writes were observed instead.

Do not change these established behaviors while continuing the Tier-0 work.

## Item status 1–9

| Directive item | Status | Current record |
|---|---|---|
| 1. Trace panel/source investigation | Complete | Investigated before implementation. Preserve the reasoning trace UI. |
| 2. Guardian write-path investigation | Complete | No existing Guardian-policy mutation path was found. |
| 3. Tier 0 reflex core | **Complete** | Commit `6f76a1038ad7872ef0b50ce8bf2953bd9665994d`. |
| 4. Unified Guardian gate | **Not started** | Must be downstream of both Tier 0 and Tier 1 before admission/execution. |
| 5. Promotion/eviction lifecycle | Not started | Do not silently implement this as part of Item 4. |
| 6. Shadow mode/cutover | Not started | Thresholds and independent breakers remain unresolved. |
| 7. Outbound corpus sync | Not started | No implementation begun. |
| 8. Concurrency safety | Not started | No implementation begun. |
| 9. Telemetry | Not started | No implementation begun. |

## Item 3 implementation

Commit `6f76a1038ad7872ef0b50ce8bf2953bd9665994d` has the message:

```text
feat: [Item 3] Manus adds Tier-0 reflex core
```

Files added:

- `src/tier0/bm25Index.ts`
  - Dependency-free BM25 inverted index.
  - Configurable `k1`, `b`, token limit, and document limit.
  - Defaults: conventional `k1=1.2`, `b=0.75`, up to 512 terms/document and 1,024 documents.
  - When at capacity, new documents are refused rather than silently evicted. Item 5 owns actual promotion/eviction policy.
- `src/tier0/linearClassifier.ts`
  - Sparse one-vs-rest logistic regression.
  - Bounded SGD training.
  - Elastic-net regularization using configurable L1/L2 weights.
- `src/tier0/reflexCore.ts`
  - Composes BM25 retrieval and classifier prediction.
  - `evaluate()` returns a recommendation in `mode: 'shadow'`.
  - Always returns `handled: false`.
  - Does not invoke providers, agents, tools, Guardian, persistence, or UI state.
- `src/tier0/reflexCore.test.ts`
  - BM25 ranking test.
  - Small linearly separable classifier test.
  - Explicit shadow-only/non-handling test.

## Verified commands

All of the following passed after the final Item 3 implementation:

```text
npm run test:run -- src/tier0/reflexCore.test.ts
```

Result: 1 test file, 3 tests passed.

```text
npm run lint
```

Result: passed.

```text
npm run build
```

Result: TypeScript build and Vite production build passed. The only output was the existing Browserslist staleness warning.

```text
npm run check:conflicts
git diff --check
```

Result: passed; no conflict markers and no whitespace errors.

The final verification also confirmed all four Item 3 files exist and are non-empty, and the working tree was clean after commit.

## Design decisions and constraints

- No new dependency was added.
- No Ollama support was added.
- No OpenRouter support was restored.
- No endpoint, port, CSP, provider routing, local streaming parser, Guardian behavior, reasoning trace UI, or chat rendering code was changed for Item 3.
- Tier 0 is not connected to live execution. This is intentional: Item 4 must establish the mandatory unified Guardian gate first.
- The referenced `forgeclaw-tier0-spec-addition.md` was not present in the checkout. Therefore BM25 parameters, classifier regularization, confidence threshold, memory bounds, and lifecycle details are configurable defaults rather than claims that a missing specification was satisfied exactly.
- The core is not a production acceptance of the `<10 MB resident memory` or `<50 ms latency` targets. Those require measurement under the intended corpus/device workload and must be recorded before cutover.

## Required next work: Item 4

Implement only the unified Guardian gate next, unless the user explicitly changes scope.

Required architectural direction:

1. Define one shared proposed-action/result shape for Tier 0 recommendations and Tier 1/LLM results.
2. Route both tiers through the same downstream Guardian admission decision.
3. Preserve the current Tier 1 path and existing reasoning trace.
4. Do not execute a Tier 0 reflex directly from `Tier0ReflexCore`.
5. Add focused tests proving both Tier 0 and Tier 1 proposals reach the same gate.
6. Do not fold promotion/eviction, cutover, corpus synchronization, or telemetry into Item 4 unless the directive explicitly requires it.
7. Update issue #3 before committing and again after validation.

## Reporting and credit/handoff protocol

These rules are mandatory for every continuation:

- Monitor remaining credits throughout the task.
- When remaining credits reach approximately **50**, stop starting new subtasks immediately, even if an item is mid-implementation.
- At that point, commit all current work-in-progress, including incomplete work, with a commit message containing **`[HANDOFF]`**.
- Every commit must reference the directive item number, for example:

  ```text
  feat: [Item 4] Manus adds unified Guardian gate
  ```

- If stopping mid-item, add a comment at the exact stopping point in the affected file stating what is complete and what remains next.
- Every new file must begin with a documentation comment block stating:
  1. which directive item it implements;
  2. decisions made and why, especially configurable/TBD decisions made concrete;
  3. unfinished or untested work in that file.
- Open or update tracking issue #3 with:
  1. which Items 1–9 are complete, in progress, or not started;
  2. exact files and what is done/remaining for each in-progress item;
  3. unresolved decision points;
  4. deviations from the specification and why;
  5. the explicit next action for the successor.
- Include **`@claude`** in the tracking issue body or comment when the handoff is intended to trigger the Claude workflow.
- After implementation, post a push/commit comment in issue #3 containing the commit hash, exact files, validation commands/results, known limitations, and next action.
- Do not claim phone/live acceptance from static or sandbox validation. Clearly distinguish sandbox tests from real device/provider tests.
- Before stopping, verify intended files exist and the working tree/commit state is accurately reported.
- Do not push to the remote unless explicitly authorized; the current Item 3 commit is local and the branch is one commit ahead.

## Current issue comments / workflow note

Issue #3 contains:

- the initial Item 1–9 status and handoff requirements;
- the Item 3 completion comment with commit and validation details;
- an update marking Item 3 complete and Item 4 as the next action.

The issue was tagged with `@claude`. The configured Claude workflow attempted to run and posted error comments indicating it encountered an error immediately. This is recorded on the issue; do not treat those workflow comments as evidence that Item 4 was implemented.

## Immediate continuation checklist

Before editing:

```bash
git status --short --branch
git rev-parse HEAD
gh issue view 3 --repo DeviousDevv303/forgeclaw
```

Then read the relevant Guardian/orchestrator files and verify the exact existing contracts. Do not assume a write-path exists merely because a Guardian read/admission helper exists.

At the end of the next bounded work unit:

```bash
npm run test:run
npm run lint
npm run build
npm run check:conflicts
git diff --check
git status --short --branch
```

Update issue #3, commit with the directive item number and `Manus` attribution, and stop at the credit threshold.

**Current stopping point:** Item 3 is complete and verified. Item 4 is not started.
