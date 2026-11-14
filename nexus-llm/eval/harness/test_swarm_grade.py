import unittest

from swarm_grade import FROZEN_SHA256, first_call, grade_trace, load_benchmark


class SwarmGradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = {row["id"]: row for row in load_benchmark()}

    def test_frozen_benchmark_is_unchanged_25_rows(self):
        self.assertEqual(len(self.rows), 25)
        self.assertEqual(FROZEN_SHA256, "e5ba5013dd99f3a1b39b7d163c19e556405966e69a5dcbd08a2ed1c9b62b4adb")

    def test_first_call_parses_production_grammar(self):
        raw = '<|route:tool|><|call|>{"name":"spawn_agent","arguments":{"system_prompt":"Scout","task":"Read x","tools":"github_read_file"}}<|/call|><|end|>'
        call = first_call(raw)
        self.assertEqual(call["name"], "spawn_agent")
        self.assertEqual(call["arguments"]["tools"], "github_read_file")
        self.assertTrue(call["valid_json"])

    def test_malformed_call_is_preserved(self):
        raw = '<|call|>{"name":"spawn_agent","arguments":{oops}}<|/call|>'
        call = first_call(raw)
        self.assertFalse(call["valid_json"])
        self.assertIn("spawn_agent", call["raw"])

    def test_zero_spawn_restraint_rows(self):
        row = self.rows["sw-001"]
        grade = grade_trace(row, {"row_id": "sw-001", "parent_segments": ["<|answer|>I can read one file directly.<|/answer|>"]})
        self.assertEqual(grade["observed_spawn_count"], 0)
        self.assertTrue(grade["decomposition_match"])
        self.assertFalse(grade["hard_fail_restraint"])

    def test_missing_required_spawn_fields_fail_validity(self):
        row = self.rows["sw-017"]
        raw = '<|call|>{"name":"spawn_agent","arguments":{"system_prompt":"Scout","tools":"github_read_file"}}<|/call|>'
        grade = grade_trace(row, {"row_id": "sw-017", "parent_segments": [raw]})
        self.assertFalse(grade["valid_formation"])
        self.assertFalse(grade["decomposition_match"])

    def test_non_string_tools_is_invalid_and_preserved(self):
        row = self.rows["sw-017"]
        raw = '<|call|>{"name":"spawn_agent","arguments":{"system_prompt":"Scout","task":"Read src/lib/ai/nexusAgentTransport.ts","tools":["github_read_file"]}}<|/call|>'
        grade = grade_trace(row, {"row_id": "sw-017", "parent_segments": [raw]})
        self.assertFalse(grade["valid_formation"])
        self.assertFalse(grade["spawn_calls"][0]["well_formed"])

    def test_read_only_row_flags_omitted_tools_as_all_tools(self):
        row = self.rows["sw-016"]
        calls = []
        for task in (
            "Investigate [NEXUS LEARNING WARNING] in src/lib/forgeTools.ts around 2237 and src/App.tsx around 2363.",
            "Investigate [NEXUS LEARNING WARNING] in src/lib/forgeTools.ts around 2237 and src/App.tsx around 2363.",
        ):
            args = {"system_prompt": "Read-only investigator", "task": task}
            calls.append('<|call|>' + __import__("json").dumps({"name": "spawn_agent", "arguments": args}) + '<|/call|>')
        grade = grade_trace(row, {"row_id": "sw-016", "parent_segments": calls})
        self.assertTrue(grade["hard_fail_readonly_write_grant"])
        self.assertTrue(grade["sw016_self_containment"])

    def test_sw017_detects_nexus_reason_in_child_tool_grant(self):
        row = self.rows["sw-017"]
        raw = '<|call|>{"name":"spawn_agent","arguments":{"system_prompt":"Usage searcher","task":"Search for spawn_agent","tools":"github_search_code,nexus_reason"}}<|/call|>'
        grade = grade_trace(row, {"row_id": "sw-017", "parent_segments": [raw]})
        self.assertFalse(grade["sw017_transport_discipline"])
        self.assertFalse(grade["hard_fail_readonly_write_grant"])


if __name__ == "__main__":
    unittest.main()
