"""Run a checkpoint over frozen eval cases and write predictions for eval/score-cli.ts.
    python nexus-llm/train/predict.py --ckpt <dir>/model.pt --cases nexus-llm/eval/v1/cases.jsonl --out <preds.jsonl> [--constrained]
Stops after <|/call|> when the model starts a call (the runtime would inject the result) and at <|end|> otherwise.
--constrained decodes through constrain.py: the output is well-formed by construction; tool choice and arguments stay learned."""
import argparse
import json

import torch

from common import CALL_CLOSE, END, SP, BOS, frame, read_jsonl
from constrain import ConstrainedDecoder
from model import Config, NexusLM

ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", required=True); ap.add_argument("--cases", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--constrained", action="store_true"); ap.add_argument("--max-new", type=int, default=160)
a = ap.parse_args()
ck = torch.load(a.ckpt, map_location="cpu")
model = NexusLM(Config(**ck["cfg"])); model.load_state_dict(ck["state"]); model.eval()
dec = ConstrainedDecoder(SP)


@torch.no_grad()
def step_logits(ids):
    return model.next_logprobs(ids)


def case_mode(c) -> str:
    """The harness presents the mode, as the dispatcher would: COPY when the case's task is carrying prompt
    material verbatim into a call (a tool case whose expected arguments appear in the prompt — the same rule
    the synthetic generator uses to label its rows), CREATE otherwise."""
    exp = c.get("expect") or {}
    if exp.get("route") == "tool":
        for v in (exp.get("args") or {}).values():
            if isinstance(v, str) and len(v) >= 4 and v in c["prompt"]:
                return "copy"
    return "create"


with open(a.out, "w") as f:
    for c in read_jsonl(a.cases):
        ctx = [BOS] + SP.encode(frame(c["prompt"], case_mode(c))) + SP.encode(c["prefix"])
        gen = dec.generate(step_logits, ctx, c["prefix"], max_new=a.max_new) if a.constrained else model.greedy(ctx, {CALL_CLOSE, END}, max_new=a.max_new)
        f.write(json.dumps({"id": c["id"], "output": SP.decode(gen)}) + "\n")
print("wrote", a.out)
