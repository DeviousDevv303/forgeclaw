"""Guards for the training scaffolding. Run: python -m unittest nexus-llm/train/test_train.py  (needs torch + sentencepiece)."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import RESULT_CLOSE, RESULT_OPEN, SP, encode_row  # noqa: E402


class LossMask(unittest.TestCase):
    TEXT = ('<|route:tool|><|call|>{"name":"github_read_file","arguments":{"path":"a"}}<|/call|>'
            '<|result:ok|>secret result text<|/result|><|ev:verified|><|answer|>done<|/answer|><|end|>')

    def test_frame_and_runtime_results_are_masked_and_model_output_is_not(self):
        ids, mask = encode_row("read a", self.TEXT)
        self.assertEqual(len(ids), len(mask))
        pieces = [SP.id_to_piece(i) for i in ids]
        self.assertEqual(mask[0], 0)  # BOS
        first_route = pieces.index("<|route:tool|>")
        self.assertTrue(all(m == 0 for m in mask[:first_route]))  # the "User: ..." frame
        self.assertEqual(mask[first_route], 1)
        o, c = next(i for i, t in enumerate(ids) if t in RESULT_OPEN), ids.index(RESULT_CLOSE)
        self.assertTrue(all(m == 0 for m in mask[o:c + 1]))  # opener .. closer, the runtime's words
        for tok in ("<|ev:verified|>", "<|answer|>", "<|end|>", "<|call|>", "<|/call|>"):
            self.assertEqual(mask[pieces.index(tok)], 1, tok)

    def test_the_result_text_never_contributes_to_the_loss(self):
        ids, mask = encode_row("read a", self.TEXT)
        trained = SP.decode([t for t, m in zip(ids, mask) if m])
        self.assertNotIn("secret result text", trained)


class Guards(unittest.TestCase):
    def run_train(self, rows, out):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write("\n".join(json.dumps(r) for r in rows) + "\n")
        return subprocess.run([sys.executable, str(HERE / "train.py"), "--data", f.name, "--out", out, "--steps", "1"], capture_output=True, text=True)

    def test_refuses_rows_not_marked_synthetic(self):
        with tempfile.TemporaryDirectory() as out:
            r = self.run_train([{"prompt": "x", "text": "<|route:direct|><|ev:not_verified|><|answer|>a<|/answer|><|end|>"}], out)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("synthetic", r.stdout + r.stderr)

    def test_warm_start_refuses_a_checkpoint_from_another_preset(self):
        row = {"synthetic": True, "prompt": "x", "text": "<|route:direct|><|ev:not_verified|><|answer|>a<|/answer|><|end|>"}
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(self.run_train([row], out).returncode, 0)  # smoke checkpoint
            with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
                f.write(json.dumps(row) + "\n")
            r = subprocess.run([sys.executable, str(HERE / "train.py"), "--data", f.name, "--out", out + "/b", "--steps", "1", "--preset", "small-copy",
                                "--init", out + "/model.pt"], capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("refusing --init", r.stdout + r.stderr)

    def test_refuses_to_write_checkpoints_inside_the_repo(self):
        row = {"synthetic": True, "prompt": "x", "text": "<|route:direct|><|ev:not_verified|><|answer|>a<|/answer|><|end|>"}
        r = self.run_train([row], str(HERE / "should-not-exist"))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((HERE / "should-not-exist").exists())


class CopyHead(unittest.TestCase):
    """The pointer-generator head (model.py, copy=True). The toy task is the property the loop needs: put tokens from the context into
    the output, including tokens never seen in training."""

    def setUp(self):
        import torch
        self.torch = torch
        from model import Config, NexusLM
        self.Config, self.NexusLM = Config, NexusLM

    def test_without_copy_loss_and_decoding_equal_the_plain_model(self):
        torch = self.torch
        torch.manual_seed(0)
        m = self.NexusLM(self.Config(vocab_size=50, n_layer=1, n_head=2, d_model=16, d_ff=32, ctx=16)).eval()
        x = torch.randint(4, 50, (2, 10)); y = torch.randint(4, 50, (2, 10)); y[:, :3] = -100
        ce = torch.nn.functional.cross_entropy(m(x).view(-1, 50), y.view(-1), ignore_index=-100)
        self.assertAlmostEqual(float(m.loss(x, y)), float(ce), places=5)
        self.assertTrue(torch.allclose(m.next_logprobs(x[0].tolist()), m(x[:1])[0, -1].log_softmax(-1), atol=1e-6))

    def test_with_copy_the_next_token_distribution_sums_to_one(self):
        torch = self.torch
        torch.manual_seed(0)
        m = self.NexusLM(self.Config(vocab_size=50, n_layer=1, n_head=2, d_model=16, d_ff=32, ctx=16, copy=True)).eval()
        self.assertAlmostEqual(float(m.next_logprobs([5, 9, 9, 12, 30]).exp().sum()), 1.0, places=5)

    def test_copy_head_copies_unseen_tokens_and_the_plain_model_cannot(self):
        torch = self.torch
        V, SEP, n = 400, 3, 5
        def batch(lo, hi, b=64):
            w = torch.randint(lo, hi, (b, n))
            x = torch.cat([torch.full((b, 1), 2), w, torch.full((b, 1), SEP), w], 1)
            y = torch.full_like(x, -100); y[:, n + 1:-1] = x[:, n + 2:]
            return x, y
        acc = {}
        for copy in (False, True):
            torch.manual_seed(1)
            m = self.NexusLM(self.Config(vocab_size=V, n_layer=2, n_head=2, d_model=64, d_ff=128, ctx=16, copy=copy))
            opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
            for _ in range(300):
                x, y = batch(4, 300)  # training tokens: ids 4..299
                loss = m.loss(x, y); opt.zero_grad(); loss.backward(); opt.step()
            m.eval(); x, _ = batch(300, 400, 32)  # held-out tokens 300..399, never seen in training
            hit = tot = 0
            for row in x.tolist():
                ids = row[: n + 2]
                for k in range(n):
                    hit += int(int(m.next_logprobs(ids).argmax()) == row[n + 2 + k]); tot += 1
                    ids = ids + [row[n + 2 + k]]
            acc[copy] = hit / tot
        self.assertGreater(acc[True], 0.8, acc)
        self.assertLess(acc[False], 0.2, acc)


if __name__ == "__main__":
    unittest.main()
