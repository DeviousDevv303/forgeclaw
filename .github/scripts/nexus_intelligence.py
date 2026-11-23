"""Nexus Intelligence workflow runner — one constrained-decoding segment of the Run 25 checkpoint.

Invoked by .github/workflows/nexus-intelligence.yml. Inputs arrive as environment variables:
  TASK     the prompt text (the app frames the conversation into it; see buildNexusTaskPayload)
  CONTEXT  the transcript prefix so far (prior <|call|> / <|result:..|> spans of this turn; '' on the first segment)
  MODE     'create' (default) or 'copy' — the harness-presented mode token, as in training

Generation is the graded path, unchanged from nexus-llm/train/predict.py --constrained and the
standalone server: frame = "User: {prompt}\n<|mode:X|>", ConstrainedDecoder over the checkpoint's
own code, stop after <|/call|> or at <|end|>, with a 256-token generation ceiling. The effective
budget is reduced to the room remaining after preserving input that fits the 640-token window.

Provider truth: the checkpoint is reassembled from the base64 parts committed under
.github/nexus-runtime/ and its sha256 is verified against the Run 25 checkpoint hash recorded
in run25/verdict.md. A mismatch fails the run — this workflow never serves a different model
under the Nexus Intelligence name. The .pt is served directly (no GGUF): the architecture's
copy head has no llama.cpp equivalent, and the packaged predict.py reproduces Run 25's frozen
predictions byte-for-byte.

Window honesty: the checkpoint window is 640 tokens total (cfg.ctx in the checkpoint). If the
framed input itself does not fit, the oldest prompt lines are trimmed first, then task text, then
the transcript prefix at token level; result_meta.txt reports
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
MAX_NEW = 256


def generation_budget(ctx_limit: int, prompt_tokens: int) -> int:
    """Reserve up to MAX_NEW tokens without ever exceeding the model context window."""
    return max(0, min(MAX_NEW, ctx_limit - prompt_tokens))


def prepare_generation_context(task: str, prefix: str, mode: str, ctx_limit: int, encode, decode, bos: int = 2):
    """Trim only when the input itself exceeds ctx_limit; output uses whatever room remains."""
    def build(task_text: str, prefix_text: str):
        return [bos] + encode(f"User: {task_text}\n<|mode:{mode}|>") + encode(prefix_text)

    trimmed = False
    lines = task.split("\n")
    text = task
    ids = build(text, prefix)
    while len(ids) > ctx_limit and len(lines) > 1:
        lines = lines[1:]
        text = "\n".join(lines)
        trimmed = True
        ids = build(text, prefix)
    while len(ids) > ctx_limit and len(text) > 32:
        text = text[256:]
        trimmed = True
        ids = build(text, prefix)
    if len(ids) > ctx_limit:
        base_ids = build(text, "")
        available = max(0, ctx_limit - len(base_ids))
        prefix_ids = encode(prefix)
        prefix = decode(prefix_ids[-available:]) if available else ""
        ids = build(text, prefix)
        trimmed = True
    return text, prefix, ids, trimmed


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
    from common import BOS, SP
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

    # The 256-token value is a ceiling, not a prompt-trimming target. Preserve a fitting
    # 417-token prompt and give the decoder its actual remaining 223-token context budget.
    text, prefix, ids, trimmed = prepare_generation_context(
        task, prefix, mode, ctx_limit, SP.encode, SP.decode, BOS
    )
    max_new = generation_budget(ctx_limit, len(ids))

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
