"""Tests for constrained decoding. Run from nexus-llm/train: python -m unittest test_constrain.py (needs torch, sentencepiece)."""
import json
import pathlib
import random
import re
import unittest

import torch

from common import SP, BOS, frame, read_jsonl
from constrain import ConstrainedDecoder, allowed_evidence, check_call, prefix_state
from model import PRESETS, NexusLM

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = {s: read_jsonl(ROOT / "eval" / s / "cases.jsonl") for s in ("v1", "domains-v1")}
CALLS = [m.group(1) for cs in CASES.values() for c in cs for m in re.finditer(r"<\|call\|>(.*?)<\|/call\|>", c["prefix"], re.S)]


class CallChecker(unittest.TestCase):
    def test_every_canonical_call_in_the_suites_is_complete_and_every_prefix_incomplete(self):
        self.assertGreater(len(CALLS), 30)
        for call in CALLS:
            self.assertEqual(check_call(call), "complete", call)
            for k in range(len(call)):
                self.assertEqual(check_call(call[:k]), "incomplete", (call, k))

    def test_rejects_what_the_schema_or_canonical_form_forbids(self):
        bad = [
            '{"name":"no_such_tool","arguments":{}}',
            '{"name":"github_read_file","arguments":{}}',                                # required path missing
            '{"name":"github_read_file","arguments":{"path":1}}',                        # wrong type
            '{"name":"github_read_file","arguments":{"path":"a","bogus":1}}',           # key not in schema
            '{"name":"github_read_file","arguments":{"repo":"r","path":"a"}}',          # out of schema order
            '{"name":"github_read_file","arguments":{"path":"a"}} ',                     # trailing text
            '{"name":"github_read_file","arguments":{"path":"<|end|>"}}',               # special-token text
            '{"name":"generate_image","arguments":{"prompt":"x","model":"dalle"}}',     # not in enum
            '{"name":"funds_propose","arguments":{"venue":"k","market":"m","side":"maybe"', # enum prefix dead
            '{ "name":"github_list_files","arguments":{}}',                              # non-canonical whitespace
            '{"arguments":{},"name":"github_list_files"}',                               # wrong key order
            '{"name":"kalshi_owner_prices\\ueac',                                       # an escape no tool name can contain
            '{"name":"generate_image","arguments":{"prompt":"x","model":"sd\\u',       # nor any enum value
            '{"name":"funds_status","arguments":{"',                                     # a key where the schema has none
        ]
        for b in bad:
            self.assertEqual(check_call(b), "invalid", b)
        self.assertEqual(check_call('{"name":"github_list_files","arguments":{}}'), "complete")
        self.assertEqual(check_call('{"name":"funds_status","arguments":{}}'), "complete")
        self.assertEqual(check_call('{"name":"generate_image","arguments":{"prompt":"x","width":51'), "incomplete")


class EvidenceRules(unittest.TestCase):
    def test_python_rules_equal_validateTranscript(self):
        rows = json.loads((ROOT / "spec" / "fixtures" / "evidence-rules.json").read_text())["rows"]
        self.assertGreater(len(rows), 10)
        for r in rows:
            self.assertEqual(allowed_evidence(r["route"], [tuple(s) for s in r["steps"]]), r["allowed"], r)

    def test_prefix_state_reads_route_and_steps(self):
        st, route, steps = prefix_state('<|route:tool|><|call|>{"name":"github_list_files","arguments":{}}<|/call|><|result:error|>x<|/result|>')
        self.assertEqual((st, route, steps), ("after_result", "tool", [("github_list_files", "error")]))
        self.assertEqual(prefix_state(""), ("route", None, []))
        self.assertEqual(prefix_state("<|route:direct|>")[0], "after_route_nontool")


class Decoder(unittest.TestCase):
    def test_an_untrained_model_still_emits_only_well_formed_output(self):
        """The guarantee is structural, so it must hold for random weights."""
        torch.manual_seed(0); random.seed(0)
        cfg = PRESETS["smoke"]; cfg.vocab_size = SP.get_piece_size()
        model = NexusLM(cfg).eval()
        dec = ConstrainedDecoder(SP)
        step = lambda ids: model(torch.tensor([ids[-cfg.ctx:]]))[0, -1].detach()
        sample = random.sample(CASES["v1"], 12) + random.sample(CASES["domains-v1"], 12)
        for c in sample:
            ctx = [BOS] + SP.encode(frame(c["prompt"])) + SP.encode(c["prefix"])
            out = SP.decode(dec.generate(step, ctx, c["prefix"], max_new=60))
            if c["prefix"] == "":
                self.assertRegex(out, r"^<\|route:(tool|direct|defer)\|>", c["id"])
            if "<|answer|>" in out:
                self.assertRegex(out, r"<\|ev:[a-z_]+\|><\|answer\|>[^<]*<\|/answer\|><\|end\|>$", c["id"])
                ev = re.search(r"<\|ev:([a-z_]+)\|>", out).group(1)
                st, route, steps = prefix_state(c["prefix"])
                self.assertIn(ev, allowed_evidence(route or re.match(r"<\|route:([a-z]+)", out).group(1), steps), c["id"])
            if out.endswith("<|/call|>"):
                self.assertEqual(check_call(out.rsplit("<|call|>", 1)[1][: -len("<|/call|>")]), "complete", (c["id"], out))


class NoDeadEnds(unittest.TestCase):
    def test_a_call_never_stops_early_when_the_top_tokens_are_all_invalid(self):
        """Regression: with a narrow scan, an untrained model's call stopped at '{"name":"github_repo_state","arguments":{"s'."""
        torch.manual_seed(1)
        cfg = PRESETS["smoke"]; cfg.vocab_size = SP.get_piece_size()
        model = NexusLM(cfg).eval()
        dec = ConstrainedDecoder(SP, max_scan=1)  # force the fallback on almost every step
        step = lambda ids: model(torch.tensor([ids[-cfg.ctx:]]))[0, -1].detach()
        for c in [x for x in CASES["domains-v1"] if x["prefix"] == ""][:6]:
            ids = dec.generate(step, [BOS] + SP.encode(frame(c["prompt"])), "", max_new=400)
            out = SP.decode(ids)
            if out.startswith("<|route:tool|>"):
                self.assertTrue(out.endswith("<|/call|>") or len(ids) == 400, (c["id"], out[-80:]))


if __name__ == "__main__":
    unittest.main()
