import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import market_pairs


class MarketPairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / "graded-market-row.json"
        source.write_text('{"record":"graded-17","verified":true}\n', encoding="utf-8")
        self.source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

    def tearDown(self):
        self.temp.cleanup()

    def make_pair(self, pair_id, pair_type, arms, *, training=False):
        pair = {
            "pair_id": pair_id,
            "pair_type": pair_type,
            "split": "train" if training else "eval_only",
            "pack_sha256": market_pairs.PACK_SHA256,
            "regime": "centered-book",
            "design_group": "sign" if pair_type == "sign" else "magnitude",
            "eval_only": not training,
            "shared": {
                "ticker": f"KXBTC15M-27FEB1413{len(pair_id):02d}-00",
                "yes_ask_cents": 55,
                "no_ask_cents": 52,
                "max_stake": 13.0,
                "rationale": "A graded forecast differs from the centered market quote.",
                "sources": ["source:graded-17"],
            },
            "arms": arms,
        }
        if training:
            pair["source"] = {
                "type": "desk_journal",
                "record_id": "graded-17",
                "path": "graded-market-row.json",
                "sha256": self.source_hash,
                "graded": True,
                "eval_excluded": True,
                "canonical_anchor": False,
            }
        return pair

    def test_sign_pair_uses_explicit_no_ask_and_preserves_digits(self):
        pair = self.make_pair("signed-01", "sign", [
            {"arm_id": "positive", "distance_bps": 14.3, "target_probability": 0.78},
            {"arm_id": "negative", "distance_bps": -14.3, "target_probability": 0.73},
        ], training=True)
        normalized = market_pairs.validate_market_pair(pair, 1, self.root, training=True)
        negative = next(arm for arm in normalized["arms"] if arm["distance_bps"] < 0)
        call = market_pairs.expected_call(normalized, negative)
        args = call["arguments"]
        self.assertEqual(args["side"], "no")
        self.assertEqual(args["price"], 0.52)  # NO ask (52c), not 100c - YES ask (45c).
        self.assertEqual(args["market"], pair["shared"]["ticker"])
        self.assertEqual(args["max_stake"], 13.0)
        self.assertIsInstance(args["max_stake"], float)
        row = market_pairs.row_for(normalized, negative)
        self.assertIn(pair["shared"]["ticker"], row["copySpans"])
        self.assertIn("0.52", row["copySpans"])
        self.assertIn("13.0", row["copySpans"])
        encoded = row["text"].split("<|call|>", 1)[1].split("<|/call|>", 1)[0]
        self.assertEqual(json.loads(encoded), call)

    def test_magnitude_pair_maps_strong_to_propose_and_weak_to_pass(self):
        pair = self.make_pair("mag-01", "magnitude", [
            {"arm_id": "strong", "distance_bps": 12.2, "target_probability": 0.71},
            {"arm_id": "weak", "distance_bps": 1.3},
        ], training=True)
        normalized = market_pairs.validate_market_pair(pair, 1, self.root, training=True)
        self.assertEqual({arm["arm_id"]: arm["expected_action"] for arm in normalized["arms"]}, {"strong": "propose", "weak": "pass"})
        rows = [market_pairs.row_for(normalized, arm) for arm in normalized["arms"]]
        self.assertEqual({row["expected_action"] for row in rows}, {"propose", "pass"})

    def test_gate_b_template_enforces_16_16_16_pairs(self):
        pairs = []
        for i in range(16):
            pairs.append(self.make_pair(f"posmag-{i:02d}", "magnitude", [
                {"arm_id": "strong", "distance_bps": 14.2}, {"arm_id": "weak", "distance_bps": 1.1}
            ]))
        for i in range(16):
            pairs.append(self.make_pair(f"negmag-{i:02d}", "magnitude", [
                {"arm_id": "strong", "distance_bps": -14.2}, {"arm_id": "weak", "distance_bps": -1.1}
            ]))
        for i in range(16):
            pairs.append(self.make_pair(f"sign-{i:02d}", "sign", [
                {"arm_id": "positive", "distance_bps": 14.2}, {"arm_id": "negative", "distance_bps": -14.2}
            ]))
        normalized = market_pairs.validate_gate_b_template(pairs, self.root)
        self.assertEqual(len(normalized), 48)

    def test_gate_b_scorer_rejects_no_ask_complement_and_digit_corruption(self):
        pairs = []
        for i in range(16):
            pairs.append(self.make_pair(f"posmag-{i:02d}", "magnitude", [
                {"arm_id": "strong", "distance_bps": 14.2}, {"arm_id": "weak", "distance_bps": 1.1}
            ]))
        for i in range(16):
            pairs.append(self.make_pair(f"negmag-{i:02d}", "magnitude", [
                {"arm_id": "strong", "distance_bps": -14.2}, {"arm_id": "weak", "distance_bps": -1.1}
            ]))
        for i in range(16):
            pairs.append(self.make_pair(f"sign-{i:02d}", "sign", [
                {"arm_id": "positive", "distance_bps": 14.2}, {"arm_id": "negative", "distance_bps": -14.2}
            ]))
        normalized = market_pairs.validate_gate_b_template(pairs, self.root)
        outputs = []
        for pair in normalized:
            for arm in pair["arms"]:
                call = market_pairs.expected_call(pair, arm)
                action = arm["expected_action"]
                if call:
                    call["arguments"]["probability"] = arm.get("target_probability", 0.7)
                outputs.append({"pair_id": pair["pair_id"], "arm_id": arm["arm_id"], "action": action, "call": call})
        good = market_pairs.score_probe(normalized, outputs, pack_verified=True)
        self.assertEqual(good["status"], "pass")
        self.assertEqual(good["expected_action_flips"], {"correct": 48, "denominator": 48})
        self.assertEqual(good["expected_propose_rows"], 64)
        self.assertEqual(good["valid_exact_proposals"], 64)

        corrupted = json.loads(json.dumps(outputs))
        no_side = next(row for row in corrupted if row["pair_id"] == "sign-00" and row["arm_id"] == "negative")
        no_side["call"]["arguments"]["price"] = 0.45  # invalid 100c - YES ask fallback
        no_side["call"]["arguments"]["max_stake"] = "13.0"  # digit/type corruption
        bad = market_pairs.score_probe(normalized, corrupted, pack_verified=True)
        self.assertEqual(bad["status"], "fail")
        self.assertEqual(bad["valid_exact_proposals"], 63)

    def test_probe_overlap_checks_full_mix_and_tranche6(self):
        pair = self.make_pair("sign-overlap", "sign", [
            {"arm_id": "positive", "distance_bps": 14.2},
            {"arm_id": "negative", "distance_bps": -14.2},
        ])
        market_pairs.reject_training_overlap([pair], [{"prompt": "unrelated training row"}], [{"text": "unrelated tranche row"}])
        with self.assertRaises(market_pairs.provenance.BuildError):
            market_pairs.reject_training_overlap([pair], [{"text": "prior training contains " + pair["shared"]["ticker"]}], [])


if __name__ == "__main__":
    unittest.main()
