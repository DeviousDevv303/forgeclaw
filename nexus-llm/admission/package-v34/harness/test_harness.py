#!/usr/bin/env python3
"""
test_harness.py — v3 harness for run36-admission-checks.py

Discipline: a probe that fails for the wrong reason proves nothing. Every FAIL
test asserts (a) the exit code, (b) the specific check id that failed, and
(c) that no unrelated check produced the failure. Mutations that target a
downstream check re-pin the rows sha256 in the manifest so C2 stays green and
attribution stays clean; corruption tests deliberately leave the stale hash.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
RUNNER = PKG / "run36-admission-checks.py"
FIXTURES = PKG / "fixtures"

RESULTS = []


def stage():
    d = Path(tempfile.mkdtemp(prefix="r36-harness-"))
    for f in FIXTURES.iterdir():
        shutil.copy2(f, d / f.name)
    return d


def run(d):
    proc = subprocess.run(
        [sys.executable, str(RUNNER),
         "--rows", str(d / "rows_fixture.jsonl"),
         "--manifest", str(d / "manifest_fixture.json"),
         "--report", str(d / "report.json")],
        capture_output=True, text=True)
    report = json.loads((d / "report.json").read_text()) if (d / "report.json").exists() else None
    return proc.returncode, report, proc.stdout


def repin_rows(d):
    import hashlib
    m = json.loads((d / "manifest_fixture.json").read_text())
    m["rows"]["sha256"] = hashlib.sha256((d / "rows_fixture.jsonl").read_bytes()).hexdigest()
    (d / "manifest_fixture.json").write_text(json.dumps(m, indent=2) + "\n")


def mutate_rows(d, fn):
    rows = [json.loads(l) for l in (d / "rows_fixture.jsonl").read_text().splitlines() if l.strip()]
    fn(rows)
    (d / "rows_fixture.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")


def mutate_manifest(d, fn):
    m = json.loads((d / "manifest_fixture.json").read_text())
    fn(m)
    (d / "manifest_fixture.json").write_text(json.dumps(m, indent=2) + "\n")


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def verdict(report, cid):
    return report["checks"][cid]["verdict"] if report else "NO_REPORT"


# T1: valid fixture -> exit 2, mechanical checks PASS, C7/C8/C10 BLOCKED, never ADMIT
d = stage(); rc, rep, out = run(d)
check("T1 valid fixture: exit 2, C1-C6+C9 PASS, C7/C8/C10 BLOCKED",
      rc == 2 and rep and all(verdict(rep, c) == "PASS" for c in ("C1", "C2", "C3", "C4", "C5", "C6", "C9"))
      and all(verdict(rep, c) == "BLOCKED" for c in ("C7", "C8", "C10"))
      and "ADMIT" not in out.replace("ADMISSION", "").replace("ADMIT", "", 0) and rep["admission"] == "NOT_GRANTED")

# T2: corrupted rows file (content flip, stale manifest hash) -> C2 FAIL, right reason
d = stage()
p = d / "rows_fixture.jsonl"; p.write_text(p.read_text().replace("Distance", "Xistance", 1))
rc, rep, _ = run(d)
check("T2 corrupt rows file -> C2 FAIL", rc == 1 and verdict(rep, "C2") == "FAIL"
      and verdict(rep, "C4") == "PASS", "rows still well-formed; only integrity fails")

# T3: allowlist stripped from manifest -> C2 BLOCKED (never PASS), exit 2
d = stage(); mutate_manifest(d, lambda m: m.pop("allowlist"))
rc, rep, _ = run(d)
check("T3 allowlist absent -> C2 BLOCKED", rc == 2 and verdict(rep, "C2") == "BLOCKED")

# T4: tokenizer version lie -> C1 FAIL (implementation+version verified, not field presence)
d = stage(); mutate_manifest(d, lambda m: m["tokenizer"].update(version="0.0.0"))
rc, rep, _ = run(d)
check("T4 tokenizer version lie -> C1 FAIL", rc == 1 and verdict(rep, "C1") == "FAIL")
# T5: string "1" spawn on a positive row without justification -> C9 FAIL
# (normalization cannot evade the single-spawn rule)
d = stage()
def strip_flag(rows):
    for r in rows:
        if r["id"] == "r36-001":
            r["spawn_count"] = "1"
            assert "single_spawn_justified" not in r
mutate_rows(d, strip_flag); repin_rows(d)
rc, rep, _ = run(d)
check("T5 string-1 spawn unflagged -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL"
      and verdict(rep, "C4") == "PASS", "row schema valid; only spawn rule trips")

# T6: duplicate id -> C4 FAIL
d = stage()
def dupe(rows): rows[1]["id"] = rows[0]["id"]
mutate_rows(d, dupe); repin_rows(d)
rc, rep, _ = run(d)
check("T6 duplicate id -> C4 FAIL", rc == 1 and verdict(rep, "C4") == "FAIL")

# T7: malformed manifest (truncated JSON) -> C1 FAIL, downstream BLOCKED
d = stage()
p = d / "manifest_fixture.json"; p.write_text(p.read_text()[: len(p.read_text()) // 2])
rc, rep, _ = run(d)
check("T7 malformed manifest -> C1 FAIL, C2-C9 BLOCKED", rc == 1 and verdict(rep, "C1") == "FAIL"
      and all(verdict(rep, c) == "BLOCKED" for c in ("C2", "C3", "C4", "C5", "C6", "C9")))

# T8: 700-token row -> C3 FAIL @630 (right reason: schema/id/distinctness stay green)
d = stage()
def add_heavy(rows):
    rows.append({"id": "r36-900", "tier": "positive", "text": " a" * 700, "spawn_count": 2})
mutate_rows(d, add_heavy); repin_rows(d)
mutate_manifest(d, lambda m: m["tiers"].update({"r36-900": "positive"}))  # added rows must be classified (v3.3)
rc, rep, _ = run(d)
check("T8 700-token row -> C3 FAIL", rc == 1 and verdict(rep, "C3") == "FAIL"
      and verdict(rep, "C4") == "PASS" and "r36-900=700" in rep["checks"]["C3"]["detail"])

# T9a: exact-boundary 630-token row -> C3 PASS, run stays exit 2
d = stage()
def add_630(rows):
    rows.append({"id": "r36-630", "tier": "positive", "text": " a" * 630, "spawn_count": 2})
mutate_rows(d, add_630); repin_rows(d)
mutate_manifest(d, lambda m: m["tiers"].update({"r36-630": "positive"}))
rc, rep, _ = run(d)
check("T9a 630-token row (boundary) -> C3 PASS, exit 2", rc == 2 and verdict(rep, "C3") == "PASS")

# T9b: 631-token row -> C3 FAIL (one token over)
d = stage()
def add_631(rows):
    rows.append({"id": "r36-631", "tier": "positive", "text": " a" * 631, "spawn_count": 2})
mutate_rows(d, add_631); repin_rows(d)
mutate_manifest(d, lambda m: m["tiers"].update({"r36-631": "positive"}))
rc, rep, _ = run(d)
check("T9b 631-token row -> C3 FAIL", rc == 1 and verdict(rep, "C3") == "FAIL"
      and "r36-631=631" in rep["checks"]["C3"]["detail"])

# T10: manifest declares ceiling != 630 -> C3 FAIL (constant cannot be diluted)
d = stage(); mutate_manifest(d, lambda m: m.update(token_ceiling=640))
rc, rep, _ = run(d)
check("T10 declared ceiling 640 -> C3 FAIL (conflict with enforced 630)",
      rc == 1 and verdict(rep, "C3") == "FAIL")

# T11: unsupported tokenizer package -> C1 FAIL
d = stage(); mutate_manifest(d, lambda m: m["tokenizer"].update(package="no_such_pkg"))
rc, rep, _ = run(d)
check("T11 unsupported tokenizer package -> C1 FAIL", rc == 1 and verdict(rep, "C1") == "FAIL")

# T17: tiktoken loader path also verified — swap fixture to cl100k_base with its
# correct KAT -> C1 PASS, run stays exit 2 (both loader families exercised)
d = stage()
def to_tiktoken(m):
    m["tokenizer"] = {"name": "cl100k_base", "package": "tiktoken", "version": "0.14.0",
                      "kat": {"text": "ForgeClaw Run 36 admission checker: token counts are recomputed, never trusted.",
                              "expected_ids": [59537, 5176, 675, 6588, 220, 1927, 26360, 42015, 25,
                                               4037, 14921, 527, 38301, 19849, 11, 2646, 22542, 13]}}
mutate_manifest(d, to_tiktoken)
rc, rep, _ = run(d)
check("T17 tiktoken/cl100k loader path -> C1 PASS, exit 2", rc == 2 and verdict(rep, "C1") == "PASS"
      and "tiktoken" in rep["checks"]["C1"]["detail"])

# T18: corrupted tokenizer model bytes -> C1 FAIL (pinned-file hash mismatch)
d = stage()
p = d / "nexus.model"; b = bytearray(p.read_bytes()); b[100] ^= 0xFF; p.write_bytes(bytes(b))
rc, rep, _ = run(d)
check("T18 corrupted tokenizer model file -> C1 FAIL", rc == 1 and verdict(rep, "C1") == "FAIL"
      and "hash mismatch" in rep["checks"]["C1"]["detail"])

# T13: restraint-tier row permitting a spawn -> C9 FAIL (frozen zero-spawn boundary)
d = stage()
def restraint_spawn(rows):
    for r in rows:
        if r["id"] == "r36-009":
            r["spawn_count"] = 1
            r["single_spawn_justified"] = True   # justification must NOT rescue a restraint row
mutate_rows(d, restraint_spawn); repin_rows(d)
rc, rep, _ = run(d)
check("T13 restraint row spawning -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL"
      and "restraint" in rep["checks"]["C9"]["detail"])

# T14: restraint row with {min:0,max:0} range form -> C9 PASS, run stays exit 2
d = stage()
def restraint_range_ok(rows):
    for r in rows:
        if r["id"] == "r36-009":
            r["spawn_count"] = {"min": 0, "max": 0}
mutate_rows(d, restraint_range_ok); repin_rows(d)
rc, rep, _ = run(d)
check("T14 restraint {0,0} range -> C9 PASS, exit 2", rc == 2 and verdict(rep, "C9") == "PASS")

# T15: restraint row with {min:1,max:2} range -> C9 FAIL (range permits spawn)
d = stage()
def restraint_range_bad(rows):
    for r in rows:
        if r["id"] == "r36-009":
            r["spawn_count"] = {"min": 1, "max": 2}
mutate_rows(d, restraint_range_bad); repin_rows(d)
rc, rep, _ = run(d)
check("T15 restraint {1,2} range -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL")

# T16: determinism — two clean runs produce byte-identical reports (this machine only;
# cross-environment determinism is an independent-lane verification, not claimed here)
d1, d2 = stage(), stage()
_, _, _ = run(d1); _, _, _ = run(d2)
check("T16 determinism: identical report bytes across runs",
      (d1 / "report.json").read_bytes() == (d2 / "report.json").read_bytes())

# --- GPT's C9 rejection table (batch-178 consolidated adjudication) ---

# T19: restraint-classified row with range {min:0, max:1} -> C9 FAIL (cap must be 0)
d = stage()
def r_01(rows):
    for r in rows:
        if r["id"] == "r36-009":
            r["spawn_count"] = {"min": 0, "max": 1}
mutate_rows(d, r_01); repin_rows(d)
rc, rep, _ = run(d)
check("T19 restraint {0,1} -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL"
      and "r36-009" in rep["checks"]["C9"]["detail"])

# T20: multi-spawn (positive-classified) row with spawn_count 0 -> C9 FAIL
d = stage()
def pos_zero(rows):
    for r in rows:
        if r["id"] == "r36-001":
            r["spawn_count"] = 0
mutate_rows(d, pos_zero); repin_rows(d)
rc, rep, _ = run(d)
check("T20 multi-spawn row at 0 -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL"
      and "zero" in rep["checks"]["C9"]["detail"])

# T21: negative count, both classes -> C9 FAIL
d = stage()
def negs(rows):
    for r in rows:
        if r["id"] == "r36-001":
            r["spawn_count"] = -1
        if r["id"] == "r36-009":
            r["spawn_count"] = {"min": -2, "max": 0}
mutate_rows(d, negs); repin_rows(d)
rc, rep, _ = run(d)
check("T21 negative counts (both classes) -> C9 FAIL", rc == 1 and verdict(rep, "C9") == "FAIL"
      and "r36-001" in rep["checks"]["C9"]["detail"] and "r36-009" in rep["checks"]["C9"]["detail"])

# T22: self-mislabeled tier (row declares 'positive', manifest says restraint)
#      -> C4 FAIL (conflict) and C9 BLOCKED (refuses untrusted classification)
d = stage()
def mislabel(rows):
    for r in rows:
        if r["id"] == "r36-009":
            r["tier"] = "positive"
mutate_rows(d, mislabel); repin_rows(d)
rc, rep, _ = run(d)
check("T22 self-mislabeled tier -> C4 FAIL, C9 BLOCKED", rc == 1
      and verdict(rep, "C4") == "FAIL" and "conflicts" in rep["checks"]["C4"]["detail"]
      and verdict(rep, "C9") == "BLOCKED")

# T23: unclassified row (id missing from manifest.tiers) -> C4 FAIL closed, C9 BLOCKED
d = stage()
mutate_manifest(d, lambda m: m["tiers"].pop("r36-015"))
rc, rep, _ = run(d)
check("T23 unclassified row -> C4 FAIL closed", rc == 1 and verdict(rep, "C4") == "FAIL"
      and "no manifest classification" in rep["checks"]["C4"]["detail"]
      and verdict(rep, "C9") == "BLOCKED")

# T24: stale classification (manifest.tiers has an id not in the rows) -> C4 FAIL closed
d = stage()
mutate_manifest(d, lambda m: m["tiers"].update({"r36-999": "positive"}))
rc, rep, _ = run(d)
check("T24 stale classification -> C4 FAIL closed", rc == 1 and verdict(rep, "C4") == "FAIL"
      and "not in the rows file" in rep["checks"]["C4"]["detail"])

# T25: row WITHOUT a self-declared tier still passes — manifest alone governs
d = stage()
def strip_tiers(rows):
    for r in rows:
        r.pop("tier", None)
mutate_rows(d, strip_tiers); repin_rows(d)
rc, rep, _ = run(d)
check("T25 rows with no tier field -> all PASS, exit 2 (manifest-only authority)",
      rc == 2 and verdict(rep, "C9") == "PASS" and verdict(rep, "C6") == "PASS")

# --- v3.4: external count-KAT provenance + manifest seal (Claude verdicts /
#     Muse amendment, comment 7230645402) ---

# T26: the fixture manifest's external count-KAT must equal Muse's posted golden
# set verbatim (#235 comment 7230606565). The anchor lives HERE, in the harness —
# outside both the runner and the manifest under test.
d = stage()
MUSE_GOLDENS = {"KAT-1": 0, "KAT-2": 4, "KAT-3": 20, "KAT-4": 16,
                "KAT-5": 27, "KAT-6": 45, "KAT-7": 54}
m = json.loads((d / "manifest_fixture.json").read_text())
got = {c["id"]: c["tokens"] for c in m["tokenizer"]["kat_counts"]["cases"]}
check("T26 manifest kat_counts == Muse's posted goldens (7/7)", got == MUSE_GOLDENS)

# T27: surface honesty — an unsealed (fixture/development) run must DECLARE it
d = stage(); rc, rep, _ = run(d)
check("T27 fixture run declares manifest UNSEALED", rc == 2
      and "UNSEALED" in rep.get("manifest_seal", "")
      and "UNSEALED" in rep["checks"]["C1"]["detail"])

# T28: seal mechanism live-fire — a sealed runner accepts exactly the pinned
# manifest bytes (PASS, report says SEALED); any other bytes FAIL C1 (seal
# mismatch), never a silent pass
import hashlib
d = stage()
mhash = hashlib.sha256((d / "manifest_fixture.json").read_bytes()).hexdigest()
src = RUNNER.read_text()
sealed = d / "runner_sealed.py"
sealed.write_text(src.replace("SEALED_MANIFEST_SHA256 = None",
                              f'SEALED_MANIFEST_SHA256 = "{mhash}"', 1))
p1 = subprocess.run([sys.executable, str(sealed),
                     "--rows", str(d / "rows_fixture.jsonl"),
                     "--manifest", str(d / "manifest_fixture.json"),
                     "--report", str(d / "report_sealed.json")],
                    capture_output=True, text=True)
rep_s = json.loads((d / "report_sealed.json").read_text())
ok_sealed = (p1.returncode == 2 and rep_s["checks"]["C1"]["verdict"] == "PASS"
             and "SEALED" in rep_s["manifest_seal"])
bad = d / "runner_badseal.py"
bad.write_text(src.replace("SEALED_MANIFEST_SHA256 = None",
                           'SEALED_MANIFEST_SHA256 = "' + "0" * 64 + '"', 1))
p2 = subprocess.run([sys.executable, str(bad),
                     "--rows", str(d / "rows_fixture.jsonl"),
                     "--manifest", str(d / "manifest_fixture.json"),
                     "--report", str(d / "report_badseal.json")],
                    capture_output=True, text=True)
rep_b = json.loads((d / "report_badseal.json").read_text())
ok_bad = (p2.returncode == 1 and rep_b["checks"]["C1"]["verdict"] == "FAIL"
          and "seal mismatch" in rep_b["checks"]["C1"]["detail"])
check("T28 manifest seal: pinned bytes PASS+SEALED; wrong pin FAILs C1",
      ok_sealed and ok_bad,
      f"sealed_run rc={p1.returncode}, bad_pin rc={p2.returncode}")

# T29: pilot rows WILL carry the justification flag — prove the schema path:
# string "1" + single_spawn_justified: true on a positive row -> C4 PASS, C9 PASS
d = stage()
def justified(rows):
    for r in rows:
        if r["id"] == "r36-001":
            r["spawn_count"] = "1"
            r["single_spawn_justified"] = True
mutate_rows(d, justified); repin_rows(d)
rc, rep, _ = run(d)
check("T29 justified single spawn -> C4 PASS, C9 PASS, exit 2",
      rc == 2 and verdict(rep, "C4") == "PASS" and verdict(rep, "C9") == "PASS")

shutil.rmtree(d, ignore_errors=True)
failed = [n for n, ok, _ in RESULTS if not ok]
print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} harness tests passed"
      + (f" — FAILED: {failed}" if failed else ""))
sys.exit(1 if failed else 0)
