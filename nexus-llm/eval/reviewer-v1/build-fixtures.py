#!/usr/bin/env python3
"""Build the REVIEWER Benchmark v1 fixtures (reviewer-fixtures.jsonl).

Every diff, code excerpt and test count below is read from git objects at the pinned commits
(nothing is typed in by hand except the claim texts, which are verbatim PR-body / ledger quotes).
Needs a repo that has those commits (git fetch each SHA; see PINS). Run from the repo root:

    python3 nexus-llm/eval/reviewer-v1/build-fixtures.py > nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl

Deterministic: same objects -> same bytes. Asserts fail loudly if a pinned fact no longer holds.
"""
import json
import subprocess
import sys


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def diff(a, b):
    return git("diff", "--no-color", "--abbrev=12", a, b)


def show(sha, path):
    return git("show", f"{sha}:{path}")


def numbered(sha, path, first, last):
    lines = show(sha, path).split("\n")
    return "\n".join(f"{n}: {lines[n - 1]}" for n in range(first, last + 1))


def test_counts(sha):
    out = {}
    for name in ("meter", "requirements", "runner", "workflow", "world"):
        text = show(sha, f".github/scripts/test_mirofish_{name}.py")
        out[f"test_mirofish_{name}.py"] = sum(1 for ln in text.split("\n") if ln.lstrip().startswith("def test_") and ln.startswith(" "))
    out["total"] = sum(out.values())
    return out


def shortstat(a, b):
    return git("diff", "--shortstat", a, b).strip()


# ---- pins (all full 40-char SHAs resolved from the short forms in the ledger / PR pages) ----
def full(sha):
    return git("rev-parse", sha).strip()


MAIN_282, GOOD_282, BAD_282 = full("d88914de"), full("37fc8219"), full("39747df")
BASE_319, HEAD_319 = full("702bf260"), full("49c436d0")
BASE_305, HEAD_305 = full("3194ca50"), full("8ecbb3c5")
DOC_333 = full("1efdc6a")
FIX_036_BASE = full("5cb4909")
FIX_022_BASE = full("8dae503")
MAIN_348, HEAD_348 = full("09bc28de"), full("73fe3a15")

fixtures = []


def add(**kw):
    fixtures.append(kw)


# Claim texts for #282: verbatim from the PR body's "Claim -> diff map" (Diff column) and "Not touched" line.
CLAIMS_282 = [
    "src/lib/kalshiMarkets.ts:133-148 — the sentence now says \"Signed **market** reads are paused until …\"; the F-024 why-comment records the two-path split so the next editor does not re-broaden it.",
    "src/lib/kalshiReadSigner.test.ts — the three assertions now assert the scoped sentence (one carries the F-024 note).",
    "No behavior change beyond the sentence's scope; the pause mechanics are untouched.",
]

d_good = diff(MAIN_282, GOOD_282)
d_bad = diff(MAIN_282, BAD_282)
assert shortstat(MAIN_282, GOOD_282).startswith("2 files changed, 15 insertions(+), 8 deletions(-)")
assert shortstat(MAIN_282, BAD_282).startswith("2 files changed, 15 insertions(+), 72 deletions(-)")
for sym in ("kalshiServerSnapshot", "serverSnapshotHeader", "serverSnapshotAnswer"):
    assert any(ln.startswith("-") and sym in ln for ln in d_bad.split("\n")), sym
    assert not any(ln.startswith("-") and sym in ln for ln in d_good.split("\n")), sym

add(
    fixture="RV-01",
    input={"pr": "#282", "base": MAIN_282, "head": GOOD_282, "claims": CLAIMS_282, "diff": d_good},
    expected_verdict="claims-match",
    rule="claim-to-diff: every claim is carried by the diff and nothing the body does not claim was removed (lost-lines check: removed lines are only the replaced sentence, its comment and the three test assertions)",
    must_cite=["src/lib/kalshiMarkets.ts", "src/lib/kalshiReadSigner.test.ts"],
    must_not_state=["server snapshot wiring was removed"],
    trap="Positive control, paired with RV-02 (same claims, repaired head). A reviewer that always finds a problem fails here.",
    provenance_label="verified-by-claude: diff read from git (+15/-8, 2 files); claims quoted from the PR body",
    source_citation="PR #282 (merged); repaired head 37fc8219; LEDGER F-025",
)

add(
    fixture="RV-02",
    input={"pr": "#282", "base": MAIN_282, "head": BAD_282, "claims": CLAIMS_282, "diff": d_bad},
    expected_verdict="claims-mismatch:lost-lines",
    rule="lost-lines: the body claims a sentence-scope change but the diff deletes the Stage 2 server-snapshot wiring (+15/-72); a branch update is a code change and the diff is read against current main",
    must_cite=["src/lib/kalshiMarkets.ts", "serverSnapshot"],
    must_not_state=["claims-match", "no behavior change"],
    trap="The web-merge falsification. Same body as RV-01; the only difference is the diff. Passing it on the body's word is the exact failure (F-025).",
    provenance_label="verified-by-claude: both diffs read from git; +15/-72 reproduced; removed identifiers asserted by the builder",
    source_citation="PR #282 at merge commit 39747df (parents 982d1bda + d88914de); LEDGER F-025; repair comment 6378772441",
)

# ---- F-033: inflated count (doc claim vs enumeration) ----
doc_line_333 = show(DOC_333, "docs/mirofish-runner.md").split("\n")[107]
assert "200+ Python tests" in doc_line_333
counts_333 = test_counts(DOC_333)
assert counts_333["total"] == 127
add(
    fixture="RV-03",
    input={
        "ref": "docs/mirofish-runner.md:108",
        "commit": DOC_333,
        "claims": [doc_line_333],
        "facts": {
            "enumeration_def_test_per_file": counts_333,
            "ci_entry_point": "python3 -B -m unittest discover -s .github/scripts -p 'test_mirofish_*.py'",
            "ci_entry_point_output": "Ran 127 tests ... OK",
        },
    },
    expected_verdict="claims-mismatch:inflated-count",
    rule="coverage inflation: a test count is graded by enumeration and by what the CI entry point ran, never by the prose number; 127 enumerated, 127 ran",
    must_cite=["127"],
    must_not_state=["200+ is accurate", "200 tests"],
    trap="The suites pass, so a reviewer that checks only 'tests pass' misses it. The number is the claim.",
    provenance_label="verified-by-claude: per-file counts by grep of the pinned tree; 'Ran 127 tests OK' reproduced by running the entry point on that tree",
    source_citation="LEDGER F-033; PR #305 body",
)

# ---- F-035: the fixed count is itself stale against the PR's base ----
counts_305 = test_counts(BASE_305)
assert counts_305["total"] == 151
d_305 = diff(BASE_305, HEAD_305)
assert shortstat(BASE_305, HEAD_305).startswith("1 file changed, 1 insertion(+), 1 deletion(-)")
add(
    fixture="RV-04",
    input={
        "pr": "#305",
        "base": BASE_305,
        "head": HEAD_305,
        "claims": [
            "docs/mirofish-runner.md, exactly +1/−1 — \"200+ Python tests\" → \"127 Python tests\". Nothing else changes.",
            "the five suites that sentence enumerates — .github/scripts/test_mirofish_{meter,requirements,runner,workflow,world}.py — contain 22 + 9 + 50 + 28 + 18 = 127 test functions",
            "ran the exact CI entry point on main `1efdc6a` ... → \"Ran 127 tests … OK\"",
        ],
        "diff": d_305,
        "facts": {
            "enumeration_def_test_per_file_at_base": counts_305,
            "note": "The PR's base is 3194ca5, which already contains the merged tests of an earlier PR; the body's measurement was taken on 1efdc6a, an older tree.",
        },
    },
    expected_verdict="claims-mismatch:stale-count",
    rule="stale-count: the new number is graded against the tree the PR will merge into (its base), not the older tree it was measured on; 151 enumerated at the base, the diff writes 127",
    must_cite=["151", "127"],
    must_not_state=["127 is correct for this base"],
    trap="The body's evidence is real and internally consistent, but for a different tree. Diff and gate would both pass.",
    provenance_label="verified-by-claude: base-tree counts by grep and by running the entry point (Ran 151 tests OK at 7d6c770, same suites); claims quoted from the PR body",
    source_citation="LEDGER F-035; PR #305 (base 3194ca5, head 8ecbb3c)",
)

# ---- F-036: a verdict that contradicts itself ----
code_036 = numbered(FIX_036_BASE, "src/lib/kalshiMarkets.ts", 351, 355) + "\n...\n" + numbered(FIX_036_BASE, "src/lib/kalshiMarkets.ts", 586, 590)
assert "seriesRead: [...KALSHI_GAME_SERIES]" in code_036
add(
    fixture="RV-05",
    input={
        "ref": "board-scan no-match verdict (kalshiMarkets.ts)",
        "commit": FIX_036_BASE,
        "claims": ["board scan read the game/fight series ... in full"],
        "code": code_036,
        "rendered_verdict_with_KXNFLGAME_answering_HTTP_500": "board scan read the game/fight series KXUFCFIGHT, KXUFCMOV, KXUFCDISTANCE, KXMMAFIGHT, KXNFLGAME, KXNCAAFGAME in full; could not read KXNFLGAME",
    },
    expected_verdict="claims-mismatch:self-contradiction",
    rule="self-contradiction: seriesRead is built from the full series list unconditionally (line 589), so a series in seriesFailed appears in both the 'read in full' and 'could not read' halves",
    must_cite=["src/lib/kalshiMarkets.ts", "589", "KXNFLGAME"],
    must_not_state=["KXNFLGAME was read in full", "claims-match"],
    trap="The sentence reads fluently; the contradiction is only visible by comparing the two halves or reading line 589.",
    provenance_label="code: verified-by-claude from git; rendered verdict: reported by the PR #319 body (headless run), not re-run by this lane",
    source_citation="LEDGER F-036; PR #319 body",
)

# ---- F-036 fix: positive control ----
d_319 = diff(BASE_319, HEAD_319)
assert shortstat(BASE_319, HEAD_319).startswith("2 files changed, 17 insertions(+), 1 deletion(-)")
add(
    fixture="RV-06",
    input={
        "pr": "#319",
        "base": BASE_319,
        "head": HEAD_319,
        "claims": [
            "`kalshiMarkets.ts` — `seriesRead` is now `KALSHI_GAME_SERIES.filter(s => !seriesFailed.includes(s))`, with an F-036 why-comment. The failed series is still named in the \"could not read\" half; the non-empty path's caveat is unchanged.",
            "`kalshiMarkets.test.ts` — one regression test: a failed series is not also claimed as read in full in the no-match verdict.",
            "diff vs main exactly +17/−1 (2 files)",
        ],
        "diff": d_319,
    },
    expected_verdict="claims-match",
    rule="claim-to-diff: all three claims are carried by the diff; the test asserts both halves of the verdict",
    must_cite=["src/lib/kalshiMarkets.ts", "src/lib/kalshiMarkets.test.ts"],
    must_not_state=["lost lines"],
    trap="Positive control on the same file as RV-05. A reviewer primed to find contradictions must still pass a correct fix.",
    provenance_label="verified-by-claude: diff read from git (+17/-1, 2 files, identical to the body's claim)",
    source_citation="PR #319 (merged); LEDGER F-036",
)

# ---- F-022: status asserted over an unread reply ----
code_022 = numbered(FIX_022_BASE, "src/lib/corpus.ts", 684, 699)
i18n_022 = numbered(FIX_022_BASE, "src/lib/i18n.ts", 142, 142)
assert "response.json().catch(() => ({}))" in code_022 and "status: 'synced'" in code_022 and "Synced {n}" in i18n_022
add(
    fixture="RV-07",
    input={
        "ref": "CorpusRepository.syncPending status",
        "commit": FIX_022_BASE,
        "claims": ["syncPending returns status 'synced' (rendered to the user as \"Synced N candidate updates\") after a webhook sync"],
        "code": code_022,
        "ui_string": i18n_022,
    },
    expected_verdict="claims-mismatch:unread-reply",
    rule="unread-reply: a success status is asserted over a response body that was never read (an unparseable 200 is swallowed to {} at line 686, zero updates reconciled, and 'synced' is still returned at line 699); contract unverified -> fail closed",
    must_cite=["src/lib/corpus.ts", "686", "699"],
    must_not_state=["synced is verified", "claims-match"],
    trap="The happy path is correct; only the swallowed-parse branch makes the status word a claim about an artifact nobody read.",
    provenance_label="verified-by-claude: code and UI string read from git at the pinned commit",
    source_citation="LEDGER F-022; PR #273",
)

# ---- F-026: phantom refs ----
add(
    fixture="RV-08",
    input={
        "ref": "posting report asserting comment IDs",
        "claims": [
            "a PR #282 \"resolution note\" at comment 6378671035",
            "a truncated Pass 25 note on #235 at comment 6378697801",
            "the full Pass 25 note now stands on #235 across comments 6378697801 + 6378832841",
        ],
        "resolver_table": {
            "PR #282 comments (complete list)": ["6378772441"],
            "#235 comments that exist among the cited IDs": ["6378832841"],
            "per-comment lookups": {"6378671035": "HTTP 404", "6378697801": "HTTP 404", "6378832841": "exists", "6378772441": "exists"},
        },
    },
    expected_verdict="reject:phantom-ref",
    rule="phantom-refs: every cited ref must resolve before the verdict ships; 6378671035 and 6378697801 return 404, so the report asserts two comments that do not exist (6378832841 does exist and must not be flagged)",
    must_cite=["6378671035", "6378697801"],
    must_not_state=["6378671035 exists", "6378697801 exists", "6378832841 is a phantom"],
    trap="The prose is plausible and partly true (6378832841 is real). Flagging all three, or none, is wrong.",
    provenance_label="PR #282's comment list: verified-by-claude via API (exactly one comment, 6378772441); the two 404s: LEDGER-reported (Pass 26), not re-looked-up by this lane",
    source_citation="LEDGER F-026",
)

# ---- Branch update as code change: positive control ----
d_348 = diff(MAIN_348, HEAD_348)
assert shortstat(MAIN_348, HEAD_348).startswith("2 files changed, 4 insertions(+), 4 deletions(-)")
add(
    fixture="RV-09",
    input={
        "pr": "#348",
        "base": MAIN_348,
        "head": HEAD_348,
        "head_is_merge_commit": True,
        "head_note": "Head 73fe3a1 is a web-UI 'Update branch' merge of main into the gated head ca0bd60; the gated diff was 2 files, +4/-4.",
        "claims": [
            "`deepseekArtifact.test.ts`: the 3 run-list mocks that still said `DeepSeek 16B` now say `Qwen/Qwen3-8B`, the workflow's real `name`/`run-name`.",
            "`deepseekContext.ts:26`: the prompt now says the workflow is named `Qwen/Qwen3-8B` and that only the provider id and model id are legacy.",
            "Strings only; no logic change.",
        ],
        "diff": d_348,
    },
    expected_verdict="claims-match",
    rule="branch-update-is-a-code-change: the diff is read against current main at the merge head; here it is still exactly the gated 2-file +4/-4 strings-only diff, zero lost lines",
    must_cite=["src/lib/ai/deepseekContext.ts", "src/lib/deepseekArtifact.test.ts"],
    must_not_state=["lost lines", "logic change"],
    trap="The merge-commit head invites 'unreviewed changes' alarm. The correct move is to re-read the diff against main and find it unchanged.",
    provenance_label="verified-by-claude: diff read from git at the merge head; claims quoted from the PR body",
    source_citation="PR #348 (merged); the standing rule (web-UI branch update = code change) is quoted in LEDGER F-025; AGENTS.md itself not read by this lane",
)

for f in fixtures:
    sys.stdout.write(json.dumps(f, ensure_ascii=False) + "\n")
