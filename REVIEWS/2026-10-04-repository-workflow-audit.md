<!--
Directive item Tier 1/Tier 2 — Codex Anima / ForgeClaw / Guardian repository and workflow audit.
Design decisions: Tier 1 changes are limited to non-Guardian CI/reproducibility defects and the requested structured corpus adapter; Tier 2 findings are proposals only. Facts below are tied to commands, diffs, test output, and GitHub records rather than self-report narrative.
Remaining: PR #31 requires normal review and merge decision; all Tier 2 proposals require Founder per-item decisions before implementation.
-->

# ForgeClaw Repository + Workflow Audit

**Audit date:** 2026-10-04
**Repository:** `DeviousDevv303/forgeclaw`
**Base audited:** `main` at `6228c5a` (`fix: pass chat template inputs to DeepSeek`)
**Working branch:** `audit/tier1-autonomous-fixes`
**Scope:** application source, tests, GitHub Actions workflows, and the requested Guardian/Tier 2 surfaces.

## Executive result

- **Tier 1 shipped:** one coherent PR covering CI test enforcement, reproducible Pages installs, and the requested autonomous-fix learning adapter.
- **Tier 1 PR:** [PR #31](https://github.com/DeviousDevv303/forgeclaw/pull/31)
- **Tier 1 test delta:** **153 passed / 8 skipped / 161 total → 154 passed / 8 skipped / 162 total**.
- **Lint:** passed before and after.
- **Build:** passed before and after. Existing warnings remain: stale Browserslist data and bundles larger than 500 kB.
- **Tier 2:** findings and proposed diffs only. No changes were made to `src/lib/guardianGate.ts`, `executeTool()`, shell dispatch, `WRITE_TOOL_NAMES`, `CODING_READONLY_TOOL_NAMES`, protected permission blocks, or foundation safety tests.
- **Remote fact:** `main` is not branch-protected (`GET /branches/main/protection` returned 404 / `Branch not protected`). This is recorded as Tier 2 because it concerns review and authority enforcement.
- **Remote fact:** `.github/workflows/revenant-guardian-check.yml` is absent locally and on `origin/main`.

## Commands and actual results

| Command | Result |
| --- | --- |
| `npm run test:run` on base | `28` test files: `27 passed`, `1 skipped`; `153 passed`, `8 skipped`, `161 total` |
| `npm run lint` on base | exit `0` |
| `npm run build` on base | exit `0`; Vite build succeeded |
| `npm run test:run` after Tier 1 changes | `29` test files: `28 passed`, `1 skipped`; `154 passed`, `8 skipped`, `162 total` |
| `npm run lint` after Tier 1 changes | exit `0` |
| `npm run build` after Tier 1 changes | exit `0`; Vite build succeeded |
| `git diff --check` | passed |
| `gh api repos/DeviousDevv303/forgeclaw/branches/main/protection` | `404`, `Branch not protected` |

---

# Tier 1 — Implemented and shipped

## T1-01 — Pull-request gate omitted tests; Pages deployment ignored the lockfile

**Verified defect:** `.github/workflows/build-gate.yml` ran conflict checks and `npm run build` but did not run `npm run test:run`. A regression could therefore pass the pull-request build check. `.github/workflows/deploy.yml` used `npm install`, allowing deployment dependency resolution to diverge from the committed `package-lock.json`.

**Implemented changes:**

- Added a `Run test suite` step invoking `npm run test:run` to `build-gate.yml`.
- Replaced `npm install` with `npm ci` in `deploy.yml`.
- Added `appendAutonomousFixLearning()` in `src/lib/corpus.ts`, using the existing `{ interaction: CorpusRecord; candidate: LearningCandidate }` path, fixed `source: 'autonomous-fix'`, structured JSON facts, integrity hashing, and the existing unapproved `candidate` status.
- Added `tests/autonomousFixLearning.test.ts` covering structured facts, source, candidate status, and the no-automatic-approval boundary.

**Files changed:**

- `.github/workflows/build-gate.yml`
- `.github/workflows/deploy.yml`
- `src/lib/corpus.ts`
- `tests/autonomousFixLearning.test.ts`

**Commit:** `6351ac6` — `ci(tier1): enforce tests and reproducible deploy installs`

**PR:** [#31](https://github.com/DeviousDevv303/forgeclaw/pull/31)

### Verified autonomous-fix learning candidate

Recorded by calling `appendAutonomousFixLearning()` after PR creation. The entry was emitted with `admissionStatus: "candidate"` and was not approved.

```json
{
  "source": "autonomous-fix",
  "filesChanged": [
    ".github/workflows/build-gate.yml",
    ".github/workflows/deploy.yml",
    "src/lib/corpus.ts",
    "tests/autonomousFixLearning.test.ts"
  ],
  "description": "Pull-request validation omitted tests and deployment installs ignored the lockfile.",
  "testCountBefore": 153,
  "testCountAfter": 154,
  "prUrl": "https://github.com/DeviousDevv303/forgeclaw/pull/31",
  "admissionStatus": "candidate"
}
```

The candidate output also contained an integrity hash and `recordType: "learning_candidate"`. No free-form reasoning or completion narrative was stored.

## Tier 1 observations not changed

These were verified but are not blocking defects for this PR:

1. **Skipped tests:** 8 tests are skipped, including the live acceptance test and environment-dependent provider tests. Enabling them requires external runtime/service availability and should be handled as a separate test-environment decision.
2. **Build performance:** Vite reports the generated `lib` chunk at approximately 6.0 MB / 2.16 MB gzip and the main chunk above 500 kB. Code-splitting is a valid follow-up performance task, but changing chunk boundaries is broader than the small same-day CI fix.
3. **Tooling freshness:** the build reports Browserslist data is 7 months old. This is maintenance, not a production correctness failure; dependency updates should be separately reviewed and tested.
4. **Workflow model cost:** `code-review.yml`, `deepseek-16b.yml`, and `image-analyze.yml` install large CPU model stacks on demand. This is an efficiency/cost concern, but changing model/runtime strategy needs an explicit resource target.

---

# Tier 2 — Analyze and report only; proposed diffs await Founder decision

No Tier 2 proposal below was implemented, committed, or added to the corpus.

## T2-01 — `tier1Active` fails open for all Guardian checks

**Evidence:** `src/lib/guardianGate.ts` returns `false` immediately when `tier1Active` is false. `ToolContext.tier1Active` is optional and defaults false wherever `Boolean(ctx.tier1Active)` is passed by `executeTool()`.

**Risk:** A caller that omits the posture flag runs all listed destructive operations without a co-sign. This is a fail-open default at the central dispatcher boundary.

**Proposed diff:**

```diff
- if (!tier1Active) return false
+ if (tier1Active !== true) return true
```

That minimal form is intentionally **not** recommended as a final implementation because read-only tools would also need an explicit allow-list. Recommended design: define a project-owned posture enum, default the dispatcher to a safe/armed state, and classify each tool as read-only, reversible, or co-sign-required. Add production-dispatch tests for omitted posture, explicit autonomous posture, and explicit co-sign posture.

**Founder decision needed:** choose the default posture and whether any autonomous exception is allowed.

## T2-02 — Guardian approval is a boolean callback, not auditable approval evidence

**Evidence:** `executeTool()` calls `ctx.requestGuardianApproval(normalizedCall)` and proceeds when the return value is truthy. The callback returns only `Promise<boolean>`; no approval ID, policy version, actor identity, timestamp, call digest, or append-only decision record is required at the boundary.

**Risk:** A UI callback can report approval without producing verifiable evidence that the exact normalized tool call was reviewed. This weakens replay/audit guarantees for irreversible actions.

**Proposed diff:**

```diff
- requestGuardianApproval?: (call: ToolCall) => Promise<boolean>
+ requestGuardianApproval?: (call: ToolCall) => Promise<GuardianApproval>
+
+ interface GuardianApproval {
+   approved: boolean
+   approvalId: string
+   callDigest: string
+   policyVersion: string
+   decidedAt: string
+ }
```

`executeTool()` would hash the normalized call, require a matching approval digest, and persist a terse decision record before the side effect. Rejection and missing evidence would remain fail-closed.

## T2-03 — Shell execution is hard-coded to `main` and the workflow has write permission

**Evidence:** `executeTool()` dispatches `shell-exec.yml` with `ref: 'main'`. `shell-exec.yml` declares `permissions: contents: write`, checks out that ref, and executes arbitrary `bash -c "$FORGE_COMMAND"` inside the checkout. The working-directory check prevents path escape but does not restrict command capabilities or repository writes.

**Risk:** A co-signed shell request can mutate the default branch and use the workflow token to push changes. This combines execution authority with repository write authority in a path described as command execution.

**Proposed diff:**

```diff
 permissions:
-  contents: write
+  contents: read
```

```diff
- ref: 'main'
+ ref: requestedRef
```

The final design must decide whether shell execution may ever write. If writes are intended, use an explicit, isolated feature branch and a separate write workflow with its own approval and review contract. If writes are not intended, add a read-only checkout or disposable worktree and deny push-capable commands. Add tests for ref selection, write attempts, and token scope.

## T2-04 — Requested `revenant-guardian-check.yml` workflow is absent

**Evidence:** `find .github/workflows` and `git ls-tree -r --name-only origin/main` list 10 workflows, including `shell-exec.yml`, but no `revenant-guardian-check.yml`.

**Risk:** The named Guardian workflow cannot enforce anything because it is not present. There is no repository-level check in the audited workflow set that verifies the production Guardian gate, protected path list, or permission policy.

**Proposed diff:** add a new workflow (not implemented) that, on pull requests and protected workflow changes, runs production Guardian contract tests, scans for protected path edits, validates workflow permission blocks, and fails when the required check is absent or weakened. Its own token should be read-only and its workflow file should be included in the protected-path policy.

## T2-05 — `WRITE_TOOL_NAMES` and `CODING_READONLY_TOOL_NAMES` are not a single authority taxonomy

**Evidence:** `WRITE_TOOL_NAMES` in `src/lib/managedAgent.ts` is a hand-maintained set. `CODING_READONLY_TOOL_NAMES` is derived from `CODING_TOOL_ORDER`, but `coding_task_update` is included in the read-only-derived list while it persists coding-agent state. Guardian’s `ALWAYS_COSIGN` separately includes tools such as `sculpt_self` and `generate_image` that are not represented in the coding capability order.

**Risk:** Capability filtering and Guardian classification can drift. A tool can be treated as “read-only” by a capability profile while still mutating durable state, or can be omitted from one taxonomy and silently miss a future capability path.

**Proposed diff:** replace separate name lists with one typed registry containing `capability`, `sideEffect`, and `coSignPolicy` metadata. Derive both capability arrays and Guardian checks from that registry. Add a test asserting every registered tool has exactly one classification and that no state-mutating tool appears in the read-only set.

## T2-06 — Foundation tests do not exercise production Guardian code

**Evidence:** `tests/foundation/` imports standalone modules under `foundation/guardian`, `foundation/contracts`, and `foundation/runtime`. None of those tests import `src/lib/guardianGate.ts`, `executeTool()`, `shell-exec.yml`, or the workflow permission declarations. The current production Guardian behavior is tested separately in `src/lib/corpus.test.ts`, `managedAgent.test.ts`, and `toolExecutionChain.test.ts`, but the foundation suite does not guard it.

**Risk:** The foundation suite can remain green while the production gate, tool taxonomy, or workflow permissions regress. The test names imply constitutional coverage broader than the actual import graph.

**Proposed diff:** add explicit integration tests that import the production dispatcher and inspect the protected workflow files. Keep the standalone foundation tests as unit tests, but add assertions for: omitted posture, every co-sign tool, branch-aware writes, shell dispatch ref, workflow permission scope, protected-file self-edit rejection, and candidate admission status.

## T2-07 — Foundation safety predicates are permissive and under-specified

**Evidence:** `foundation/guardian/corpusAdmission.ts` rejects only the exact string `"Guardian"`; other case variants are accepted. `foundation/evidence/provenance.ts` treats any non-empty source with `authenticated: true` as sufficient. `foundation/guardian/replacement.ts` accepts only one exact path but has no negative/normalization cases in its test.

**Risk:** Normalization and provenance policy are implicit. Case variation, whitespace, path aliases, or weak authentication claims could produce inconsistent results if these helpers become connected to production flows.

**Proposed diff:** normalize and validate origins and paths centrally, replace a boolean `authenticated` flag with a typed authenticated provenance object, and add negative/normalization tests. Do not connect these helpers to production Guardian until the Founder approves the constitutional contract.

## T2-08 — `main` has no remote branch protection

**Evidence:** GitHub API returned `{"message":"Branch not protected","status":"404"}` for `main`.

**Risk:** The repository’s local guidance says review is required before merging, but the remote branch currently does not enforce required reviews or required checks. A workflow or direct push can bypass the intended review boundary.

**Proposed diff / operational change:** configure branch protection or repository rulesets requiring pull requests, at least one review, dismissal of stale approvals as appropriate, and the build gate (plus the future Guardian check) before merge. This is an external repository-settings change and therefore remains outside this implementation PR.

## T2-09 — Permissions blocks require explicit Founder review

**Evidence:** The requested protected workflows declare write scopes, including `shell-exec.yml` (`contents: write`), `deploy.yml` (`contents: write`), `generate-image.yml` (`contents: write`), `self-sculpt.yml` (`contents: write`, `pull-requests: write`), and the issue-triggered job in `claude.yml` (`contents: write`, `pull-requests: write`, `issues: write`, `id-token: write`).

**Risk:** These scopes may be required by their intended operations, but they are high-impact authority boundaries and are explicitly Tier 2 in the directive. No scope was reduced in this audit.

**Proposed diff:** for each workflow, reduce to the minimum job-level permissions required by its actual API calls; isolate write-capable jobs from read-only validation jobs; add a permissions-policy test or static check; and require the Guardian workflow plus branch ruleset before permitting merges. Founder approval is required per workflow and scope.

---

# Files intentionally not changed

- `src/lib/guardianGate.ts`
- `src/lib/forgeTools.ts` / `executeTool()`
- `src/lib/managedAgent.ts` taxonomy (`WRITE_TOOL_NAMES`, `CODING_READONLY_TOOL_NAMES`)
- `.github/workflows/shell-exec.yml`
- `.github/workflows/revenant-guardian-check.yml` (absent; no file created)
- all workflow `permissions:` blocks
- `tests/foundation/`
- `foundation/`

# Review status

- PR opened: [https://github.com/DeviousDevv303/forgeclaw/pull/31](https://github.com/DeviousDevv303/forgeclaw/pull/31)
- No merge to `main` performed.
- Tier 2 proposals are awaiting explicit per-item Founder decisions.
