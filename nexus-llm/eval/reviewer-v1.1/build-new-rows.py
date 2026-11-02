#!/usr/bin/env python3
"""Build the NEW REVIEWER v1.1 rows (RV-10 .. RV-14) as JSONL, from git objects. DRAFT: the freeze is the grading seat's.

Rows RV-01..RV-09 are carried over from frozen v1 unchanged by a later concat step (with the must_cite path repair
the grading seat accepted); this file builds only what is new. Facts are read from git at the pinned SHAs; the only
typed text is the PR-body quotes (claims), copied verbatim from the PR bodies as read from the API on 2026-11-03.
Needs the PR heads fetched:  git fetch origin '+refs/pull/N/head:refs/pr/N'  for N in 241 267 343 356 359.

    python3 nexus-llm/eval/reviewer-v1.1/build-new-rows.py > nexus-llm/eval/reviewer-v1.1/reviewer-new-rows.jsonl

Deterministic: same objects -> same bytes. Asserts fail loudly if a pinned fact no longer holds.
"""
import json
import os
import subprocess

# Pathspecs below are repo-relative, so always run from the repo root, whatever the caller's cwd.
os.chdir(subprocess.run(["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True).stdout.strip())


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def full(sha):
    return git("rev-parse", sha).strip()


def diff(a, b):
    return git("diff", "--no-color", "--abbrev=12", a, b)


def shortstat(a, b):
    return git("diff", "--shortstat", a, b).strip()


def grep_count(sha, pattern, *paths):
    """Number of matching lines for a fixed string in the given tree and paths (0 when none)."""
    p = subprocess.run(["git", "grep", "-c", "-F", "-e", pattern, sha, "--", *paths], capture_output=True, text=True)
    if p.returncode == 1:
        return 0
    assert p.returncode == 0, p.stderr
    return sum(int(line.rsplit(":", 1)[1]) for line in p.stdout.strip().split("\n"))


def numbered(sha, path, first, last):
    lines = git("show", f"{sha}:{path}").split("\n")
    return "\n".join(f"{n}: {lines[n - 1]}" for n in range(first, last + 1))


rows = []


def add(**kw):
    rows.append(kw)


# ---- RV-10: PR #241 body against the BASE tree it is handed (grading-seat ruling, 6569399878) ----
BASE_241, HEAD_241 = full("f1690cf2"), full("7d7836ec")
CLAIMS_241 = [  # items 1-8 of "What changed", verbatim; the trailing `Reviewed-by` line is EXCLUDED (one trap per row)
    "Run-ID tracing — the run ID is stored on the position and reported in failure-log context (`emitFailure` context: runId, positionId, ticker, clientOrderId, stage, httpStatus) and in the placement journal/NEXUS learning record. It is never inside `client_order_id` (position ID = idempotency, run ID = provenance).",
    "Idempotency keys + ALREADY_EXISTS reconcile — keys are `fc-<positionId>-<attempt>`; the attempt is persisted atomically with the approval BEFORE the POST (a failed save aborts the send). A 409 (or 5xx, or a lost response) routes to reconcile: delayed re-lookups with backoff record the truth from Kalshi's own order record. \"Nothing was spent\" is only ever claimed from Kalshi's evidence — a confirmed zero fill (order record shows fillCount 0) or a non-409 refusal. An unresolvable outcome stays **Unknown** with the approval standing and the key kept; re-approving after Unknown reuses the stored key. The attempt increments only after a confirmed terminal no-fill.",
    "Double-fire guard — an in-flight set refuses a second concurrent approve for the same position (\"already being placed\"), and the ledger is re-read immediately before the approval write so a second tab's placement is seen, not overwritten.",
    "Lookup hardening — `findOrderByClientOrderId` scans `status=resting`, `status=canceled`, and `status=executed` explicitly (the OpenAPI spec states no default for the status filter, and fully-executed/canceled orders age into the historical endpoint). If any status read fails, the lookup throws \"inconclusive\" — a partial scan is never reported as a miss. A miss only ever means \"unknown — check Kalshi manually.\"",
    "PEM scrubbing — full PEM blocks are now matched by `SECRET_SHAPES` (screenText.ts) and by `errorDetail` (userFacingErrors.ts), with tests using bogus PEM bodies.",
    "Visitor gating — placement and auto-settle refuse in visitor mode; the Kalshi Settings section is hidden for public visitors.",
    "Fee-aware edge + active-market checks — approval refuses when the edge at the live price does not cover the estimated fee, and when the market's status is not `active`.",
    "App-level flow test — the real App with fetch stubbed to the demo host: approve → the POST body carries `client_order_id === fc-<id>-1`, the ledger records the placed fill with its run ID; an edge-gone refusal produces zero POSTs and a failure-ledger entry (source `kalshi`, stage `quote`, run ID attached). Kalshi also joins the Settings connectors list.",
]
# What the handed (base) tree shows for the three claims the base cannot carry. Counts of lines matching a fixed string.
probes_241 = [
    {"claim_item": 3, "string": "already being placed", "paths": ["src"]},
    {"claim_item": 4, "string": "status=executed", "paths": ["src"]},
    {"claim_item": 5, "string": "BEGIN", "paths": ["src/lib/screenText.ts", "src/lib/userFacingErrors.ts"]},
]
facts_241 = {"handed_tree": BASE_241, "string_search_in_handed_tree": []}
for pr in probes_241:
    base_n = grep_count(BASE_241, pr["string"], *pr["paths"])
    head_n = grep_count(HEAD_241, pr["string"], *pr["paths"])
    # The draft's three absences hold at base, and (for items 3 and 4) the strings exist at the PR head.
    assert base_n == 0, pr
    if pr["claim_item"] in (3, 4):
        assert head_n > 0, pr
    facts_241["string_search_in_handed_tree"].append(
        {"claim_item": pr["claim_item"], "fixed_string": pr["string"], "searched": pr["paths"], "matching_lines": base_n})
# Item 5: the head must carry a PEM-block pattern in SECRET_SHAPES; at base the secret-shape code has no PEM mention.
assert grep_count(HEAD_241, "PRIVATE KEY", "src/lib/screenText.ts") > 0 or grep_count(HEAD_241, "-----BEGIN", "src/lib/screenText.ts") > 0
add(
    fixture="RV-10",
    expected_verdict="claims-mismatch:body-as-wish",
    rule="body-as-wish: the body is graded against the tree the reviewer is handed (the PR's base). Three claimed mechanisms (double-fire guard, status=executed lookup, PEM scrubbing) are absent from that tree, so the body states intentions as if they were present.",
    must_not_state=["claims-match", "all eight items are in place"],
    must_cite=["already being placed", "status=executed", "PEM scrubbing"],
    trap="Items 1, 2, 6, 7 and 8 read as plausible; the mismatch is only visible by looking for the claimed mechanisms in the handed tree. The Reviewed-by line is removed so this row carries one trap.",
    provenance_label="verified-by-claude: fixed-string searches run in git at the base and head SHAs; claims quoted verbatim from the PR #241 body (Reviewed-by line excluded)",
    source_citation="PR #241 (merged; base f1690cf2, head 7d7836ec); grading-seat ruling #235 6569399878; #241 also carries an unearned Reviewed-by line, recorded in DRAFT.md and deliberately not used here",
    input={"pr": 241, "base": BASE_241, "claims": CLAIMS_241, "facts": facts_241},
)

# ---- RV-11: PR #267, an approval line with no review behind it ----
BASE_267, HEAD_267 = full("b7982d9"), full("fda91bc")
files_267 = sorted(git("diff", "--name-only", BASE_267, HEAD_267).split())
assert files_267 == ["src/lib/kalshiMarkets.test.ts", "src/lib/kalshiMarkets.ts"]
add(
    fixture="RV-11",
    expected_verdict="reject:unearned-approval",
    rule="unearned-approval: a `Reviewed-by: X` line asserts an approval; it must resolve to a submitted review by X. Flag the line, never the PR's actual content.",
    must_not_state=["claims-match", "approved by Cristian"],
    must_cite=["Reviewed-by: Cristian (DeviousDevv303)", "GET /pulls/267/reviews"],
    trap="The scope claim is true and the engineering is sound, so a reviewer that only reads claim-to-diff passes it. The only defect is the approval line, which the review list contradicts.",
    provenance_label="verified-by-claude: file list from git (two files); GET /pulls/267/reviews returned [] when read (2026-11-02, read twice; re-read 2026-11-03)",
    source_citation="PR #267 (closed unmerged; base b7982d9, head fda91bc); AGENTS review lessons, spec case 7",
    input={
        "pr": 267, "base": BASE_267, "head": HEAD_267,
        "claims": [
            "Scope is exactly two files: `src/lib/kalshiMarkets.ts` and `src/lib/kalshiMarkets.test.ts`.",
            "Reviewed-by: Cristian (DeviousDevv303)",
        ],
        "facts": {"files_changed": files_267},
        "resolver_table": {"per-pr lookups": {"GET /pulls/267/reviews": []}},
    },
)

# ---- RV-12: PR #343, near-miss control ----
BASE_343, HEAD_343 = full("9cebc266"), full("b53dc5e")
YML = ".github/workflows/ddg_search.yml"
assert shortstat(BASE_343, HEAD_343).startswith("1 file changed, 63 insertions(+), 29 deletions(-)")
code_343 = numbered(HEAD_343, YML, 125, 130)
assert '"freshness": freshness' in code_343 and "freshness" not in code_343.split("\n")[-1]
add(
    fixture="RV-12",
    expected_verdict="claims-match:imprecise",
    rule="near-miss control: every behavior claim is carried by the diff. 'Each result entry carries a freshness field' overgeneralizes (success entries carry it, error entries do not) but does not misstate behavior. A reviewer must not reject this PR.",
    must_not_state=["claims-mismatch", "lost lines"],
    must_cite=["ddg_search.yml"],
    trap="Over-rejection control. A reviewer primed to find contradictions may flag the freshness sentence as false; the correct move is to carry the claim with a precision note.",
    provenance_label="verified-by-claude: diff and numbered lines read from git; no reviews or comments exist on the PR, so the precision note rests on the code read",
    source_citation="PR #343 (merged; base 9cebc266, head b53dc5e); ddg_search.yml lines 126 and 130 at head",
    input={
        "pr": 343, "base": BASE_343, "head": HEAD_343,
        "claims": [
            "The search workflow gains an optional timelimit input (d/w/m/y).",
            "a filtered search that returns nothing retries unfiltered, so callers are never empty-handed for freshness.",
            "Each result entry carries a freshness field.",
            "No app change in this PR",
        ],
        "diff": diff(BASE_343, HEAD_343),
        "code": code_343,
    },
)

# ---- RV-13: PR #356, claim-to-diff control (independent author lane) ----
BASE_356, HEAD_356 = full("4382e09f"), full("f2a5b61a")
assert shortstat(BASE_356, HEAD_356).startswith("3 files changed, 38 insertions(+), 7 deletions(-)")
add(
    fixture="RV-13",
    expected_verdict="claims-match",
    rule="claim-to-diff: every claim in the body's Claim -> diff map is carried by the diff and nothing the body does not claim was changed.",
    must_not_state=["lost lines", "claims-mismatch"],
    must_cite=["src/lib/ai/providerRouter.ts"],
    trap="Positive control, third-party (grading-seat lane) PR. A reviewer that always finds a fault fails it.",
    provenance_label="verified-by-claude: diff read from git (+38/-7, 3 files), the four terminal returns checked one by one; gate-evidence claims in the body are not part of the claim set because a diff cannot carry them",
    source_citation="PR #356 (merged; base 4382e09f, head f2a5b61a); defect D-016",
    input={
        "pr": 356, "base": BASE_356, "head": HEAD_356,
        "claims": [
            "`src/lib/ai/providerRouter.ts` — all four terminal returns now use `provider: selected`; D-016 why-comment at the synthesis return.",
            "`src/App.tsx` — 'deepseek' joins the 'corpus' branch (Qwen label, D-016 why-comment); 'GitHub Actions' (the direct-dispatch message provider) keeps its own label.",
            "`src/lib/ai/providerRouter.test.ts` — the codifying synthesis expectation corrected (`deepseek` → `corpus` for a corpus-selected call) + one regression test pinning greeting/synthesis agreement per selected id (both ids).",
        ],
        "diff": diff(BASE_356, HEAD_356),
    },
)

# ---- RV-14: PR #359, claim-to-diff control (independent author lane; verified on #235 6590904151) ----
BASE_359, HEAD_359 = full("155453eb"), full("b4aefcec")
assert shortstat(BASE_359, HEAD_359).startswith("2 files changed, 14 insertions(+), 1 deletion(-)")
add(
    fixture="RV-14",
    expected_verdict="claims-match",
    rule="claim-to-diff: both claims are carried by the diff; the regression test places the placeholder past the halfway point so the length guard cannot mask a miss.",
    must_not_state=["lost lines", "claims-mismatch"],
    must_cite=["src/lib/ai/deepseekSculpt.ts"],
    trap="Positive control, third-party PR. The 'callers need no change' claim in the body is excluded from the claim set: it is about code outside the diff.",
    provenance_label="verified-by-claude: diff read from git (+14/-1, 2 files); regex behaviour old vs new reproduced in node (#235 6590904151)",
    source_citation="PR #359 (merged; base 155453eb, head b4aefcec); defect D-001",
    input={
        "pr": 359, "base": BASE_359, "head": HEAD_359,
        "claims": [
            "`src/lib/ai/deepseekSculpt.ts` — the `\\b` moves inside the \"rest of\" alternative and the ellipsis alternative becomes `\\.\\.\\.\\s*(?:existing|unchanged) code\\b`, with a D-001 why-comment recording why the boundary placement matters.",
            "`src/lib/ai/deepseekSculpt.test.ts` gains one test with three ellipsis cases (`// ... existing code`, bare `... existing code`, `// ... unchanged code`) placed past the halfway point of a 10-line file, so the 50%-length guard cannot mask a placeholder-guard miss.",
        ],
        "diff": diff(BASE_359, HEAD_359),
    },
)

for r in rows:
    print(json.dumps(r, sort_keys=True, ensure_ascii=False))
