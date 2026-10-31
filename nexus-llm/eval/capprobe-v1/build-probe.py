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

# ── TEMPLATE VALIDITY GATE (v1.2): a probe template must be a structural instance of a TRAINING template of its intended family.
# Checked, not asserted: (a) the fixed frame occurs verbatim in the generator source; (b) every non-slot word occurs in the generator
# vocabulary. v1 and v1.1 image templates ("... the X headquarters at dawn" / "... the X storefront at dawn") FAIL this gate: the control
# (run 7) routed 0/60 of them (route:defer) although it routes the in-structure loop prompts. Entity-slot words were already gated above.
FRAMES = {"image": ("generate an image of", "a red {E} in the snow"), "kalshi": ("what are the kalshi odds on", "{E} beating earnings")}
gen_text = TRAIN.read_text().lower()
gen_vocab = set(re.findall(r"[a-z0-9_]+", gen_text))
validity = {}
for fam, (frame, tail) in FRAMES.items():
    frame_ok = frame in gen_text
    tail_words = [w for w in re.findall(r"[a-z]+", tail.replace("{E}", " ")) ]
    missing = [w for w in tail_words if w not in gen_vocab]
    validity[fam] = {"frame": frame, "frame_in_generator": frame_ok, "tail_words_missing_from_generator": missing, "pass": frame_ok and not missing}
assert all(v["pass"] for v in validity.values()), f"template validity gate failed: {validity}"
items = []
for i, e in enumerate(ENT):
    for form, name in (("cap", e), ("low", e.lower())):
        items.append({"id": f"{form}-img-{i:02d}", "form": form, "entity": name, "tool": "generate_image", "arg": "prompt", "prompt": f"Generate an image of a red {name} in the snow", "prefix": ""})
        items.append({"id": f"{form}-kal-{i:02d}", "form": form, "entity": name, "tool": "kalshi_markets", "arg": "query", "prompt": f"What are the Kalshi odds on {name} beating earnings?", "prefix": ""})
body = "\n".join(json.dumps(x) for x in items) + "\n"
(HERE / "probe.jsonl").write_text(body)
man = {"name": "capprobe", "version": "v1.2", "items": len(items), "entities": ENT, "sha256": hashlib.sha256(body.encode()).hexdigest(),
       "version_note": "v1.2 (2026-10-31, before any capfix result). v1 (sha 336c3b4f935e10e7) and v1.1 (9271fb403e381cc3, storefront) image templates were NOT structural instances of the training image template; the run-7 control routed 0/60 of each (route:defer) while routing the in-structure loop prompts. My first diagnosis (lexical collision with the head family) was incomplete. v1.2 image template = a structural instance of the training family (generate an image of a red {E} in the snow), enforced by the template validity gate. Kalshi template and all entities unchanged. Probe is FROZEN at v1.2: no further template changes; if an arm routes < 50% on a model, that arm is reported INCONCLUSIVE for that model.", "template_validity": validity,
       "design": "30 held-out entities x {Capitalized, lowercase} x {image prompt, Kalshi query}; paired so capitalization is isolated within one model",
       "gating": "NOT a gated frozen suite (no cases.jsonl/MANIFEST.json): used for the capfix pre-registered criterion only"}
(HERE / "PROBE-MANIFEST.json").write_text(json.dumps(man, indent=2) + "\n")
print(len(items), "items;", man["sha256"][:16])
