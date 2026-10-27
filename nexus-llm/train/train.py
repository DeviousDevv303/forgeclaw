"""NEXUS Intelligence step 4 prep: training loop. CPU/GPU agnostic.
    python nexus-llm/train/train.py --data <synthetic.jsonl> --out <dir OUTSIDE the repo> --preset smoke --steps 400
Refuses --data rows that are not marked synthetic:true unless --allow-real is given (real rows must come from the exporter and are operator data)."""
import argparse
import json
import math
import pathlib
import random
import time

import torch

from common import SP, encode_row, read_jsonl
from model import PRESETS, NexusLM

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--preset", default="smoke", choices=list(PRESETS))
ap.add_argument("--steps", type=int, default=400)
ap.add_argument("--batch", type=int, default=32)
ap.add_argument("--lr", type=float, default=3e-4)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--allow-real", action="store_true")
a = ap.parse_args()

rows = read_jsonl(a.data)
if not a.allow_real and not all(r.get("synthetic") is True for r in rows):
    raise SystemExit("refusing: --data contains rows not marked synthetic:true (real rows need --allow-real and operator authorization)")
out = pathlib.Path(a.out).resolve()
repo = pathlib.Path(__file__).resolve().parents[2]
if repo in out.parents or out == repo:
    raise SystemExit("refusing to write checkpoints inside the repo; pass --out outside it")
out.mkdir(parents=True, exist_ok=True)

random.seed(a.seed); torch.manual_seed(a.seed); torch.set_num_threads(max(1, torch.get_num_threads()))
cfg = PRESETS[a.preset]
cfg.vocab_size = SP.get_piece_size()
enc = [encode_row(r["prompt"], r["text"]) for r in rows]
enc = [(i, m) for i, m in enc if len(i) <= cfg.ctx]
print(f"preset {a.preset}: {len(enc)} rows (of {len(rows)}), max len {max(len(i) for i, _ in enc)}, vocab {cfg.vocab_size}")
model = NexusLM(cfg)
print(f"parameters: {model.n_params():,}")
opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01, betas=(0.9, 0.95))
sched = lambda s: a.lr * min(1.0, (s + 1) / 30) * (0.5 * (1 + math.cos(math.pi * s / a.steps)) * 0.9 + 0.1)

# Length buckets: a batch is drawn from rows of similar length, so it is not padded to the one long row it happens to hold
# (mean row ~100 tokens, max ~600: random batches were ~5x padding on CPU). Every row is still sampled uniformly at random.
by_len = sorted(range(len(enc)), key=lambda k: len(enc[k][0]))
buckets = [by_len[k:k + a.batch * 4] for k in range(0, len(by_len), a.batch * 4)]

def batch():
    pool = random.choices(buckets, weights=[len(x) for x in buckets])[0]
    b = [enc[k] for k in random.sample(pool, min(a.batch, len(pool)))]
    t = max(len(i) for i, _ in b)
    x = torch.zeros(len(b), t, dtype=torch.long); y = torch.full((len(b), t), -100, dtype=torch.long)
    for k, (ids, mask) in enumerate(b):
        x[k, :len(ids)] = torch.tensor(ids)
        tgt = torch.tensor([tok if m else -100 for tok, m in zip(ids, mask)])
        y[k, :len(ids) - 1] = tgt[1:]
    return x, y

t0 = time.time(); log = []
for step in range(a.steps):
    for g in opt.param_groups: g["lr"] = sched(step)
    model.train(); x, y = batch()
    loss = model.loss(x, y)
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
    if step % 50 == 0 or step == a.steps - 1:
        log.append({"step": step, "loss": round(float(loss.detach()), 4), "sec": round(time.time() - t0, 1)}); print(log[-1], flush=True)
torch.save({"cfg": cfg.__dict__, "state": model.state_dict()}, out / "model.pt")
(out / "train-log.json").write_text(json.dumps({"preset": a.preset, "params": model.n_params(), "steps": a.steps, "synthetic_only": not a.allow_real, "data": str(a.data), "log": log}, indent=2))
print("saved", out / "model.pt")
