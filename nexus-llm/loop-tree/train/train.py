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

from common import COPY_LOSS_WEIGHT, SP, encode_row_w, read_jsonl
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
ap.add_argument("--init", help="warm start from this checkpoint (same preset); recorded in train-log.json")
ap.add_argument("--save-every", type=int, default=500, help="write <out>/resume.pt (model, optimizer, step) every N steps")
ap.add_argument("--resume", action="store_true", help="continue from <out>/resume.pt (a run cut short, e.g. by a container restart)")
ap.add_argument("--stop-after", type=int, help=argparse.SUPPRESS)  # tests only: exit after this many steps, as a crash would
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
# Rows may carry run-8 fields (mode, copySpans); legacy rows encode exactly as before (no mode token, weights = mask).
enc = [encode_row_w(r["prompt"], r["text"], r.get("mode"), r.get("copySpans") or ()) for r in rows]
enc = [(i, m, w) for i, m, w in enc if len(i) <= cfg.ctx]
n_copy_rows = sum(1 for r in rows if r.get("mode") == "copy")
print(f"preset {a.preset}: {len(enc)} rows (of {len(rows)}), max len {max(len(i) for i, _, _ in enc)}, vocab {cfg.vocab_size}, copy rows {n_copy_rows}, copy loss weight {COPY_LOSS_WEIGHT}")
model = NexusLM(cfg)
if a.init:
    ck = torch.load(a.init, map_location="cpu")
    if ck["cfg"] != cfg.__dict__:
        raise SystemExit(f"refusing --init: checkpoint config {ck['cfg']} differs from preset {a.preset} {cfg.__dict__}")
    model.load_state_dict(ck["state"])
    print(f"warm start from {a.init}")
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
    t = max(len(i) for i, _, _ in b)
    x = torch.zeros(len(b), t, dtype=torch.long); y = torch.full((len(b), t), -100, dtype=torch.long)
    w = torch.zeros(len(b), t, dtype=torch.float)
    for k, (ids, mask, wts) in enumerate(b):
        x[k, :len(ids)] = torch.tensor(ids)
        tgt = torch.tensor([tok if m else -100 for tok, m in zip(ids, mask)])
        y[k, :len(ids) - 1] = tgt[1:]
        w[k, :len(ids) - 1] = torch.tensor(wts[1:], dtype=torch.float)
    return x, y, w

t0 = time.time(); log = []; start = 0
resume_path = out / "resume.pt"
if a.resume:
    if not resume_path.exists():
        raise SystemExit(f"--resume: no {resume_path}")
    r = torch.load(resume_path, map_location="cpu")
    if r["cfg"] != cfg.__dict__ or r["steps"] != a.steps:
        raise SystemExit("--resume: the saved run used a different preset or step count")
    model.load_state_dict(r["state"]); opt.load_state_dict(r["opt"]); start, log = r["step"] + 1, r["log"]
    random.setstate(r["py_rng"]); torch.set_rng_state(r["torch_rng"])
    print(f"resumed at step {start}")
for step in range(start, a.steps):
    for g in opt.param_groups: g["lr"] = sched(step)
    model.train(); x, y, w = batch()
    loss = model.loss(x, y, w)
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
    if step % 50 == 0 or step == a.steps - 1:
        log.append({"step": step, "loss": round(float(loss.detach()), 4), "sec": round(time.time() - t0, 1)}); print(log[-1], flush=True)
    if a.save_every and (step + 1) % a.save_every == 0 and step + 1 < a.steps:
        tmp = out / "resume.pt.tmp"
        torch.save({"cfg": cfg.__dict__, "steps": a.steps, "step": step, "state": model.state_dict(), "opt": opt.state_dict(), "log": log,
                    "py_rng": random.getstate(), "torch_rng": torch.get_rng_state()}, tmp)
        tmp.replace(resume_path)  # atomic: a restart mid-write never leaves a broken resume file
    if a.stop_after is not None and step + 1 >= a.stop_after:
        raise SystemExit(3)
torch.save({"cfg": cfg.__dict__, "state": model.state_dict()}, out / "model.pt")
(out / "train-log.json").write_text(json.dumps({"preset": a.preset, "params": model.n_params(), "steps": a.steps, "synthetic_only": not a.allow_real, "data": str(a.data), "init": a.init, "copy_loss_weight": COPY_LOSS_WEIGHT, "copy_rows": n_copy_rows, "log": log}, indent=2))
if resume_path.exists():
    resume_path.unlink()
print("saved", out / "model.pt")
