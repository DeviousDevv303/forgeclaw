#!/usr/bin/env python3
"""Assemble REVIEWER v1.1 (DRAFT; the freeze is the grading seat's): the nine frozen v1 rows, with the two repairs the seat accepted
(#235 6591250897), plus the five new rows from build-new-rows.py. v1 stays frozen and untouched: its rows are read from git at the
frozen commit, never from the working tree.

    python3 nexus-llm/eval/reviewer-v1.1/build-v1.1.py > nexus-llm/eval/reviewer-v1.1/reviewer-v1.1-fixtures.jsonl

Repairs applied (each asserted to apply exactly once, and afterwards every must_cite string must be in the row's input):
  RV-05 and RV-07: the full source path is carried in the row's `ref`, because the frozen must_cite asked for a path the input did not contain.
(The other accepted repair, replacing the frozen section 5.2 RV-02 clause with Amendment 2's per-row exact-kind rule, is in the protocol text, not in the rows.)
"""
import hashlib
import json
import os
import subprocess

root = subprocess.run(["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True).stdout.strip()
os.chdir(root)
FROZEN = "c8d6cc53bf18c94e85966b20e76f2c3e68568cb8"
FIXTURES_SHA = "5fb658b9b3077f6aa183b82a177dcd0d5c191291eb014eb94183b85280039ceb"
raw = subprocess.run(["git", "show", f"{FROZEN}:nexus-llm/eval/reviewer-v1/reviewer-fixtures.jsonl"], check=True, capture_output=True).stdout
assert hashlib.sha256(raw).hexdigest() == FIXTURES_SHA, "frozen v1 fixtures do not match the pinned hash"
rows = [json.loads(line) for line in raw.decode().split("\n") if line]
assert [r["fixture"] for r in rows] == [f"RV-0{i}" for i in range(1, 10)]

REF_REPAIRS = {
    "RV-05": ("board-scan no-match verdict (kalshiMarkets.ts)", "src/lib/kalshiMarkets.ts: board-scan no-match verdict"),
    "RV-07": ("CorpusRepository.syncPending status", "src/lib/corpus.ts: CorpusRepository.syncPending status"),
}
for r in rows:
    if r["fixture"] in REF_REPAIRS:
        old, new = REF_REPAIRS[r["fixture"]]
        assert r["input"]["ref"] == old, (r["fixture"], r["input"]["ref"])
        r["input"]["ref"] = new
        r["repair"] = "v1.1: full source path carried in input.ref so must_cite is satisfiable from the input (frozen v1 row unchanged)"

new_rows = [json.loads(line) for line in subprocess.run(["python3", "nexus-llm/eval/reviewer-v1.1/build-new-rows.py"], check=True, capture_output=True, text=True).stdout.split("\n") if line]
assert [r["fixture"] for r in new_rows] == ["RV-10", "RV-11", "RV-12", "RV-13", "RV-14"]
rows += new_rows

for r in rows:  # every must_cite string must be present in the input: the no-invented-evidence gate and the evidence requirement can both be met
    blob = json.dumps(r["input"], ensure_ascii=False)
    missing = [c for c in r["must_cite"] if c not in blob and c not in json.dumps(r["input"])]
    assert not missing, (r["fixture"], missing)
for r in rows:
    print(json.dumps(r, sort_keys=True, ensure_ascii=False))
