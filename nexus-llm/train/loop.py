"""Closed loop: the model drives real tool flows. It decodes (constrained), and every call it makes is executed by
eval/loop/sidecar-cli.ts (the app's own ledger/market/owner-price code, propose-only; image dispatches recorded, not sent); the result
is injected as the runtime would, and decoding continues until the final answer (at most --max-calls calls).
    python nexus-llm/train/loop.py --ckpt <model.pt> --out <transcripts.jsonl> [--dispatch-log <file>]
Then: npx vite-node nexus-llm/eval/loop/score-loop-cli.ts <transcripts.jsonl>"""
import argparse
import json
import pathlib
import subprocess

import torch

from common import BOS, SP, frame
from constrain import ConstrainedDecoder
from model import Config, NexusLM

ROOT = pathlib.Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--dispatch-log"); ap.add_argument("--max-calls", type=int, default=3)
a = ap.parse_args()
ck = torch.load(a.ckpt, map_location="cpu")
model = NexusLM(Config(**ck["cfg"])); model.load_state_dict(ck["state"]); model.eval()
dec = ConstrainedDecoder(SP)
scen = json.loads((ROOT / "nexus-llm/eval/loop/scenarios.json").read_text())["scenarios"]
cmd = ["npx", "vite-node", "nexus-llm/eval/loop/sidecar-cli.ts"] + (["--dispatch-log", a.dispatch_log] if a.dispatch_log else [])
side = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)


@torch.no_grad()
def step(ids):
    return model(torch.tensor([ids[-model.c.ctx:]]))[0, -1]


def tool(session, name, args):
    side.stdin.write(json.dumps({"session": session, "name": name, "arguments": args}) + "\n"); side.stdin.flush()
    return json.loads(side.stdout.readline())


with open(a.out, "w") as f:
    for s in scen:
        transcript, calls = "", []
        base = [BOS] + SP.encode(frame(s["prompt"]))
        for _ in range(a.max_calls + 1):
            gen = SP.decode(dec.generate(step, base + SP.encode(transcript), transcript, max_new=200))
            transcript += gen
            if not transcript.endswith("<|/call|>") or len(calls) >= a.max_calls:
                break
            call = json.loads(transcript.rsplit("<|call|>", 1)[1][: -len("<|/call|>")])
            r = tool(s["id"], call["name"], call["arguments"])
            calls.append({"name": call["name"], "arguments": call["arguments"], "status": r["status"]})
            transcript += f"<|result:{r['status']}|>{r['text']}<|/result|>"
        f.write(json.dumps({"id": s["id"], "transcript": transcript, "calls": calls}) + "\n")
        print(s["id"], [c["name"] for c in calls], flush=True)
side.stdin.close(); side.wait()
print("wrote", a.out)
