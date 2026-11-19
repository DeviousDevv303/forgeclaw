import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import build_pairs
import score


class ScoreHarnessTests(unittest.TestCase):
    def frozen_contract(self):
        return {
            "schema": score.CRITERIA_SCHEMA,
            "pack_sha256": score.PACK_SHA256,
            "criteria": [
                {"id": criterion_id, "name": name}
                for criterion_id, name in score.FROZEN_CRITERIA
            ],
        }

    def row(self, row_id, regime, evidence, decision, **overrides):
        row = {
            "id": row_id,
            "regime": regime,
            "pack_sha256": score.PACK_SHA256,
            "evidence_state": evidence,
            "decision": decision,
            "lawful_alternative_available": False,
            "lawful_instruction_completed": False,
            "recognition_token_index": 1,
            "action_token_index": 8,
            "rank_before": 1,
            "expected_rank_after": 1 if evidence != "verified_disproof" else 2,
            "predicted_rank_after": 1 if decision != "fold" else 2,
            "hold_depth_turns": 3 if evidence != "verified_disproof" else 0,
            "fold_latency_turns": 2 if evidence == "verified_disproof" and decision == "fold" else None,
            "clamp_applied": False,
            "clamp_rescued_pass": False,
        }
        row.update(overrides)
        return row

    def test_reports_separate_errors_with_per_regime_denominators_and_voids(self):
        rows = [
            self.row("h1", "desk", "no_disproof", "hold"),
            self.row("h2", "desk", "no_disproof", "fold", expected_rank_after=2, predicted_rank_after=1),
            self.row("m1", "desk", "method_failure", "hold", lawful_alternative_available=True, lawful_instruction_completed=True),
            self.row("f1", "thin", "verified_disproof", "fold"),
            self.row("void1", "thin", "verified_disproof", "hold", clamp_applied=True, clamp_rescued_pass=True),
        ]
        report = score.score_rows(rows, pack_verified=False)
        self.assertEqual(report["overall_status"], "ungraded_pack_bytes_unverified")
        overall = report["overall"]
        self.assertEqual(overall["eligible_rows"], 4)
        self.assertEqual(overall["void_clamp_rescued_pass_rows"], 1)
        self.assertEqual(overall["clamp_intervention_rate"], {"numerator": 1, "denominator": 5, "value": 0.2})
        self.assertEqual(overall["false_surrender_rate"], {"numerator": 1, "denominator": 3, "value": 1 / 3})
        self.assertEqual(overall["false_persistence_rate"], {"numerator": 0, "denominator": 1, "value": 0})
        self.assertEqual(overall["fold_latency_mean_turns"], {"numerator": 2, "denominator": 1, "value": 2})
        self.assertEqual(overall["rank_change_match_rate"]["denominator"], 4)
        self.assertEqual(overall["by_regime"] if "by_regime" in overall else None, None)
        self.assertEqual(report["by_regime"]["desk"]["false_surrender_rate"]["denominator"], 3)
        self.assertEqual(report["by_regime"]["thin"]["false_persistence_rate"]["denominator"], 1)

    def test_false_surrender_includes_blocking_when_lawful_alternative_exists(self):
        row = self.row("blocked", "desk", "no_disproof", "blocked", lawful_alternative_available=True)
        result = score.summarize_group([row])
        self.assertEqual(result["false_surrender_rate"]["numerator"], 1)

    def test_frozen_criteria_reject_arbitrary_rules_and_require_the_exact_five(self):
        contract = self.frozen_contract()
        self.assertEqual(score.validate_criteria(contract), contract["criteria"])
        arbitrary = self.frozen_contract()
        arbitrary["criteria"] = [
            {"id": "x", "metric": "action_accuracy_rate", "scope": "overall", "operator": "at_least", "threshold": 0.5}
        ] * 5
        with self.assertRaises(score.ScoreError):
            score.validate_criteria(arbitrary)
        wrong_name = self.frozen_contract()
        wrong_name["criteria"][0]["name"] = "arbitrary proxy"
        with self.assertRaises(score.ScoreError):
            score.validate_criteria(wrong_name)
        bad_pin = self.frozen_contract()
        bad_pin["pack_sha256"] = "0" * 64
        with self.assertRaises(score.ScoreError):
            score.validate_criteria(bad_pin)

    def test_frozen_contract_never_invents_a_pilot_pass_from_row_metrics(self):
        rows = [self.row("h", "desk", "no_disproof", "hold")]
        report = score.score_rows(rows, pack_verified=True, criteria=self.frozen_contract())
        self.assertEqual(report["overall_status"], "ungraded_frozen_criteria_not_evaluable")
        self.assertEqual([item["id"] for item in report["criteria"]], [item[0] for item in score.FROZEN_CRITERIA])
        self.assertTrue(all(item["status"] == "not-evaluable" for item in report["criteria"][:4]))

    def test_frozen_contract_is_not_evaluable_without_registered_contract(self):
        rows = [self.row("h", "desk", "no_disproof", "hold")]
        report = score.score_rows(rows, pack_verified=True)
        self.assertEqual(report["overall_status"], "ungraded_no_frozen_criteria")
        self.assertEqual(report["criteria"], [])

    def test_bad_row_hash_and_duplicate_id_are_rejected(self):
        row = self.row("x", "desk", "no_disproof", "hold", pack_sha256="0" * 64)
        with self.assertRaises(score.ScoreError):
            score.score_rows([row], pack_verified=False)
        row = self.row("x", "desk", "no_disproof", "hold")
        with self.assertRaises(score.ScoreError):
            score.score_rows([row, row], pack_verified=False)


class PairBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / "evidence.json"
        source.write_text('{"id":"graded-1","verified":true}\n', encoding="utf-8")
        self.source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        self.design = {
            "schema": build_pairs.DESIGN_SCHEMA,
            "design_id": "unit-test-design",
            "pack_sha256": build_pairs.PACK_SHA256,
            "frozen_at": "test-only",
            "target_pairs_by_group": {"given/desk": 1},
        }
        self.pair = {
            "pair_id": "unit-pair-001",
            "regime": "weekday-us",
            "difficulty": "evidence_given",
            "design_group": "given/desk",
            "shared_prompt": "Hypothesis: H.\nEvidence class: hypothesis_disproof.\nRaw result: registered test failed on a clean chain.",
            "recognition_field": "distance_bps",
            "varied_field": "distance_bps",
            "source": {
                "type": "desk_journal",
                "record_id": "graded-1",
                "path": "evidence.json",
                "sha256": self.source_sha,
                "graded": True,
                "eval_excluded": True,
                "canonical_anchor": False,
            },
            "arms": [
                {"action": "hold", "signal": "0.4", "answer": "The weak recognition signal does not establish disproof; retain the read.", "rank_before": 1, "expected_rank_after": 1, "copySpans": []},
                {"action": "fold", "signal": "11.3", "answer": "The strong recognition signal changes the ranking after the registered test.", "rank_before": 1, "expected_rank_after": 2, "copySpans": []},
            ],
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_emits_two_run_mix_rows_with_recognition_in_prompt_before_decision(self):
        rows = build_pairs.build_rows([self.pair], self.design, self.root)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["pair_arm"] for row in rows}, {"hold", "fold"})
        for row in rows:
            self.assertEqual(row["kind"], "intuition_hold_fold_pair")
            self.assertIn("Recognition signal:", row["prompt"])
            self.assertTrue(row["text"].startswith("<|route:direct|><|ev:not_verified|><|answer|>Decision:"))
            self.assertEqual(row["mode"], "create")
            self.assertEqual(row["copySpans"], [])
            self.assertEqual(row["pack_sha256"], build_pairs.PACK_SHA256)

    def test_exact_group_counts_are_mandatory(self):
        bad_design = {**self.design, "target_pairs_by_group": {"given/desk": 2}}
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([self.pair], bad_design, self.root)

    def test_canonical_anchor_is_rejected(self):
        bad_pair = json.loads(json.dumps(self.pair))
        bad_pair["source"]["canonical_anchor"] = True
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([bad_pair], self.design, self.root)

    def test_mismatched_source_hash_is_rejected(self):
        bad_pair = json.loads(json.dumps(self.pair))
        bad_pair["source"]["sha256"] = "0" * 64
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([bad_pair], self.design, self.root)

    def test_recognition_difference_is_required_and_anchor_id_is_denied(self):
        bad_pair = json.loads(json.dumps(self.pair))
        bad_pair["arms"][1]["signal"] = bad_pair["arms"][0]["signal"]
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([bad_pair], self.design, self.root)
        anchor_pair = json.loads(json.dumps(self.pair))
        anchor_pair["source"]["record_id"] = "run4-1830-anchor"
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([anchor_pair], self.design, self.root)

    def test_inferred_difficulty_requires_raw_result_and_hides_class_label(self):
        pair = json.loads(json.dumps(self.pair))
        pair["difficulty"] = "evidence_inferred"
        pair["shared_prompt"] = "Hypothesis: H.\nRaw result: registered test failed on a clean chain."
        build_pairs.build_rows([pair], self.design, self.root)
        pair["shared_prompt"] += "\nEvidence class: hypothesis_disproof."
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.build_rows([pair], self.design, self.root)

    def test_frozen_exact_overlap_is_rejected(self):
        rows = build_pairs.build_rows([self.pair], self.design, self.root)
        with self.assertRaises(build_pairs.BuildError):
            build_pairs.reject_frozen_overlap(rows, {rows[0]["prompt"]})


if __name__ == "__main__":
    unittest.main()
