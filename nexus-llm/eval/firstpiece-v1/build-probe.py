"""First-piece-length probe (deterministic). Tests ONE post-hoc lead from the capfix result: do spans whose first tokenizer piece is a single
character lose their first character, independent of capitalization, piece count and word length?
Design: LOWERCASE entities only (capitalization removed as a variable). Stratum S = first piece is 1 character; stratum L = first piece is
3+ characters. Each S entity is matched to an L entity with the SAME number of pieces and a character length within +-1, so the only
systematic difference is the first piece. Entities are disjoint (word-boundary, case-insensitive) from the generator source, every frozen
eval/probe text, and the capfix training data. Template = the Kalshi template the capfix model routes 30/30.
  python nexus-llm/eval/firstpiece-v1/build-probe.py [path/to/capfix/data.jsonl]  -> probe.jsonl + PROBE-MANIFEST.json"""
import hashlib, json, pathlib, re, sys
import sentencepiece as spm

HERE = pathlib.Path(__file__).resolve().parent
NEX = HERE.parent.parent
EVAL = HERE.parent
sp = spm.SentencePieceProcessor(model_file=str(NEX / "tokenizer" / "nexus.model"))
CAND = """toyota tesla apple amazon google meta oracle intel adobe airbus boeing pfizer merck novartis roche sanofi bayer siemens bosch philips nokia
ericsson samsung hyundai kia honda nissan mazda subaru suzuki yamaha kawasaki ducati ferrari porsche audi volvo saab fiat renault peugeot citroen
lufthansa emirates qantas ryanair easyjet maersk fedex ups dhl walmart target costco kroger albertsons starbucks nike adidas puma reebok gucci prada
chanel hermes rolex omega swatch disney netflix spotify hulu paramount comcast verizon sprint vodafone orange telefonica unilever nestle danone mars
hershey cadbury kellogg heinz campbell pepsi cocacola fanta sprite budweiser heineken guinness carlsberg diageo chevron exxon shell conoco valero
caterpillar deere whirlpool maytag lenovo huawei xiaomi oppo tencent alibaba baidu foxconn tsmc micron nvidia qualcomm broadcom cisco juniper
palantir snowflake datadog twilio shopify square stripe paypal visa mastercard amex discover citibank barclays hsbc santander ubs goldman morgan
blackrock vanguard fidelity schwab robinhood coinbase kraken binance tether ripple solana cardano polkadot litecoin dogecoin chainlink uniswap
stormwatch harborlight copperfield bridgewater redwood silverstone northfield eastbrook westgate southport blackwell whitfield greenwood goldfinch
ironwood stonebridge riverbend lakeside hillcrest oakmont pinehurst cedarville maplewood elmhurst birchwood ashford thornton fairview brookfield
claremont kingsley queensbury princeton knightley marshall sheriff windermere thunderbay springfield summerfield winterhaven autumnridge
fieldstone rockwell sandstone limestone sunderland crossroads landmark waterford woodlands timberline hawthorne kensington wellington
bellingham chesterfield dartmouth ellington farrington garrison harrington islington jamestown kirkwood leighton middleton newcastle ormond
pemberton quincy radcliffe sheffield tennyson upton vanderbilt warrington yarmouth abernathy bannister carlisle davenport everett fletcher
gladstone hamilton ingram jefferson kendrick lancaster mortimer norwood osborne preston ramsey stanton trowbridge underwood valentine
whitaker thatcher brighton cromwell montgomery pennington sutherland
brazil canada denmark finland germany iceland ireland norway poland portugal romania sweden turkey ukraine uruguay vietnam zambia kenya ghana
nigeria morocco egypt tunisia algeria ethiopia tanzania uganda rwanda senegal austin boston denver dallas houston phoenix seattle portland atlanta
miami orlando tampa memphis nashville raleigh charlotte omaha tulsa reno boise fresno oakland sacramento anaheim pasadena tucson albany buffalo
rochester syracuse cleveland columbus dayton toledo akron madison milwaukee duluth fargo bismarck helena cheyenne laramie casper billings""".split()
EXCLUDED_SCOPE = ["../train/gen-synthetic-traces.ts", "v1/cases.jsonl", "domains-v1/cases.jsonl", "loop/scenarios.json", "capprobe-v1/probe.jsonl"]
blob = "\n".join((EVAL / p).read_text() for p in EXCLUDED_SCOPE).lower()
if len(sys.argv) > 1: blob += "\n" + pathlib.Path(sys.argv[1]).read_text().lower()
bag = set(re.findall(r"[a-z0-9_]+", blob))
rows = []
for w in dict.fromkeys(CAND):
    if w in bag or w in blob: continue
    pcs = [p.lstrip("▁") for p in sp.encode(w, out_type=str)]
    rows.append({"w": w, "n": len(pcs), "len": len(w), "first": len(pcs[0]), "pieces": pcs})
S = sorted([r for r in rows if r["first"] == 1], key=lambda r: r["w"])
L = sorted([r for r in rows if r["first"] >= 3], key=lambda r: r["w"])
pairs, used = [], set()
for s in S:
    best = [l for l in L if l["w"] not in used and l["n"] == s["n"] and abs(l["len"] - s["len"]) <= 1]
    if best:
        l = min(best, key=lambda r: (abs(r["len"] - s["len"]), r["w"])); used.add(l["w"]); pairs.append((s, l))
pairs = pairs[:40]
assert len(pairs) >= 30, f"only {len(pairs)} matched pairs available (S={len(S)}, L={len(L)})"
items = []
for k, (s, l) in enumerate(pairs):
    for stratum, r in (("S", s), ("L", l)):
        items.append({"id": f"{stratum}-{k:02d}", "stratum": stratum, "entity": r["w"], "n_pieces": r["n"], "length": r["len"], "first_piece_len": r["first"], "pieces": r["pieces"],
                      "tool": "kalshi_markets", "arg": "query", "prompt": f"What are the Kalshi odds on {r['w']} beating earnings?", "prefix": ""})
body = "\n".join(json.dumps(x) for x in items) + "\n"
(HERE / "probe.jsonl").write_text(body)
import statistics as st
man = {"name": "firstpiece", "version": "v1", "pairs": len(pairs), "items": len(items), "sha256": hashlib.sha256(body.encode()).hexdigest(),
       "balance": {"mean_pieces_S": st.mean(s["n"] for s, _ in pairs), "mean_pieces_L": st.mean(l["n"] for _, l in pairs),
                   "mean_len_S": round(st.mean(s["len"] for s, _ in pairs), 2), "mean_len_L": round(st.mean(l["len"] for _, l in pairs), 2)},
       "entities_S": [s["w"] for s, _ in pairs], "entities_L": [l["w"] for _, l in pairs],
       "gating": "NOT a gated frozen suite (no cases.jsonl/MANIFEST.json); used only for its own pre-registered criterion"}
(HERE / "PROBE-MANIFEST.json").write_text(json.dumps(man, indent=2) + "\n")
print(len(pairs), "pairs;", man["sha256"][:16], man["balance"])
