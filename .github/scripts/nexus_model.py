"""Nexus Intelligence (Run 25 checkpoint) as the trader agent's model.

Owner order (2026-11-10): "Let's wire nexus to trade instead of Qwen then." This module loads
the Run 25 checkpoint packaged under .github/nexus-runtime/ (base64 parts), verifies its
sha256 against the hash recorded in run25/verdict.md BEFORE any generation, and serves
constrained-decoding segments through the checkpoint's own graded code path (the same
frame + ConstrainedDecoder that produced Run 25's frozen predictions and that
nexus_intelligence.py uses for the provider seat). A hash mismatch raises: the trader
never runs on a different model under the Nexus name, and there is no fallback model.

The checkpoint's window is 640 tokens total (cfg.ctx). Callers must frame tasks that fit;
count() and fits() here are the budget tools for that.
"""
import base64
import hashlib
import pathlib
import shutil
import sys
import tempfile

EXPECTED_SHA256 = "c41852fb0ac11f47c3ce2fc7715e816e95ec2e844e25881637eabaaac87f69b6"
MODEL_NAME = "nexus-run25"
MAX_NEW = 160

GITHUB_DIR = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_SRC = GITHUB_DIR / "nexus-runtime"


class NexusLoadError(Exception):
    pass


class NexusModel:
    """The verified Run 25 checkpoint, loaded once and asked one segment at a time."""

    def __init__(self, runtime_src=RUNTIME_SRC, work_dir=None):
        runtime_src = pathlib.Path(runtime_src)
        work = pathlib.Path(work_dir) if work_dir else pathlib.Path(tempfile.mkdtemp(prefix="nexus-runtime-work-"))
        if work.exists() and work_dir:
            shutil.rmtree(work)
        (work / "train").mkdir(parents=True, exist_ok=True)
        (work / "spec").mkdir(exist_ok=True)
        (work / "tokenizer").mkdir(exist_ok=True)
        for name in ("model.py", "common.py", "constrain.py"):
            shutil.copy(runtime_src / "train" / name, work / "train" / name)
        for name in ("tools.snapshot.json", "special-tokens.json"):
            shutil.copy(runtime_src / "spec" / name, work / "spec" / name)
        (work / "tokenizer" / "nexus.model").write_bytes(
            base64.b64decode((runtime_src / "tokenizer" / "nexus.model.b64").read_text())
        )

        parts = sorted(runtime_src.glob("model.pt.b64.part-*"))
        if not parts:
            raise NexusLoadError("no checkpoint parts found under .github/nexus-runtime/")
        blob = base64.b64decode("".join(p.read_text() for p in parts))
        digest = hashlib.sha256(blob).hexdigest()
        if digest != EXPECTED_SHA256:
            raise NexusLoadError(f"checkpoint sha256 mismatch: reassembled {digest}, expected {EXPECTED_SHA256}")
        (work / "model.pt").write_bytes(blob)
        self.checkpoint_sha256 = digest

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
        self._torch = torch
        self._BOS, self._SP, self._frame = BOS, SP, frame
        self._dec = ConstrainedDecoder(SP)
        self._model = model
        self.ctx_limit = int(ck["cfg"]["ctx"])
        self.params = model.n_params()
        self.name = MODEL_NAME

    def count(self, task, mode="create"):
        """Tokens the framed task occupies (BOS + frame), before generation."""
        return len([self._BOS] + self._SP.encode(self._frame(task, mode)))

    def fits(self, task, mode="create", max_new=MAX_NEW):
        return self.count(task, mode) + max_new <= self.ctx_limit

    def generate(self, task, mode="create", max_new=MAX_NEW):
        """One constrained-decoding segment: the model's raw transcript for this task."""
        torch = self._torch
        model = self._model

        @torch.no_grad()
        def step_logits(ids):
            return model.next_logprobs(ids)

        ids = [self._BOS] + self._SP.encode(self._frame(task, mode))
        gen = self._dec.generate(step_logits, ids, "", max_new=max_new)
        return self._SP.decode(gen)


def load_nexus(runtime_src=RUNTIME_SRC):
    return NexusModel(runtime_src)
