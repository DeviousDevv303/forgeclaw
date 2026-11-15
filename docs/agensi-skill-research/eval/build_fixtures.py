#!/usr/bin/env python3
"""Strip @BUG/@DECOY markers from fixtures_src/ into a clean dir and write truth.json.

usage: build_fixtures.py <src_dir> <clean_out_dir> <truth_out.json>
Line numbers are preserved (markers are trailing comments), so truth lines match the clean files.
"""
import json, os, re, sys

MARK = re.compile(r"\s*(?:#|//)@(BUG|DECOY)\s+(\w+)\s*(.*)$")

def main(src, out, truth_path):
    os.makedirs(out, exist_ok=True)
    truth = {}
    for name in sorted(os.listdir(src)):
        bugs, decoys, clean = [], [], []
        with open(os.path.join(src, name), encoding="utf8") as fh:
            for n, line in enumerate(fh.read().split("\n"), 1):
                m = MARK.search(line)
                if m:
                    kind, ident, note = m.groups()
                    (bugs if kind == "BUG" else decoys).append({"id": ident, "line": n, "note": note.strip()})
                    line = line[: m.start()]
                clean.append(line.rstrip())
        with open(os.path.join(out, name), "w", encoding="utf8") as fh:
            fh.write("\n".join(clean))
        truth[name] = {"bugs": bugs, "decoys": decoys}
    with open(truth_path, "w", encoding="utf8") as fh:
        json.dump(truth, fh, indent=2)
    print(f"{len(truth)} fixtures, {sum(len(t['bugs']) for t in truth.values())} planted bugs, "
          f"{sum(len(t['decoys']) for t in truth.values())} decoys")

if __name__ == "__main__":
    main(*sys.argv[1:4])
