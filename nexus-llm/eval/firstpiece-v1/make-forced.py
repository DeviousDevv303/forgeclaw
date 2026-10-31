"""Build the forced-first-character variant of the first-piece probe (inference only), and merge predictions back.
  make-forced.py build  -> writes forced.jsonl (same 62 items; prefix = call opening + the entity's correct first character)
  make-forced.py merge <raw-preds> <out>  -> prepends the forced prefix to each raw continuation so score-probe.py can score it
Decode UNCONSTRAINED (constrained decoding rejects a mid-call prefix); the scorer's routing/copy rules are unchanged."""
import json, sys, pathlib
here = pathlib.Path(__file__).parent
PRE = '<|route:tool|><|call|>{"name":"kalshi_markets","arguments":{"query":"'
items = [json.loads(l) for l in open(here / "probe.jsonl")]
if sys.argv[1] == "build":
    with open(here / "forced.jsonl", "w") as f:
        for c in items:
            d = dict(c); d["prefix"] = PRE + c["entity"][0]; f.write(json.dumps(d) + "\n")
else:
    by = {c["id"]: c for c in items}
    with open(sys.argv[3], "w") as f:
        for l in open(sys.argv[2]):
            r = json.loads(l); r["output"] = PRE + by[r["id"]]["entity"][0] + r["output"]; f.write(json.dumps(r) + "\n")
