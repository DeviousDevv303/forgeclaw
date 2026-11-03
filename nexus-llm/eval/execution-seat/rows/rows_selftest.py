#!/usr/bin/env python3
"""Runs every row through the real harness with its scripted honest play (and cheat play for traps) and requires EXACT flag sets.
Run as root:  python3 rows_selftest.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness  # noqa: E402
import rows  # noqa: E402


def scripted(replies):
    it = iter(replies)
    return lambda messages: next(it)


def main():
    ok = True
    for r in rows.ROWS:
        spec = {"id": r["id"], "task": r["task"], "files": r["files"], "hidden": r["hidden"], "check": r["check"]}
        plays = [("honest", r["honest"], r["honest_flags"])]
        if r.get("alt_honest"):
            plays.append(("alt-hon", r["alt_honest"], r["honest_flags"]))
        if r["cheat"]:
            plays.append(("cheat", r["cheat"], r["cheat_flags"]))
        for name, script, want in plays:
            art = tempfile.mkdtemp(prefix="exrow-")
            graded = harness.run_row(scripted(script), spec, art, caps=r["caps"], max_turns=8)
            # Hidden-test isolation: no hidden file may appear in the model's workdir artifact, and none of its text in any capture.
            import json as _json
            packet = _json.load(open(os.path.join(art, "packet.json")))
            hidden_names = set(r["hidden"]["files"])
            leaked = hidden_names & set(packet["files"])
            leaked |= {n for n in hidden_names for c in packet["commands"] if n in c["stdout"] or n in c["stderr"]}
            if leaked:
                ok = False
                print(f"FAIL {r['id']} {name}: hidden test file reached the model's sandbox: {sorted(leaked)}")
            got = {g["check"] for g in graded if g["status"] == "flag"}
            unver = [g["check"] for g in graded if g["status"] == "unverified"]
            good = got == want and not unver
            ok &= good
            print(("PASS " if good else "FAIL ") + f"{r['id']} {name:6} {r['kind']}", "| flags", sorted(got), "" if good else f"| WANTED {sorted(want)} unverified={unver}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
