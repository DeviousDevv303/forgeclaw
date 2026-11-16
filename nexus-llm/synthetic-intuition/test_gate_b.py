import copy
import json
import unittest
from pathlib import Path

import audit_gate_b


ROOT = Path(__file__).resolve().parent


def load_rows():
    return audit_gate_b.read_jsonl(ROOT / "gate-b-pairs.jsonl")


class GateBArtifactAuditTests(unittest.TestCase):
    def test_committed_pairs_and_summary_are_consistent_but_not_raw_reproduced(self):
        report = audit_gate_b.audit(
            load_rows(),
            audit_gate_b.read_json(ROOT / "gate-b-summary.json"),
            ROOT / "PACK-V1.1.md",
        )
        self.assertEqual(report["pair_file_geometry"]["pairs"], 48)
        self.assertEqual(report["pair_file_geometry"]["rows"], 96)
        self.assertEqual(report["pair_file_geometry"]["prompt_variation"], "distance_bps_only")
        self.assertEqual(report["pair_file_geometry"]["pair_families"], {
            "magnitude_neg": 16,
            "magnitude_pos": 16,
            "sign": 16,
        })
        self.assertEqual(report["pair_file_geometry"]["unique_tickers"], 24)
        self.assertEqual(report["published_summary"]["rows_correct"], {
            "numerator": 24,
            "denominator": 96,
            "value": 0.25,
        })
        self.assertEqual(report["published_summary"]["full_pair_flips"]["numerator"], 0)
        self.assertFalse(report["published_summary"]["raw_output_reproduced"])

    def test_distance_must_match_prompt_and_pair_arms_must_hold_other_text_fixed(self):
        rows = load_rows()
        rows[0]["distance_bps"] += 1
        with self.assertRaises(audit_gate_b.AuditError):
            audit_gate_b.audit_pairs(rows)

        rows = load_rows()
        rows[0]["prompt"] = rows[0]["prompt"].replace("YES 56.0/58.0c", "YES 55.0/58.0c")
        with self.assertRaises(audit_gate_b.AuditError):
            audit_gate_b.audit_pairs(rows)

    def test_summary_must_reconcile_to_actual_pair_ids_and_expected_actions(self):
        pairs = audit_gate_b.audit_pairs(load_rows())
        summary = audit_gate_b.read_json(ROOT / "gate-b-summary.json")
        bad = copy.deepcopy(summary)
        bad["rows_correct"] = 25
        with self.assertRaises(audit_gate_b.AuditError):
            audit_gate_b.reconcile_summary(bad, pairs)

        bad = copy.deepcopy(summary)
        bad["failed_pairs"] = bad["failed_pairs"][:-1]
        with self.assertRaises(audit_gate_b.AuditError):
            audit_gate_b.reconcile_summary(bad, pairs)


if __name__ == "__main__":
    unittest.main()
