"""Score predictions on the first-piece-length probe.  python score-probe.py <preds.jsonl> [--json]
Per stratum (S = single-character first piece, L = 3+ character first piece): routing to kalshi_markets, STRICT exact copy (the entity occurs in the
query argument, case-sensitive) and FIRST-CHAR ERROR (the entity minus its first character occurs, the entity does not). Wilson 95% intervals.
Criterion and reading table: nexus-llm/runs/diagnosis/firstpiece-preregistration-2026-10-31.md"""
import json, math, pathlib, re, sys
HERE = pathlib.Path(__file__).resolve().parent
items = {json.loads(l)["id"]: json.loads(l) for l in (HERE / "probe.jsonl").read_text().splitlines() if l.strip()}
preds = {}
for l in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if l.strip(): o = json.loads(l); preds[o["id"]] = o["output"]
def query_of(out):
    m = re.search(r"<\|call\|>(.*?)<\|/call\|>", out, re.S)
    if not m: return None, None
    try: c = json.loads(m.group(1))
    except Exception: return None, None
    a = c.get("arguments", {}) if isinstance(c, dict) else {}
    q = a.get("query") or a.get("ticker")
    return c.get("name"), q if isinstance(q, str) else None
def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))
res = {}
for st in ("S", "L"):
    sel = [i for i in items.values() if i["stratum"] == st]
    routed = exact = fce = 0
    for it in sel:
        name, q = query_of(preds.get(it["id"], ""))
        if name != "kalshi_markets": continue
        routed += 1
        e = it["entity"]
        if q is None: continue
        if e in q: exact += 1
        elif e[1:] in q: fce += 1
    n = len(sel)
    res[st] = {"n": n, "routed": routed, "exact": exact, "exact_rate": round(exact / n, 4), "exact_ci": [round(x, 3) for x in wilson(exact, n)], "first_char_error": fce, "fce_rate": round(fce / n, 4)}
res["exact_diff_L_minus_S_pts"] = round(100 * (res["L"]["exact_rate"] - res["S"]["exact_rate"]), 1)
res["fce_diff_S_minus_L_pts"] = round(100 * (res["S"]["fce_rate"] - res["L"]["fce_rate"]), 1)
res["interpretable"] = all(res[s]["routed"] / res[s]["n"] >= 0.5 for s in ("S", "L"))
if "--json" in sys.argv: print(json.dumps(res, indent=2))
else:
    for s in ("S", "L"):
        r = res[s]; print(f"{s}: n={r['n']} routed={r['routed']} exact={r['exact']} ({100*r['exact_rate']:.1f}%, CI {100*r['exact_ci'][0]:.0f}-{100*r['exact_ci'][1]:.0f}) first-char-error={r['first_char_error']} ({100*r['fce_rate']:.1f}%)")
    print(f"exact(L)-exact(S) = {res['exact_diff_L_minus_S_pts']} pts | fce(S)-fce(L) = {res['fce_diff_S_minus_L_pts']} pts | interpretable(routing>=50% each) = {res['interpretable']}")
