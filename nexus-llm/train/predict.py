"""Run a checkpoint over the frozen eval cases and write predictions for eval/score-cli.ts.
    python nexus-llm/train/predict.py --ckpt <dir>/model.pt --cases nexus-llm/eval/v1/cases.jsonl --out <preds.jsonl>
Stops after <|/call|> when the model starts a call (the runtime would inject the result) and at <|end|> otherwise."""
import argparse
import json

import torch

from common import CALL_CLOSE, END, SP, BOS, frame, read_jsonl
from model import Config, NexusLM

ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", required=True); ap.add_argument("--cases", required=True); ap.add_argument("--out", required=True)
a = ap.parse_args()
ck = torch.load(a.ckpt, map_location="cpu")
model = NexusLM(Config(**ck["cfg"])); model.load_state_dict(ck["state"]); model.eval()
with open(a.out, "w") as f:
    for c in read_jsonl(a.cases):
        ctx = [BOS] + SP.encode(frame(c["prompt"])) + SP.encode(c["prefix"])
        gen = model.greedy(ctx, {CALL_CLOSE, END}, max_new=160)
        f.write(json.dumps({"id": c["id"], "output": SP.decode(gen)}) + "\n")
print("wrote", a.out)
