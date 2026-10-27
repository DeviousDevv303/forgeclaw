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

    def test_refuses_to_write_checkpoints_inside_the_repo(self):
        row = {"synthetic": True, "prompt": "x", "text": "<|route:direct|><|ev:not_verified|><|answer|>a<|/answer|><|end|>"}
        r = self.run_train([row], str(HERE / "should-not-exist"))
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((HERE / "should-not-exist").exists())


if __name__ == "__main__":
    unittest.main()
