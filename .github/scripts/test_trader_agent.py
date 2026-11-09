"""Offline tests for trader_agent.py: no network, no model. A fake MCP server and a fake model stand in."""
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import trader_agent as ta  # noqa: E402

TOKEN = "test-token-not-a-secret"
LIVE = {"now": 1_000_000, "window": {"ticker": "KXBTC15M-T", "closeTimeMs": 1_000_000 + 420_000, "strikeUsd": 73983},
        "snapshot": {"yesBidCents": 58, "yesAskCents": 60, "noBidCents": 40, "noAskCents": 42, "distanceBps": 15.0}}
STATUS = {"killed": False, "equityCents": 1001, "hold": None, "openMark": None, "mandate": {"id": "m-1", "state": "active"}, "openTickers": []}


class FakeServer:
    """Answers MCP JSON-RPC like the Bank's /mcp and records every tools/call."""

    def __init__(self, tool_error=None):
        self.calls, self.headers, self.tool_error = [], [], tool_error

    def post(self, body, headers):
        self.headers.append(headers)
        if "id" not in body:
            return 202, {}, ""
        if body["method"] == "initialize":
            return 200, {}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"protocolVersion": "2025-06-18"}})
        name, args = body["params"]["name"], body["params"]["arguments"]
        self.calls.append((name, args))
        data = {"get_status": STATUS, "get_live_window": LIVE, "get_trade_history": [], "get_prediction_record": {"graded": 0}}.get(name, {"ok": True})
        err = self.tool_error == name
        return 200, {}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": json.dumps(data)}], "isError": err}})

    def actions(self):
        return [c for c in self.calls if not c[0].startswith("get_")]


def think_returning(text):
    return lambda system, user: text


class ModeTests(unittest.TestCase):
    def test_default_is_live_by_owner_order(self):
        self.assertEqual(ta.DEFAULT_AGENT_MODE, "live")
        self.assertEqual(ta.agent_mode({}), "live")
        self.assertEqual(ta.agent_mode({"AGENT_MODE": ""}), "live")
        self.assertEqual(ta.agent_mode({"AGENT_MODE": "bogus"}), "live")
        self.assertEqual(ta.agent_mode({"AGENT_MODE": "SHADOW"}), "shadow")

    def test_every_owner_named_control_is_an_action(self):
        tools = {spec[0] for spec in ta.ACTIONS.values() if spec}
        self.assertEqual(tools, {"enter", "exit", "set_hold", "set_kill_switch"})
        self.assertEqual(ta.ACTIONS["enter_yes"][1], {"side": "yes"})
        self.assertEqual(ta.ACTIONS["enter_no"][1], {"side": "no"})
        self.assertEqual(ta.ACTIONS["kill"][1], {"killed": True})


class ParseTests(unittest.TestCase):
    def test_valid_decision(self):
        d = ta.parse_decision('{"p_yes": 0.7, "action": "enter_yes", "reason": "holding above the strike"}', 0.5)
        self.assertEqual((d["action"], d["p_yes"], d["valid"]), ("enter_yes", 0.7, True))

    def test_json_inside_chatter(self):
        d = ta.parse_decision('Sure.\n{"p_yes": 0.3, "action": "exit", "reason": "crossed"}\n', 0.5)
        self.assertEqual(d["action"], "exit")

    def test_garbage_is_never_guessed(self):
        for text in ["", "enter yes now", "{not json}", '{"p_yes": 0.9, "action": "buy_everything", "reason": "x"}',
                     '{"p_yes": 0.9, "action": "kill", "reason": ""}']:
            d = ta.parse_decision(text, 0.59)
            self.assertEqual(d["action"], "none", text)
            self.assertFalse(d["valid"], text)

    def test_bad_probability_falls_back_to_market(self):
        d = ta.parse_decision('{"p_yes": 1.7, "action": "none", "reason": "wait"}', 0.59)
        self.assertEqual(d["p_yes"], 0.59)


class RunOnceTests(unittest.TestCase):
    def run_agent(self, answer, mode="live", tool_error=None):
        server = FakeServer(tool_error)
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning(answer), mode=mode, log=lambda s: None)
        return server, report

    def test_live_enter_sends_predict_then_the_action_with_its_reason(self):
        server, report = self.run_agent('{"p_yes": 0.72, "action": "enter_yes", "reason": "distance holding with time left"}')
        self.assertEqual(server.actions(), [("predict", {"p_yes": 0.72, "reason": "distance holding with time left"}),
                                            ("enter", {"side": "yes", "reason": "distance holding with time left"})])
        self.assertEqual(server.calls[-1][0], "get_status")  # check after acting
        self.assertEqual(report["checked"]["equityCents"], 1001)

    def test_live_kill_and_hold_are_sent(self):
        server, _ = self.run_agent('{"p_yes": 0.5, "action": "kill", "reason": "feed is stale"}')
        self.assertIn(("set_kill_switch", {"killed": True, "reason": "feed is stale"}), server.actions())
        server, _ = self.run_agent('{"p_yes": 0.5, "action": "pause_entries", "reason": "three stop-outs"}')
        self.assertIn(("set_hold", {"phase": "held", "reason": "three stop-outs"}), server.actions())

    def test_shadow_predicts_but_sends_no_action(self):
        server, report = self.run_agent('{"p_yes": 0.72, "action": "enter_yes", "reason": "x"}', mode="shadow")
        self.assertEqual([c[0] for c in server.actions()], ["predict"])
        self.assertEqual(report["acted"][-1]["result"], "shadow mode: not sent")

    def test_invalid_answer_predicts_the_market_and_acts_on_nothing(self):
        server, report = self.run_agent("I think yes")
        self.assertEqual(server.actions(), [("predict", {"p_yes": 0.59, "reason": "model answer was not valid JSON; no action taken"})])
        self.assertEqual(report["decision"]["action"], "none")

    def test_a_refused_action_is_reported_not_hidden(self):
        _, report = self.run_agent('{"p_yes": 0.7, "action": "enter_yes", "reason": "x"}', tool_error="enter")
        self.assertFalse(report["acted"][-1]["ok"])

    def test_the_token_goes_only_in_the_authorization_header_and_never_in_the_log(self):
        server, report = self.run_agent('{"p_yes": 0.7, "action": "none", "reason": "wait"}')
        self.assertTrue(all(h["Authorization"] == f"Bearer {TOKEN}" for h in server.headers))
        self.assertNotIn(TOKEN, json.dumps(report))
        self.assertEqual(ta.redact(f"oops {TOKEN}", TOKEN), "oops [redacted]")

    def test_http_errors_are_redacted(self):
        session = ta.McpSession("https://bank.test/mcp", TOKEN, post=lambda b, h: (401, {}, f"bad token {TOKEN}"))
        with self.assertRaises(ta.McpError) as e:
            session.initialize()
        self.assertNotIn(TOKEN, str(e.exception))


class OrientationTests(unittest.TestCase):
    """The playbook, the numbers the agent thinks with, and the discipline code holds."""

    def test_playbook_carries_the_desks_lessons(self):
        for lesson in ("Never sell a winning position", "11 of 11", "Chop near the strike", "no entry above 85c",
                       "Fees eat careless trading", "you are the entry path", '"analysis"'):
            self.assertIn(lesson, ta.SYSTEM)

    def test_fair_value_is_the_benchmark_formula(self):
        # 15 bps above the strike, 420 s left, default 6 bps 1-minute move: z = 15 / (6/sqrt(60)*1.15*sqrt(440)) = 0.80
        f = ta.fair_value(LIVE)
        self.assertAlmostEqual(f["p_yes"], ta.phi(15 / (6 / math.sqrt(60) * 1.15 * math.sqrt(440))), 9)
        self.assertAlmostEqual(f["p_yes"], 0.789, 2)
        self.assertFalse(f["sigma_measured"])
        self.assertIsNone(ta.fair_value({"now": 1, "window": {}, "snapshot": {}}))

    def test_sigma_is_measured_from_the_window_tape(self):
        tape = [[t, 0.1 * t] for t in range(0, 400, 5)]  # a steady 6 bps per minute drift
        s, n = ta.sigma_1m_bps(tape, 395)
        self.assertEqual(n, 5)
        self.assertAlmostEqual(s, 6.0, 1)
        self.assertEqual(ta.sigma_1m_bps([[0, 1.0]], 30), (None, 0))

    def test_edges_are_after_the_fee(self):
        e = ta.edges({"p_yes": 0.70}, {"yesAskCents": 60, "noAskCents": 42})
        self.assertAlmostEqual(e["yes"], round(70 - 60 - ta.kalshi_fee_cents(60), 1))
        self.assertLess(e["no"], 0)
        self.assertAlmostEqual(ta.kalshi_fee_cents(50), 1.75)

    def test_trend_reads_the_tape(self):
        live = {"window": {"samples": [[0, 1.0], [100, 4.0], [200, 9.0]]}}
        self.assertEqual(ta.trend(live, 60), 5.0)
        self.assertEqual(ta.trend(live, 180), 8.0)

    def test_discipline_blocks_thin_edge_and_chop_but_not_a_real_edge(self):
        dec = {"p_yes": 0.7, "action": "enter_yes", "reason": "r", "valid": True}
        thin = ta.apply_discipline(dec, {"edges": {"yes": 1.3}, "live": {"snapshot": {"distanceBps": 6}}})
        self.assertEqual((thin["action"], thin["blocked"]), ("none", "enter_yes"))
        self.assertIn("under +3c", thin["reason"])
        chop = ta.apply_discipline(dec, {"edges": {"yes": 9.0}, "live": {"snapshot": {"distanceBps": 1.2}}})
        self.assertIn("chop zone", chop["reason"])
        ok = ta.apply_discipline(dec, {"edges": {"yes": 9.0}, "live": {"snapshot": {"distanceBps": 12}}})
        self.assertEqual(ok["action"], "enter_yes")
        hold = {"p_yes": 0.5, "action": "pause_entries", "reason": "r", "valid": True}
        self.assertIs(ta.apply_discipline(hold, {"edges": {}}), hold)  # only entries are disciplined

    def test_thin_edge_entry_is_not_sent_but_the_prediction_is(self):
        server = FakeServer()
        live = json.loads(json.dumps(LIVE)); live["snapshot"]["distanceBps"] = 4.0  # fair ~0.59 vs a 60c ask: no edge
        orig = STATUS, LIVE
        try:
            globals()["LIVE"] = live
            report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                                 think_returning('{"analysis": "a", "p_yes": 0.7, "action": "enter_yes", "reason": "up"}'), log=lambda s: None)
        finally:
            globals()["LIVE"] = orig[1]
        self.assertEqual([c[0] for c in server.actions()], ["predict"])
        self.assertEqual(report["decision"]["blocked"], "enter_yes")
        self.assertEqual(report["decision"]["analysis"], "a")

    def test_prompt_shows_the_numbers(self):
        obs = {"status": STATUS, "live": LIVE, "history": [], "record": {}, "fair": ta.fair_value(LIVE)}
        obs["edges"] = ta.edges(obs["fair"], LIVE["snapshot"])
        text = ta.build_user_prompt(obs)
        self.assertIn("Fair P(YES) = 0.789", text)
        self.assertIn("Edge after fees", text)
        self.assertIn("need +3c", text)


class FirstRunLessonsTests(unittest.TestCase):
    """Run 42534021710: started with 91 s left, thought 108 s (prediction refused: window closed), and answered "hold"
    meaning "keep my position", which is the desk's entry pause."""

    def test_hold_is_not_an_action_name_any_more(self):
        self.assertNotIn("hold", ta.ACTIONS)
        self.assertEqual(ta.ACTIONS["pause_entries"], ("set_hold", {"phase": "held"}))
        d = ta.parse_decision('{"p_yes": 0.95, "action": "hold", "reason": "keep it"}', 0.9)
        self.assertEqual(d["action"], "none")  # the old word is not guessed at
        self.assertIn('"none" means change nothing', ta.SYSTEM)

    def test_too_late_in_the_window_the_model_does_not_start(self):
        server = FakeServer()
        live = json.loads(json.dumps(LIVE)); live["window"]["closeTimeMs"] = live["now"] + 91_000
        called = []
        orig = LIVE
        try:
            globals()["LIVE"] = live
            report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), lambda s, u: called.append(1) or "{}", log=lambda s: None)
        finally:
            globals()["LIVE"] = orig
        self.assertEqual(called, [])
        self.assertIn("91s left", report["skipped"])
        self.assertEqual(server.actions(), [])


class WorkflowTests(unittest.TestCase):
    def test_workflow_defaults_live_and_keeps_the_token_in_secrets(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "workflows", "trader-agent.yml")) as f:
            wf = f.read()
        self.assertIn("AGENT_MODE: ${{ vars.AGENT_MODE || 'live' }}", wf)
        self.assertIn("NEXUS_OWNER_TOKEN: ${{ secrets.NEXUS_OWNER_TOKEN }}", wf)
        self.assertIn("persist-credentials: false", wf)
        self.assertIn("permissions:\n  contents: read", wf)


if __name__ == "__main__":
    unittest.main()
