#!/usr/bin/env python3
"""Deterministic scorer. No model is involved.

usage: score.py <truth.json> <results_root>
results_root/<arm>/<fixture_name>.json  = {"findings":[{file,line,severity,category,description,fix,scenario?}]}

Definitions (identical for every arm):
  assertive finding : severity in {critical, warning}
  TP bug            : a planted bug with >=1 finding (any severity) within +-2 lines
  recall            : TP bugs / planted bugs
  decoy alarm       : an assertive finding within +-1 line of a decoy line (a documented false positive)
  clean-file alarm  : any assertive finding in a fixture with zero planted bugs
  unmatched assertive: assertive finding that matches no bug (includes decoy alarms; audit by hand)
  precision         : assertive findings matching a bug / all assertive findings
  missing/invalid   : a fixture with no parseable result counts as zero recall (never skipped)
"""
import json, os, sys
BUG_TOL, DECOY_TOL = 2, 1
ASSERTIVE = {"critical", "warning"}

def load(path):
    try:
        with open(path, encoding="utf8") as fh:
            d = json.load(fh)
        fs = d["findings"] if isinstance(d, dict) else d
        out = []
        for f in fs:
            out.append({"line": int(f["line"]), "severity": str(f.get("severity", "")).lower()})
        return out
    except Exception:
        return None

def main(truth_path, root):
    truth = json.load(open(truth_path, encoding="utf8"))
    report = {}
    for arm in sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))):
        tot = dict(bugs=0, tp=0, assertive=0, assertive_tp=0, decoy_alarms=0, clean_alarms=0, unmatched=0, invalid=0)
        per = {}
        for fx, t in truth.items():
            fs = load(os.path.join(root, arm, fx + ".json"))
            if fs is None:
                tot["invalid"] += 1; tot["bugs"] += len(t["bugs"]); per[fx] = "INVALID/MISSING"; continue
            found = {b["id"] for b in t["bugs"] if any(abs(f["line"] - b["line"]) <= BUG_TOL for f in fs)}
            asr = [f for f in fs if f["severity"] in ASSERTIVE]
            a_tp = sum(1 for f in asr if any(abs(f["line"] - b["line"]) <= BUG_TOL for b in t["bugs"]))
            d_al = sum(1 for f in asr if any(abs(f["line"] - d["line"]) <= DECOY_TOL for d in t["decoys"]) and
                       not any(abs(f["line"] - b["line"]) <= BUG_TOL for b in t["bugs"]))
            clean_al = len(asr) if not t["bugs"] else 0
            tot["bugs"] += len(t["bugs"]); tot["tp"] += len(found); tot["assertive"] += len(asr)
            tot["assertive_tp"] += a_tp; tot["decoy_alarms"] += d_al; tot["clean_alarms"] += clean_al
            tot["unmatched"] += len(asr) - a_tp
            per[fx] = f"found {len(found)}/{len(t['bugs'])} bugs; assertive={len(asr)} tp={a_tp} decoy_alarms={d_al} clean_alarms={clean_al}"
        tot["recall"] = round(tot["tp"] / tot["bugs"], 3) if tot["bugs"] else None
        tot["precision"] = round(tot["assertive_tp"] / tot["assertive"], 3) if tot["assertive"] else None
        report[arm] = dict(totals=tot, per_fixture=per)
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main(*sys.argv[1:3])
