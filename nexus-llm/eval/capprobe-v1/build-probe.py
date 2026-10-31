"""Build the held-out capitalization copy probe (deterministic). Pairs of the SAME entity in Capitalized and lowercase form, in two
templates (image prompt, Kalshi query), so the capitalization effect is isolated WITHIN one model. Entities are asserted disjoint from
the training generator source and every frozen eval text, so a model cannot have seen them as copy targets.
  python nexus-llm/eval/capprobe-v1/build-probe.py   -> probe.jsonl + PROBE-MANIFEST.json
Deliberately NOT named cases.jsonl / MANIFEST.json: eval/frozen-prompts.ts and the gate treat any dir with those as a gated frozen suite."""
import hashlib, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
EVAL = HERE.parent
TRAIN = EVAL.parent / "train" / "gen-synthetic-traces.ts"
CANDIDATES = ["Samsung", "Boeing", "Pfizer", "Disney", "Cisco", "Oracle", "Honda", "Siemens", "Netflix", "Walmart", "Starbucks", "Nike",
              "Adidas", "Sony", "Nintendo", "Ferrari", "Porsche", "Lufthansa", "Maersk", "Nokia", "Ericsson", "Unilever", "Danone",
              "Heineken", "Chevron", "Exxon", "Caterpillar", "Deere", "Whirlpool", "Hershey", "Philips", "Panasonic"]
blob = (TRAIN.read_text() + "\n" + "\n".join(p.read_text() for p in [EVAL / "v1" / "cases.jsonl", EVAL / "domains-v1" / "cases.jsonl", EVAL / "loop" / "scenarios.json"])).lower()
words = set(re.findall(r"[a-z0-9_]+", blob))
ENT = [e for e in CANDIDATES if e.lower() not in words and e.lower() not in blob][:30]
assert len(ENT) == 30, f"only {len(ENT)} entities are disjoint from training/eval text: {ENT}"
items = []
for i, e in enumerate(ENT):
    for form, name in (("cap", e), ("low", e.lower())):
        items.append({"id": f"{form}-img-{i:02d}", "form": form, "entity": name, "tool": "generate_image", "arg": "prompt", "prompt": f"Generate an image of the {name} headquarters at dawn", "prefix": ""})
        items.append({"id": f"{form}-kal-{i:02d}", "form": form, "entity": name, "tool": "kalshi_markets", "arg": "query", "prompt": f"What are the Kalshi odds on {name} beating earnings?", "prefix": ""})
body = "\n".join(json.dumps(x) for x in items) + "\n"
(HERE / "probe.jsonl").write_text(body)
man = {"name": "capprobe", "version": "v1", "items": len(items), "entities": ENT, "sha256": hashlib.sha256(body.encode()).hexdigest(),
       "design": "30 held-out entities x {Capitalized, lowercase} x {image prompt, Kalshi query}; paired so capitalization is isolated within one model",
       "gating": "NOT a gated frozen suite (no cases.jsonl/MANIFEST.json): used for the capfix pre-registered criterion only"}
(HERE / "PROBE-MANIFEST.json").write_text(json.dumps(man, indent=2) + "\n")
print(len(items), "items;", man["sha256"][:16])
