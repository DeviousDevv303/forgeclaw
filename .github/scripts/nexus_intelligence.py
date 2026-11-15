"""Nexus Intelligence workflow runner — one constrained-decoding segment of the Run 25 checkpoint.

Invoked by .github/workflows/nexus-intelligence.yml. Inputs arrive as environment variables:
  TASK     the prompt text (the app frames the conversation into it; see buildNexusTaskPayload)
  CONTEXT  the transcript prefix so far (prior <|call|> / <|result:..|> spans of this turn; '' on the first segment)
  MODE     'create' (default) or 'copy' — the harness-presented mode token, as in training

Generation is the graded path, unchanged from nexus-llm/train/predict.py --constrained and the
standalone server: frame = "User: {prompt}\n<|mode:X|>", ConstrainedDecoder over the checkpoint's
own code, stop after <|/call|> or at <|end|>, max_new 160.

Provider truth: the checkpoint is reassembled from the base64 parts committed under
.github/nexus-runtime/ and its sha256 is verified against the Run 25 checkpoint hash recorded
in run25/verdict.md. A mismatch fails the run — this workflow never serves a different model
under the Nexus Intelligence name. The .pt is served directly (no GGUF): the architecture's
copy head has no llama.cpp equivalent, and the packaged predict.py reproduces Run 25's frozen
predictions byte-for-byte.

Window honesty: the checkpoint window is 640 tokens total (cfg.ctx in the checkpoint). If the
framed input plus the 160-token generation reserve does not fit, the oldest prompt lines are
trimmed (the transcript prefix is trimmed last, at token level) and result_meta.txt reports
prompt_trimmed=true. Nothing is silently pretended to be in context.
"""
import base64
import hashlib
import os
import pathlib
import shutil
import sys
import time

EXPECTED_SHA256 = "c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6"
GITHUB_DIR = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_SRC = GITHUB_DIR / "nexus-runtime"
MAX_NEW = 160


def fail(message: str) -> "SystemExit":
    print(f"::error::{message}")
    # A failed run still publishes a result file so the app can name the failure instead of timing out.
    pathlib.Path("result.txt").write_text(f"[NEXUS RUN FAILED] {message}")
    pathlib.Path("result_meta.txt").write_text(
        "model=Nexus Intelligence (Run 25 checkpoint)\n"
        f"checkpoint_sha256={EXPECTED_SHA256}\n"
        "run_failed=true\n"
    )
    return SystemExit(1)


def main() -> int:
    started = time.time()
    task = os.environ.get("TASK", "")
    prefix = os.environ.get("CONTEXT", "")
    mode = os.environ.get("MODE", "create") or "create"
    if mode not in ("create", "copy"):
        raise fail(f"MODE must be 'create' or 'copy', got {mode!r}")
    if not task.strip():
        raise fail("TASK is empty")

    # ── Stage the runtime in the layout the graded code expects ─────────────
    # train/{model,common,constrain}.py read ../spec/*.json and ../tokenizer/nexus.model.
    work = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "nexus-runtime-work"
    if work.exists():
        shutil.rmtree(work)
    (work / "train").mkdir(parents=True)
    (work / "spec").mkdir()
    (work / "tokenizer").mkdir()
    for name in ("model.py", "common.py", "constrain.py"):
        shutil.copy(RUNTIME_SRC / "train" / name, work / "train" / name)
    for name in ("tools.snapshot.json", "special-tokens.json"):
        shutil.copy(RUNTIME_SRC / "spec" / name, work / "spec" / name)
    (work / "tokenizer" / "nexus.model").write_bytes(
        base64.b64decode((RUNTIME_SRC / "tokenizer" / "nexus.model.b64").read_text())
    )

    # ── Reassemble the checkpoint and verify it is the Run 25 checkpoint ────
    parts = sorted(RUNTIME_SRC.glob("model.pt.b64.part-*"))
    if not parts:
        raise fail("no checkpoint parts found under .github/nexus-runtime/")
    blob = base64.b64decode("".join(p.read_text() for p in parts))
    digest = hashlib.sha256(blob).hexdigest()
    if digest != EXPECTED_SHA256:
        raise fail(f"checkpoint sha256 mismatch: reassembled {digest}, expected {EXPECTED_SHA256}")
    (work / "model.pt").write_bytes(blob)
    print(f"checkpoint verified: sha256 {digest} ({len(blob)} bytes, {len(parts)} parts)")

    sys.path.insert(0, str(work / "train"))
    import torch
    from common import BOS, SP, frame
    from constrain import ConstrainedDecoder
    from model import Config, NexusLM

    ck = torch.load(work / "model.pt", map_location="cpu")
    cfg = Config(**ck["cfg"])
    model = NexusLM(cfg)
    model.load_state_dict(ck["state"])
    model.eval()
    dec = ConstrainedDecoder(SP)
    ctx_limit = int(ck["cfg"]["ctx"])
    print(f"checkpoint cfg: ctx={ctx_limit} params={model.n_params()}")

    @torch.no_grad()
    def step_logits(ids):
        return model.next_logprobs(ids)

    # ── Frame, with the token-exact window as a hard bound ──────────────────
    def build_ctx(task_text: str, prefix_text: str):
        return [BOS] + SP.encode(frame(task_text, mode)) + SP.encode(prefix_text)

    ids = build_ctx(task, prefix)
    trimmed = False
    lines = task.split("\n")
    while len(ids) + MAX_NEW > ctx_limit and len(lines) > 1:
        lines = lines[1:]
        trimmed = True
        ids = build_ctx("\n".join(lines), prefix)
    text = "\n".join(lines)
    while len(ids) + MAX_NEW > ctx_limit and len(text) > 32:
        text = text[256:]
        trimmed = True
        ids = build_ctx(text, prefix)
    max_new = MAX_NEW
    if len(ids) + max_new > ctx_limit:
        # The transcript prefix alone crowds the window: keep its newest tokens
        # (whole result spans live at the end) and shrink the generation reserve.
        budget = max(0, ctx_limit - MAX_NEW - (len(ids) - len(SP.encode(prefix))))
        keep = SP.encode(prefix)[-budget:] if budget > 0 else []
        prefix = SP.decode(keep)
        ids = build_ctx(text, prefix)
        trimmed = True
        if len(ids) + max_new > ctx_limit:
            max_new = max(16, ctx_limit - len(ids))

    gen = dec.generate(step_logits, ids, prefix, max_new=max_new)
    out = SP.decode(gen)
    pathlib.Path("result.txt").write_text(out)
    pathlib.Path("result_meta.txt").write_text(
        "model=Nexus Intelligence (Run 25 checkpoint)\n"
        f"checkpoint_sha256={digest}\n"
        f"params={model.n_params()}\n"
        f"mode={mode}\n"
        f"prompt_tokens={len(ids)}\n"
        f"completion_tokens={len(gen)}\n"
        f"prompt_trimmed={'true' if trimmed else 'false'}\n"
        f"elapsed_seconds={int(time.time() - started)}\n"
    )
    print(f"segment: {len(gen)} tokens, prompt {len(ids)} tokens, trimmed={trimmed}")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
