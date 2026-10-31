"""Score predictions on the capitalization probe.  python score-probe.py <preds.jsonl> [--json]
STRICT copy = first call exists, its tool is the expected one, and the designated string argument contains the entity EXACTLY (case-sensitive).
Also reports routing (right tool) and conditional copy (copy rate among correctly routed items) so a routing miss is never read as a copy miss.
Wilson 95% intervals are printed because n=60 per arm cannot resolve small differences."""
import json, math, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
items = {json.loads(l)["id"]: json.loads(l) for l in (HERE / "probe.jsonl").read_text().splitlines() if l.strip()}
preds = {}
for l in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if l.strip():
        o = json.loads(l); preds[o["id"]] = o["output"]

def first_call(out):
    m = re.search(r"<\|call\|>(.*?)<\|/call\|>", out, re.S)
    if not m: return None
    try: return json.loads(m.group(1))
    except Exception: return None

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))

res = {}
for form in ("cap", "low"):
    for tool in (None, "generate_image", "kalshi_markets"):
        sel = [i for i in items.values() if i["form"] == form and (tool is None or i["tool"] == tool)]
        routed = strict = 0
        for it in sel:
            call = first_call(preds.get(it["id"], ""))
            ok_tool = bool(call) and call.get("name") == it["tool"]
            routed += ok_tool
            val = (call or {}).get("arguments", {}).get(it["arg"]) if ok_tool else None
            if it["tool"] == "kalshi_markets" and ok_tool and not isinstance(val, str):
                val = (call["arguments"].get("query") or call["arguments"].get("ticker"))
            strict += bool(ok_tool and isinstance(val, str) and it["entity"] in val)
        n = len(sel)
        res[f"{form}/{tool or 'all'}"] = {"n": n, "routed": routed, "strict": strict, "strict_rate": round(strict / n, 4), "strict_ci": [round(x, 3) for x in wilson(strict, n)],
                                           "cond_rate": round(strict / routed, 4) if routed else None}
gap = res["low/all"]["strict_rate"] - res["cap/all"]["strict_rate"]
res["gap_low_minus_cap_pts"] = round(100 * gap, 1)
if "--json" in sys.argv: print(json.dumps(res, indent=2))
else:
    for k, v in res.items():
        if isinstance(v, dict): print(f"{k:16} n={v['n']:3} routed={v['routed']:3} strict={v['strict']:3} ({100*v['strict_rate']:.1f}%, 95% CI {100*v['strict_ci'][0]:.0f}-{100*v['strict_ci'][1]:.0f}) cond={v['cond_rate']}")
    print(f"gap (lowercase - capitalized) = {res['gap_low_minus_cap_pts']} pts")
