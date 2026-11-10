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
        return [c for c in self.calls if not c[0].startswith("get_") and c[0] not in ("share_thinking", "record_ruling", "direct_desk", "set_exit_line")]


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
        obs = {"fair": ta.fair_value(LIVE), "live": LIVE}
        self.assertEqual(server.actions(), [("predict", {"p_yes": ta.anchored_p_yes(0.72, obs), "reason": "distance holding with time left"}),
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
        self.assertEqual([a for a in report["acted"] if a["tool"] == "enter"][0]["result"], "shadow mode: not sent")

    def test_invalid_answer_predicts_the_market_and_acts_on_nothing(self):
        server, report = self.run_agent("I think yes")
        obs = {"fair": ta.fair_value(LIVE), "live": LIVE}
        self.assertEqual(server.actions(), [("predict", {"p_yes": ta.anchored_p_yes(0.59, obs), "reason": "model answer was not valid JSON; no action taken"})])
        self.assertEqual(report["decision"]["action"], "none")

    def test_a_refused_action_is_reported_not_hidden(self):
        _, report = self.run_agent('{"p_yes": 0.7, "action": "enter_yes", "reason": "x"}', tool_error="enter")
        self.assertFalse([a for a in report["acted"] if a["tool"] == "enter"][0]["ok"])

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
                       "Fees eat careless trading", "you work as a team", '"analysis"'):
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
        thin = ta.apply_discipline(dec, {"edges": {"yes": 0.3}, "live": {"snapshot": {"distanceBps": 6}}})
        self.assertEqual((thin["action"], thin["blocked"]), ("none", "enter_yes"))
        self.assertIn("under +0.5c", thin["reason"])
        slim = ta.apply_discipline(dec, {"edges": {"yes": 1.3}, "live": {"snapshot": {"distanceBps": 6}}})
        self.assertEqual(slim["action"], "enter_yes")  # owner order 2026-11-08: a thin positive edge is a trade
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
        self.assertIn("need +0.5c", text)


class OwnerNoteTests(unittest.TestCase):
    """The owner's standing note (owner order 2026-11-08): written on his page, stored by the desk under the
    owner_note setting, surfaced by get_status as status.ownerNote, and placed FIRST in the prompt (playbook
    rule 17) so the model reads his word before any market line."""

    NOTE = "scalp until we are back to double digits; exit in time"

    def prompt_with_status(self, status):
        obs = {"status": status, "live": LIVE, "history": [], "record": {}, "fair": ta.fair_value(LIVE)}
        obs["edges"] = ta.edges(obs["fair"], LIVE["snapshot"])
        return ta.build_user_prompt(obs)

    def test_note_present_is_the_first_line_verbatim(self):
        text = self.prompt_with_status({**STATUS, "ownerNote": {"text": self.NOTE, "setAtMs": 1794199000000}})
        first = text.splitlines()[0]
        self.assertTrue(first.startswith("OWNER'S STANDING NOTE"))
        self.assertIn(self.NOTE, first)

    def test_note_absent_or_blank_adds_no_line(self):
        for status in (STATUS, {**STATUS, "ownerNote": None}, {**STATUS, "ownerNote": {"text": "  ", "setAtMs": 1}}):
            self.assertNotIn("OWNER'S STANDING NOTE", self.prompt_with_status(status))

    def test_full_path_observe_payload_into_the_prompt(self):
        # The whole chain, not a direct arg: a fake desk whose get_status carries the note -> observe() ->
        # build_user_prompt. The note text must arrive verbatim, at the top of what the model receives.
        global STATUS
        saved = STATUS
        STATUS = {**STATUS, "ownerNote": {"text": self.NOTE, "setAtMs": 1794199000000}}
        try:
            session = ta.McpSession("https://bank.test/mcp", TOKEN, post=FakeServer().post)
            obs = ta.observe(session)
            text = ta.build_user_prompt(obs)
        finally:
            STATUS = saved
        self.assertEqual(obs["status"]["ownerNote"]["text"], self.NOTE)
        self.assertIn(self.NOTE, text.splitlines()[0])

    def test_playbook_rule_17_carries_the_notes_force_and_its_limits(self):
        self.assertIn("17. THE OWNER'S STANDING NOTE", ta.SYSTEM)
        self.assertIn("does not lift the hard gates", ta.SYSTEM)
        self.assertIn("quote it in your", ta.SYSTEM)


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
        # The feed never rolls (the fake clock stands still): the wait budget runs out and the
        # run still skips without starting the model.
        server = FakeServer()
        live = json.loads(json.dumps(LIVE)); live["window"]["closeTimeMs"] = live["now"] + 91_000
        called = []
        orig = LIVE
        try:
            globals()["LIVE"] = live
            report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), lambda s, u: called.append(1) or "{}", log=lambda s: None, sleep=lambda s: None)
        finally:
            globals()["LIVE"] = orig
        self.assertEqual(called, [])
        self.assertIn("91s left", report["skipped"])
        self.assertGreater(report["waited_s"], 0)
        self.assertEqual(server.actions(), [])

    def test_late_window_waits_then_decides_on_the_next_window(self):
        # Run 42541804428 (2026-11-08): dispatched 36 s before a close, the old code skipped and
        # went home; the desk went unruled for two windows. Now the run waits out the close and
        # decides on the fresh window.
        server = FakeServer()
        dead = json.loads(json.dumps(LIVE)); dead["window"]["closeTimeMs"] = dead["now"] + 91_000
        fresh = json.loads(json.dumps(LIVE)); fresh["window"]["ticker"] = "KXBTC15M-NEXT"
        slept = []

        def fake_sleep(s):
            slept.append(s)
            globals()["LIVE"] = fresh

        orig = LIVE
        try:
            globals()["LIVE"] = dead
            report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                                 think_returning('{"p_yes": 0.62, "action": "none", "reason": "next window, no edge"}'),
                                 log=lambda s: None, sleep=fake_sleep)
        finally:
            globals()["LIVE"] = orig
        self.assertEqual(slept, [101])
        self.assertNotIn("skipped", report)
        self.assertEqual(report["waited_s"], 101)
        self.assertEqual([a[0] for a in server.actions()], ["predict"])


class FairValueHonestyTests(unittest.TestCase):
    """1930 on 2026-11-08: a calm 3-move tape early in the window gave fair 0.96 against a market of 0.59, and the agent
    tried to buy YES; BTC then swung -8.6 -> +21.5 bps in two minutes."""

    def live_early(self, calm_bps_per_min=1.0):
        # 4 minutes into the window, a near-flat tape, BTC 10 bps above the strike, 11 minutes left, market 0.59
        start = 1_000_000
        tape = [[t, 10 - calm_bps_per_min * (230 - t) / 60] for t in range(0, 235, 5)]
        return {"now": start + 232_000, "window": {"startedAtMs": start, "closeTimeMs": start + 900_000, "samples": tape},
                "snapshot": {"distanceBps": 10.0, "yesBidCents": 58, "yesAskCents": 60, "noBidCents": 40, "noAskCents": 42}}

    def test_a_short_calm_tape_cannot_lower_sigma_below_the_default(self):
        f = ta.fair_value(self.live_early())
        self.assertTrue(f["sigma_measured"])
        self.assertGreaterEqual(f["sigma_1m_bps"], ta.DEFAULT_SIGMA_1M_BPS)
        self.assertLess(f["p_yes"], 0.80)  # was ~0.96 with the 1 bps/min tape read at face value

    def test_a_short_jumpy_tape_still_raises_sigma(self):
        f = ta.fair_value(self.live_early(calm_bps_per_min=12.0))
        self.assertGreater(f["sigma_1m_bps"], ta.DEFAULT_SIGMA_1M_BPS)

    def test_edges_are_priced_on_the_formula_blended_with_the_market(self):
        snap = {"yesBidCents": 58, "yesAskCents": 60, "noBidCents": 40, "noAskCents": 42}
        w = ta.MARKET_WEIGHT
        self.assertAlmostEqual(ta.blended_p_yes({"p_yes": 0.96}, snap), w * 0.59 + (1 - w) * 0.96)
        e = ta.edges({"p_yes": 0.96}, snap)
        self.assertAlmostEqual(e["yes"], round(100 * (w * 0.59 + (1 - w) * 0.96) - 60 - ta.kalshi_fee_cents(60), 1))

    def test_2115_the_formula_alone_no_longer_manufactures_a_no_edge(self):
        # 2115 (2026-11-08): formula 0.673 vs book 79/80 (NO ask 21); at a 50/50 blend NO read +4.4c and the agent bought it
        snap = {"yesBidCents": 79, "yesAskCents": 80, "noBidCents": 20, "noAskCents": 21}
        self.assertEqual(ta.MARKET_WEIGHT, 0.75)
        no_edge = ta.edges({"p_yes": 0.673}, snap)["no"]
        self.assertLess(no_edge, 2.0)
        self.assertLess(no_edge, round(100 * (1 - (0.5 * 0.795 + 0.5 * 0.673)) - 21 - ta.kalshi_fee_cents(21), 1))
        self.assertEqual(ta.blended_p_yes({"p_yes": 0.7}, {"yesAskCents": 60}), 0.7)  # no mid: the formula alone


class StandingAgentTests(unittest.TestCase):
    """Owner order 2026-11-09: "The AI starts itself". One run rules window after window."""

    class Clock:
        def __init__(self):
            self.t = 0.0

        def __call__(self):
            return self.t

        def sleep(self, s):
            self.t += s

    def test_rules_once_per_window_and_sleeps_into_the_next(self):
        c = self.Clock()
        calls = []

        def run(watch=None):
            calls.append(c.t)
            return {"decision": {}, "fair": {"left_s": 800}}
        ruled = ta.standing_loop(run, 60, log=lambda s: None, sleep=c.sleep, clock=c)
        self.assertEqual(ruled, len(calls))
        self.assertEqual(calls[1] - calls[0], ta.CHECK_INTERVAL_S)  # constant presence: looks again 30 s later
        self.assertLessEqual(c.t, 60 * 60)

    def test_with_too_little_time_for_another_look_it_sleeps_into_the_next_window(self):
        c = self.Clock()
        calls = []

        def run(watch=None):
            calls.append(c.t)
            return {"decision": {}, "fair": {"left_s": 155}}
        ta.standing_loop(run, 30, log=lambda s: None, sleep=c.sleep, clock=c)
        self.assertEqual(calls[1] - calls[0], 155 + ta.NEXT_WINDOW_GRACE_S)

    def test_one_bad_window_does_not_end_the_agent(self):
        c = self.Clock()
        n = []

        def run(watch=None):
            n.append(1)
            if len(n) == 1:
                raise ta.McpError("tools/call: HTTP 502")
            return {"decision": {}, "fair": {"left_s": 840}}
        logs = []
        ruled = ta.standing_loop(run, 30, log=logs.append, sleep=c.sleep, clock=c)
        self.assertGreaterEqual(ruled, 1)
        self.assertIn("window_error", logs[0])

    def test_skipped_windows_are_not_counted_and_it_stops_at_the_deadline(self):
        c = self.Clock()
        ruled = ta.standing_loop(lambda watch=None: {"skipped": "x", "fair": {"left_s": -19}}, 10, log=lambda s: None, sleep=c.sleep, clock=c)
        self.assertEqual(ruled, 0)
        self.assertLessEqual(c.t, 10 * 60)


class ConstantPresenceTests(unittest.TestCase):
    """Owner 2026-11-09: "we need the AI to be there constantly"."""

    def test_the_recorded_prediction_is_anchored_to_the_fair_value(self):
        # 2045: market 0.85, BTC well above the strike, the model said 0.56
        obs = {"fair": {"p_yes": 0.92}, "live": {"snapshot": {"yesBidCents": 84, "yesAskCents": 86}}}
        blended = ta.MARKET_WEIGHT * 0.85 + (1 - ta.MARKET_WEIGHT) * 0.92
        self.assertAlmostEqual(ta.anchored_p_yes(0.56, obs), round(0.5 * blended + 0.5 * 0.56, 3))
        self.assertGreater(ta.anchored_p_yes(0.56, obs), 0.7)
        self.assertEqual(ta.anchored_p_yes(0.4, {"fair": None, "live": {}}), 0.4)  # nothing to anchor to

    def run_twice(self):
        server = FakeServer()
        predicted, earlier = set(), {}
        answer = think_returning('{"analysis": "a", "p_yes": 0.7, "action": "none", "reason": "watching the position"}')
        for _ in range(2):
            ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), answer, log=lambda s: None,
                        predicted=predicted, earlier=earlier)
        return server, predicted, earlier

    def test_one_graded_prediction_per_window_however_many_check_ins(self):
        server, predicted, earlier = self.run_twice()
        self.assertEqual([c[0] for c in server.actions()], ["predict"])
        self.assertEqual(predicted, {"KXBTC15M-T"})
        self.assertEqual(len(earlier["KXBTC15M-T"]), 2)

    def test_the_agent_remembers_its_check_ins_and_its_graded_calls(self):
        _, _, earlier = self.run_twice()
        obs = {"record": {"recent": [{"ticker": "KXBTC15M-26NOV082030-30", "pYes": 0.31, "marketPYes": 0.24, "result": "no"}]}}
        lines = ta.memory_lines(obs, earlier["KXBTC15M-T"])
        self.assertIn("2030-30: you 0.31 vs market 0.24 -> settled NO", lines[0])
        self.assertIn("watching the position", lines[1])
        seen = []
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=FakeServer().post), lambda s, u: seen.append(u) or "{}",
                    log=lambda s: None, predicted=set(), earlier=earlier)
        self.assertIn("Your earlier check-ins this window", seen[0])


class ReasoningPanelTests(unittest.TestCase):
    """Owner 2026-11-09: "I want that part to be the model reasoning" -- every check-in publishes its thinking."""

    def test_every_check_in_shares_its_reasoning_after_acting(self):
        server = FakeServer()
        predicted, earlier = set(), {}
        answer = think_returning('{"analysis": "BTC 20 bps above the strike, winning position", "p_yes": 0.9, "action": "none", "reason": "hold the winner"}')
        for _ in range(2):
            ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), answer, log=lambda s: None, predicted=predicted, earlier=earlier)
        shared = [a for n, a in server.calls if n == "share_thinking"]
        self.assertEqual(len(shared), 2)
        self.assertEqual(shared[0]["analysis"], "BTC 20 bps above the strike, winning position")
        self.assertEqual(shared[0]["action"], "none")

    def test_the_reasoning_is_shared_after_the_order_not_before(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                    think_returning('{"analysis": "a", "p_yes": 0.72, "action": "enter_yes", "reason": "edge"}'), log=lambda s: None)
        names = [n for n, _ in server.calls]
        self.assertLess(names.index("enter"), names.index("share_thinking"))

    def test_a_desk_without_the_tool_still_decides(self):
        server = FakeServer(tool_error="share_thinking")
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                             think_returning('{"analysis": "a", "p_yes": 0.7, "action": "none", "reason": "r"}'), log=lambda s: None)
        self.assertIn({"tool": "share_thinking", "ok": False}, report["acted"])
        self.assertIsNotNone(report["checked"])


class LiveWatcherTests(unittest.TestCase):
    """Owner 2026-11-09: "the quicker the model can read the live trading, the better ... watching constantly"."""

    seen = {"ticker": "T1", "distanceBps": 12.0, "yesBid": 80, "position": (100, 0)}

    def test_material_changes_wake_the_model(self):
        mc = ta.material_change
        self.assertIsNone(mc(self.seen, dict(self.seen, distanceBps=14.0, yesBid=84)))           # noise: sleep on
        self.assertIn("new window", mc(self.seen, dict(self.seen, ticker="T2")))
        self.assertIn("fill", mc(self.seen, dict(self.seen, position=(0, 0))))
        self.assertIn("-6.0 bps", mc(self.seen, dict(self.seen, distanceBps=6.0)))
        self.assertIn("+10c", mc(self.seen, dict(self.seen, yesBid=90)))
        near = dict(self.seen, distanceBps=4.0)
        self.assertIn("within 3 bps", mc(near, dict(near, distanceBps=2.5)))                       # holding, into the danger zone

    def test_the_watcher_wakes_early_and_otherwise_sleeps_the_full_pause(self):
        t = [0.0]
        clock = lambda: t[0]  # noqa: E731
        sleep = lambda s: t.__setitem__(0, t[0] + s)  # noqa: E731
        reads = [dict(self.seen), dict(self.seen, distanceBps=5.0)]
        why = ta.watch_pause(60, self.seen, lambda: reads.pop(0) if len(reads) > 1 else reads[0], log=lambda s: None, sleep=sleep, clock=clock)
        self.assertIn("bps", why["woke"])
        self.assertEqual(len(why["readings"]), 2)
        self.assertEqual(t[0], 2 * ta.WATCH_POLL_S)  # woke on the second look, 10 s in, not after 60
        t[0] = 0.0
        self.assertIsNone(ta.watch_pause(60, self.seen, lambda: dict(self.seen), log=lambda s: None, sleep=sleep, clock=clock)["woke"])
        self.assertEqual(t[0], 60)

    def test_a_failing_peek_is_a_missed_look_not_a_stop(self):
        t = [0.0]

        def bad():
            raise ta.McpError("HTTP 502")
        self.assertEqual(ta.watch_pause(20, self.seen, bad, log=lambda s: None, sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0]), {"woke": None, "readings": []})
        self.assertEqual(t[0], 20)

    def test_live_view_reads_the_position_from_the_fills(self):
        v = ta.live_view({"window": {"ticker": "T"}, "snapshot": {"distanceBps": 3.0, "yesBidCents": 60},
                          "intents": [{"side": "yes", "purpose": "entry", "filled_hundredths": 200}, {"side": "yes", "purpose": "exit", "filled_hundredths": 200}]})
        self.assertEqual(v, {"ticker": "T", "distanceBps": 3.0, "yesBid": 60, "position": (0, 0)})

    def test_the_watcher_tells_the_model_what_it_saw(self):
        readings = [dict(self.seen, distanceBps=d, yesBid=b) for d, b in ((12.0, 80), (10.1, 76), (8.4, 71), (6.0, 66))]
        lines = ta.watch_lines({"woke": "BTC moved -6.0 bps vs the strike", "readings": readings})
        self.assertEqual(lines[0], "You were woken early because BTC moved -6.0 bps vs the strike.")
        self.assertIn("distance +12.0 > +10.1 > +8.4 > +6.0 bps", lines[1])
        self.assertIn("YES bid 80 > 76 > 71 > 66c", lines[1])
        self.assertIn("position now YES 1 / NO 0 contracts", lines[1])
        self.assertEqual(ta.watch_lines(None), [])
        long = ta.watch_lines({"woke": None, "readings": [dict(self.seen, distanceBps=float(i)) for i in range(40)]})
        self.assertEqual(long[0].count(" > ") // 2, 11)  # thinned to 12 points per series

    def test_the_loop_hands_the_watch_to_the_next_ruling_and_it_reaches_the_prompt(self):
        t = [0.0]
        got = []

        def run(watch=None):
            got.append(watch)
            return {"decision": {}, "fair": {"left_s": 800}, "seen": dict(self.seen)}
        reads = [dict(self.seen, distanceBps=5.0)]
        ta.standing_loop(run, 1, log=lambda s: None, sleep=lambda s: t.__setitem__(0, t[0] + s), clock=lambda: t[0], peek=lambda: reads[0])
        self.assertIsNone(got[0])
        self.assertIn("bps", got[1]["woke"])
        seen = []
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=FakeServer().post), lambda s, u: seen.append(u) or "{}",
                    log=lambda s: None, watch=got[1])
        self.assertIn("You were woken early because", seen[0])
        self.assertIn("Live since your last ruling", seen[0])

    def test_faster_answers(self):
        self.assertLessEqual(ta.MAX_ANSWER_TOKENS, 400)  # still bounded: ~90 s worst case on the CPU runner
        self.assertIn("1-2 short sentences", ta.SYSTEM)


class RulerCorpusTests(unittest.TestCase):
    """Owner 2026-11-09: Nexus learns "from being ruler" -- every ruling is recorded with what it saw and decided."""

    def test_every_ruling_is_recorded_with_its_inputs_and_output(self):
        server = FakeServer()
        answer = '{"analysis": "BTC holding 15 bps above", "p_yes": 0.7, "action": "enter_yes", "reason": "edge after fees"}'
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning(answer), log=lambda s: None,
                    watch={"woke": "a fill", "readings": []}, model_name="Qwen3-8B-Q4_K_M.gguf")
        rec = [a for n, a in server.calls if n == "record_ruling"]
        self.assertEqual(len(rec), 1)
        r = rec[0]
        self.assertEqual(r["model"], "Qwen3-8B-Q4_K_M.gguf")
        self.assertEqual(r["action"], "enter_yes")
        self.assertEqual(r["p_model"], 0.7)
        self.assertEqual(r["inputs"]["system_sha"], ta.SYSTEM_SHA)
        self.assertIn("Fair P(YES)", r["inputs"]["prompt"])
        self.assertEqual(r["inputs"]["woke"], "a fill")
        self.assertEqual(r["output"]["raw"], answer)
        self.assertIn("enter", [a["tool"] for a in r["output"]["acted"]])  # what it did is part of the record
        names = [n for n, _ in server.calls]
        self.assertLess(names.index("enter"), names.index("record_ruling"))  # recorded after the order

    def test_the_token_never_enters_the_corpus(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning('{"p_yes": 0.5, "action": "none", "reason": "r"}'), log=lambda s: None)
        rec = [a for n, a in server.calls if n == "record_ruling"][0]
        self.assertNotIn(TOKEN, json.dumps(rec))

    def test_a_desk_without_the_corpus_still_decides(self):
        server = FakeServer(tool_error="record_ruling")
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning('{"p_yes": 0.5, "action": "none", "reason": "r"}'), log=lambda s: None)
        self.assertIn({"tool": "record_ruling", "ok": False}, report["acted"])
        self.assertIsNotNone(report["checked"])


class NexusShadowTests(unittest.TestCase):
    """Owner 2026-11-09: Nexus walks with the ruler in shadow -- same question, graded, never trades."""

    def run_with(self, shadow, ruler='{"analysis": "a", "p_yes": 0.6, "action": "none", "reason": "no edge"}'):
        server, recorded, logs = FakeServer(), [], []
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning(ruler), log=logs.append,
                             shadow=shadow, record=recorded.append, spawn=lambda f: f())
        return server, recorded, report, logs

    def test_nexus_gets_the_same_question_and_is_filed_as_a_shadow_ruling(self):
        asked = []

        def nexus(system, user):
            asked.append((system, user))
            return "nexus-run25", '{"analysis": "momentum up", "p_yes": 0.8, "action": "enter_yes", "reason": "edge"}'
        server, recorded, report, _ = self.run_with(nexus)
        self.assertEqual(asked[0][0], ta.SYSTEM)
        ruler_prompt = [a for n, a in server.calls if n == "record_ruling"][0]["inputs"]["prompt"]
        self.assertEqual(asked[0][1], ruler_prompt)  # the very prompt the ruler read
        self.assertEqual(recorded[0]["model"], "shadow:nexus-run25")
        self.assertEqual((recorded[0]["action"], recorded[0]["p_yes"]), ("enter_yes", 0.8))
        self.assertTrue(recorded[0]["output"]["shadow"])
        # Nexus said enter_yes; nothing was sent for it
        self.assertEqual([c[0] for c in server.actions()], ["predict"])

    def test_a_broken_or_absent_nexus_never_touches_the_ruler(self):
        def down(system, user):
            raise OSError("connection refused")
        server, recorded, report, logs = self.run_with(down)
        self.assertEqual(recorded, [])
        self.assertTrue(any("nexus_shadow_error" in line for line in logs))
        self.assertIsNotNone(report["checked"])
        _, rec2, _, _ = self.run_with(lambda s, u: ("nexus", "not json at all"))
        self.assertEqual((rec2[0]["action"], rec2[0]["output"]["valid"]), ("none", False))

    def test_the_chat_completions_caller(self):
        sent = []

        def post(url, body, headers):
            sent.append((url, body, headers))
            return {"model": "nexus-run25", "choices": [{"message": {"content": '{"action": "none"}'}}]}
        name, text = ta.chat_completions_shadow("https://nexus.example/v1/chat/completions", "tok", post=post)("SYS", "USER")
        self.assertEqual((name, text), ("nexus-run25", '{"action": "none"}'))
        url, body, headers = sent[0]
        self.assertEqual([m["role"] for m in body["messages"]], ["system", "user"])
        self.assertEqual(headers["Authorization"], "Bearer tok")
        ta.chat_completions_shadow("u", None, post=lambda u, b, h: sent.append((u, b, h)) or {"choices": []})("s", "u")
        self.assertNotIn("Authorization", sent[-1][2])  # no token configured: no header

    def test_a_plain_completions_address_gets_a_prompt_and_its_text_is_read(self):
        sent = []

        def post(url, body, headers):
            sent.append(body)
            return {"model": "nexus-run25", "choices": [{"text": '{"action": "none", "p_yes": 0.6, "reason": "r"}'}]}
        name, text = ta.chat_completions_shadow("https://nexus-shadow.example/v1/completions", "tok", post=post)("SYS", "USER")
        self.assertEqual((name, text), ("nexus-run25", '{"action": "none", "p_yes": 0.6, "reason": "r"}'))
        self.assertNotIn("messages", sent[0])
        self.assertTrue(sent[0]["prompt"].startswith("SYS") and "USER" in sent[0]["prompt"])
        # a chat address still gets messages, and a text-shaped reply is still read
        ta.chat_completions_shadow("https://x/v1/chat/completions", None, post=post)("S", "U")
        self.assertIn("messages", sent[1])

    def test_the_shadow_seat_is_retired_and_the_checkpoint_is_checked_out(self):
        # Owner order 2026-11-10: Nexus REPLACES Qwen as the ruler; there is no shadow seat left to feed.
        with open(os.path.join(os.path.dirname(__file__), "..", "workflows", "trader-agent.yml")) as f:
            wf = f.read()
        self.assertNotIn("NEXUS_SHADOW_URL", wf)
        self.assertNotIn("NEXUS_SHADOW_TOKEN", wf)
        self.assertIn(".github/nexus-runtime", wf)   # the Run 25 checkpoint parts ride the checkout
        self.assertIn("torch", wf)                   # the runtime that serves the checkpoint


class AheadOfTheMarketTests(unittest.TestCase):
    """Owner 2026-11-09: "make sure ... it's making these calls before they get too bad". Window 2200: entry to stop-out
    in 48 s, before the agent ruled once; its first ruling there read BTC +4.1 bps when it was already -5."""

    def with_live(self, live, fn):
        orig = LIVE
        try:
            globals()["LIVE"] = live
            return fn()
        finally:
            globals()["LIVE"] = orig

    def test_stale_reasons(self):
        seen = {"ticker": "T", "distanceBps": 4.1, "yesBid": 60, "position": (0, 0)}
        self.assertIn("crossed the strike", ta.stale_reason(seen, dict(seen, distanceBps=-5.0)))
        self.assertIn("+3.5 bps", ta.stale_reason(seen, dict(seen, distanceBps=7.6)))
        self.assertIn("position", ta.stale_reason(seen, dict(seen, position=(300, 0))))
        self.assertIn("new window", ta.stale_reason(seen, dict(seen, ticker="T2")))
        self.assertIsNone(ta.stale_reason(seen, dict(seen, distanceBps=5.9)))
        self.assertIsNone(ta.stale_reason(dict(seen, distanceBps=0.2), dict(seen, distanceBps=-0.1)))  # a hair at the strike

    def test_a_stale_entry_is_not_sent_and_the_loop_looks_again_at_once(self):
        server = FakeServer()
        moved = json.loads(json.dumps(LIVE)); moved["snapshot"]["distanceBps"] = -5.0
        feeds = [LIVE, moved]  # observe sees +15, the re-check after thinking sees -5
        orig_post = server.post

        def post(body, headers):
            if body.get("method") == "tools/call" and body["params"]["name"] == "get_live_window":
                globals()["LIVE"] = feeds.pop(0) if len(feeds) > 1 else feeds[0]
            return orig_post(body, headers)
        report = self.with_live(LIVE, lambda: ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=post),
                                think_returning('{"analysis": "a", "p_yes": 0.9, "action": "enter_yes", "reason": "holding above"}'), log=lambda s: None))
        self.assertNotIn("enter", [c[0] for c in server.actions()])
        self.assertTrue(report["recheck_now"])
        self.assertIn("crossed the strike", report["decision"]["reason"])
        # the loop asks again with no pause
        t, calls = [0.0], []

        def run(watch=None):
            calls.append(t[0])
            return {"decision": {}, "fair": {"left_s": 800}, "recheck_now": len(calls) == 1}
        ta.standing_loop(run, 1, log=lambda s: None, sleep=lambda x: t.__setitem__(0, t[0] + x), clock=lambda: t[0])
        self.assertEqual(calls[1] - calls[0], 0)

    def holding_live(self):
        live = json.loads(json.dumps(LIVE))
        live["intents"] = [{"side": "yes", "purpose": "entry", "filled_hundredths": 300}]
        return live

    def test_while_holding_the_agent_sets_its_exit_line_for_the_desk(self):
        server = FakeServer()
        self.with_live(self.holding_live(), lambda: ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                       think_returning('{"analysis": "momentum turning", "p_yes": 0.7, "action": "none", "reason": "tighten", "exit_line_bps": -3}'), log=lambda s: None))
        lines = [a for n, a in server.calls if n == "set_exit_line"]
        self.assertEqual(lines, [{"at_bps": -3.0, "reason": "tighten"}])

    def test_flat_no_line_and_out_of_range_lines_are_not_trusted(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                    think_returning('{"p_yes": 0.7, "action": "none", "reason": "r", "exit_line_bps": -3}'), log=lambda s: None)
        self.assertEqual([n for n, _ in server.calls if n == "set_exit_line"], [])  # flat: nothing to protect
        self.assertIsNone(ta.parse_decision('{"p_yes": 0.5, "action": "none", "reason": "r", "exit_line_bps": -40}', 0.5)["exit_line_bps"])
        self.assertEqual(ta.parse_decision('{"p_yes": 0.5, "action": "none", "reason": "r", "exit_line_bps": 0}', 0.5)["exit_line_bps"], 0.0)
        self.assertIn('"exit_line_bps"', ta.SYSTEM)
        self.assertIn("48 s", ta.SYSTEM)


class DirectsTheDeskTests(unittest.TestCase):
    """Owner 2026-11-09: "if the AI can let observer and preserver know what they did wrong and direct them constantly"."""

    LIVE_2200 = {"intents": [
        {"intent_id": "KXBTC15M-26NOV082200-00:observer:7:entry", "side": "yes", "purpose": "entry", "filled_hundredths": 300, "avg_yes_price_micros": 600000, "created_at_ms": 1},
        {"intent_id": "KXBTC15M-26NOV082200-00:observer:62:stop10", "side": "yes", "purpose": "exit", "filled_hundredths": 300, "avg_yes_price_micros": 430000, "created_at_ms": 2},
        {"intent_id": "KXBTC15M-26NOV082200-00:observer:4:entry", "side": "yes", "purpose": "entry", "filled_hundredths": 0, "avg_yes_price_micros": None, "created_at_ms": 0},
        {"intent_id": "KXBTC15M-26NOV082200-00:crew-lead-trigger:1:a", "side": "no", "purpose": "entry", "filled_hundredths": 100, "avg_yes_price_micros": 390000, "created_at_ms": 3}]}

    def test_the_agent_sees_the_desks_trades_in_plain_words(self):
        line = ta.desk_trades_lines(self.LIVE_2200)[0]
        self.assertIn("Observer entry YES x3 @ 60c; strike-cross stop YES x3 @ 43c; your entry NO x1 @ 61c", line)
        self.assertEqual(ta.desk_trades_lines({"intents": []}), ["The desk has not traded in this window yet."])

    def test_directives_are_parsed_and_bounded(self):
        d = ta.parse_decision('{"p_yes": 0.5, "action": "none", "reason": "r", "review": "too close to the strike",'
                              ' "directives": {"block_entry_side": "yes", "min_entry_bps": 6, "max_contracts": 2}}', 0.5)
        self.assertEqual(d["directives"], {"block_entry_side": "yes", "min_entry_bps": 6.0, "max_contracts": 2})
        self.assertEqual(d["review"], "too close to the strike")
        bad = ta.parse_directives({"block_entry_side": "up", "min_entry_bps": 1, "max_contracts": 2.5})
        self.assertEqual(bad, {"block_entry_side": None, "min_entry_bps": None, "max_contracts": None})
        self.assertIsNone(ta.parse_directives(None))

    def test_the_directive_goes_to_the_desk_and_the_review_to_the_panel(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think_returning(
            '{"analysis": "chop", "p_yes": 0.5, "action": "none", "reason": "no edge", "review": "Observer bought YES 4 bps out and was stopped in 48 s",'
            ' "directives": {"block_entry_side": null, "min_entry_bps": 6, "max_contracts": null}}'), log=lambda s: None)
        direct = [a for n, a in server.calls if n == "direct_desk"]
        self.assertEqual(direct, [{"block_entry_side": None, "min_entry_bps": 6.0, "max_contracts": None, "reason": "Observer bought YES 4 bps out and was stopped in 48 s"}])
        shared = [a for n, a in server.calls if n == "share_thinking"][0]
        self.assertEqual(shared["review"], "Observer bought YES 4 bps out and was stopped in 48 s")
        self.assertIn("12. You rule the desk", ta.SYSTEM)

    def test_no_directives_given_clears_the_last_one(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                    think_returning('{"p_yes": 0.5, "action": "none", "reason": "r"}'), log=lambda s: None)
        self.assertEqual([a["block_entry_side"] for n, a in server.calls if n == "direct_desk"], [None])


class MoneyPlanTests(unittest.TestCase):
    """Owner 2026-11-09: "checks the live funds, what we officially have, and tries to get us up out the hole ... strategize"."""

    ST = {"equityCents": 1185, "kalshiBalanceCents": 1185, "recoveryLineCents": 1000, "toRecoveryLineCents": 0,
          "toGoalCents": 2365, "daySettledPnlCents": -412, "maxStopRiskPerContractCents": 40}

    def test_the_money_in_plain_words(self):
        line = ta.money_lines(self.ST)[0]
        self.assertIn("equity $11.85, Kalshi cash $11.85", line)
        self.assertIn("above the $10.00 recovery line", line)
        self.assertIn("$23.65 from the goal", line)
        self.assertIn("today's settled P&L -$4.12", line)
        self.assertIn("29 stop-outs", line)
        under = ta.money_lines(dict(self.ST, equityCents=486, toRecoveryLineCents=514))[0]
        self.assertIn("$5.14 under the $10.00 recovery line", under)
        self.assertEqual(ta.money_lines({}), [])

    def test_the_plan_is_parsed_shown_and_the_rule_says_never_chase(self):
        server = FakeServer()
        status = dict(STATUS, **self.ST)
        orig = STATUS
        try:
            globals()["STATUS"] = status
            seen = []
            ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                        lambda s, u: seen.append(u) or '{"p_yes": 0.5, "action": "none", "reason": "r", "plan": "Above the line: 2 contracts, 8+ bps only."}',
                        log=lambda s: None)
        finally:
            globals()["STATUS"] = orig
        self.assertIn("Money (official): equity $11.85", seen[0])
        shared = [a for n, a in server.calls if n == "share_thinking"][0]
        self.assertEqual(shared["plan"], "Above the line: 2 contracts, 8+ bps only.")
        self.assertIn("Never chase losses", ta.SYSTEM)
        self.assertIn('"plan"', ta.SYSTEM)

    def test_the_review_has_no_example_left_to_parrot(self):
        # 23:11 and 23:13 CST: the model repeated the old rule-12 example as fact for windows where it never happened
        self.assertNotIn("stopped 48 s later", ta.SYSTEM)
        self.assertIn("if the list says the desk has not traded, say exactly that", ta.SYSTEM)


class GroundingTests(unittest.TestCase):
    """Muse's handover (2026-11-09): circular blocks, rulings vs desk mismatch, sign flips, invented outcomes."""

    def fills(self, *rows):
        return {"intents": [{"side": s, "purpose": p, "filled_hundredths": n * 100, "avg_yes_price_micros": (y if s == "yes" else 100 - y) * 10000, "created_at_ms": k}
                            for k, (s, p, n, y) in enumerate(rows)]}

    def test_a_block_must_be_earned_by_a_real_loss_on_that_side(self):
        none_lost = self.fills()
        d, why = ta.ground_directives({"block_entry_side": "both", "min_entry_bps": 6, "max_contracts": None}, none_lost)
        self.assertEqual(d, {"block_entry_side": None, "min_entry_bps": 6, "max_contracts": None})
        self.assertIn("has not lost on both sides", why)
        yes_lost = self.fills(("yes", "entry", 3, 60), ("yes", "exit", 3, 43))
        self.assertEqual(ta.window_losses_by_side(yes_lost), {"yes": 1, "no": 0})
        d, why = ta.ground_directives({"block_entry_side": "yes", "min_entry_bps": None, "max_contracts": None}, yes_lost)
        self.assertEqual((d["block_entry_side"], why), ("yes", None))
        self.assertIsNone(ta.ground_directives({"block_entry_side": "both", "min_entry_bps": None, "max_contracts": None}, yes_lost)[0]["block_entry_side"])
        won = self.fills(("no", "entry", 2, 87), ("no", "exit", 2, 95))
        self.assertEqual(ta.window_losses_by_side(won), {"yes": 0, "no": 0})

    def test_its_own_directive_hold_is_labelled_not_evidence(self):
        line = ta.observer_line({"lastDecision": {"action": "observer-hold", "reason": "agent-directive-block"}})
        self.assertIn("YOUR OWN directive", line)
        self.assertIn("not evidence", line)
        self.assertIn("awaiting", ta.observer_line({"lastDecision": {"action": "observer-hold", "reason": "awaiting-confirmation-3s"}}))

    def test_directives_are_renewed_every_ruling_and_recorded(self):
        server = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                    think_returning('{"p_yes": 0.5, "action": "none", "reason": "quiet"}'), log=lambda s: None)
        self.assertEqual([a for n, a in server.calls if n == "direct_desk"],
                         [{"block_entry_side": None, "min_entry_bps": None, "max_contracts": None, "reason": "quiet"}])  # cleared
        server2 = FakeServer()
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server2.post),
                    think_returning('{"p_yes": 0.5, "action": "none", "reason": "r", "directives": {"block_entry_side": "both", "min_entry_bps": 6}}'), log=lambda s: None)
        sent = [a for n, a in server2.calls if n == "direct_desk"][0]
        self.assertIsNone(sent["block_entry_side"])
        self.assertEqual(sent["min_entry_bps"], 6.0)
        self.assertIn("has not lost", sent["reason"])
        rec = [a for n, a in server2.calls if n == "record_ruling"][0]["output"]
        self.assertEqual(rec["directives"]["min_entry_bps"], 6.0)
        self.assertIn("has not lost", rec["directive_note"])

    def test_a_sign_flip_is_not_acted_on(self):
        self.assertIn("feed reads -10.0", ta.sign_contradiction("BTC is 10.0 bps above the strike", -10.0))
        self.assertIsNone(ta.sign_contradiction("BTC is 10.0 bps below the strike", -10.0))
        self.assertIsNone(ta.sign_contradiction("BTC is 0.5 bps above the strike", -0.4))
        server = FakeServer()  # LIVE distance is +15
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post),
                             think_returning('{"analysis": "BTC is 15 bps below the strike", "p_yes": 0.9, "action": "enter_yes", "reason": "edge"}'), log=lambda s: None)
        self.assertNotIn("enter", [c[0] for c in server.actions()])
        self.assertIn("not acted on", report["decision"]["reason"])

    def test_the_last_window_outcome_is_in_the_prompt(self):
        lines = ta.last_window_lines({"record": {"recent": [{"ticker": "KXBTC15M-26NOV082215-15", "pYes": 0.3, "marketPYes": 0.4, "result": "yes"}]}})
        self.assertIn("2215-15: settled YES", lines[0])
        self.assertEqual(ta.last_window_lines({"record": {}}), [])


class AnswerRoomTests(unittest.TestCase):
    """2026-11-09 23:41 CST: the first ruling after #390 was "not valid JSON" -- the answer outgrew the 200-token cap."""

    FULL = json.dumps({
        "analysis": "BTC is 19.1 bps below the strike and still falling, with the NO side holding a +20c per contract gain. The edge after fees is negative for a new entry on either side.",
        "p_yes": 0.12, "action": "none",
        "reason": "Holding the NO winner; no new entry has an edge after fees.",
        "exit_line_bps": -4,
        "review": "The Observer bought YES x18 at 52c and was stopped at 41c eight seconds later; the NO x11 at 73c is now up 20c.",
        "plan": "Equity $11.26, above the $10 line: 3 contracts max, entries 8+ bps out only, protect the open winner at 4 bps.",
        "directives": {"block_entry_side": "yes", "min_entry_bps": 8, "max_contracts": 3}})

    def test_a_full_answer_fits_the_cap(self):
        # ~3.5 characters a token is a conservative English/JSON estimate; keep 20% headroom
        self.assertLessEqual(len(self.FULL) / 3.5, ta.MAX_ANSWER_TOKENS * 0.8)

    def test_a_cut_off_answer_says_so(self):
        d = ta.parse_decision(self.FULL[:180], 0.3)
        self.assertEqual(d["action"], "none")
        self.assertIn("cut off", d["reason"])
        self.assertIn("not valid JSON", ta.parse_decision("enter yes now", 0.3)["reason"])


class PromptReadTests(unittest.TestCase):
    """Ruling #79 (2026-11-09) came back as just "{": the 300 s budget started before the ~3,500-token prompt was read."""

    def test_the_budget_starts_at_the_first_token_not_at_the_prompt_read(self):
        t = [0.0]

        def stream():
            t[0] += 280  # a long prompt read before the first token
            for piece in ['{"action": "none", ', '"p_yes": 0.4, ', '"reason": "r"}']:
                yield {"choices": [{"text": piece}]}
                t[0] += 2
        text, tokens, write_s, by_time, read_s = ta.generate_after_first_token(stream(), 360, 150, clock=lambda: t[0])
        self.assertEqual(text, '{"action": "none", "p_yes": 0.4, "reason": "r"}')
        self.assertFalse(by_time)
        self.assertEqual(read_s, 280)
        self.assertEqual(tokens, 3)

    def test_the_writing_budget_still_bounds_a_runaway_answer(self):
        t = [0.0]

        def stream():
            while True:
                yield {"choices": [{"text": "x"}]}
                t[0] += 10
        _, tokens, _, by_time, _ = ta.generate_after_first_token(stream(), 360, 150, clock=lambda: t[0])
        self.assertTrue(by_time)
        self.assertLessEqual(tokens, 16)

    def test_the_startup_loads_the_nexus_checkpoint_not_qwen(self):
        with open(os.path.join(os.path.dirname(__file__), "trader_agent.py")) as f:
            src = f.read()
        self.assertNotIn("qwen_gguf", src)  # the swap is total: no Qwen path remains in the agent
        main_src = src[src.index("def main():"):]
        self.assertIn("import nexus_model", main_src)
        self.assertIn("nexus_model.load_nexus()", main_src)  # raises unless the checkpoint hash is Run 25's
        self.assertIn("NexusThink", main_src)


class BootSmokeTests(unittest.TestCase):
    """main() end to end with a fake model engine and a fake desk: a boot crash (e.g. a name used before it is defined)
    fails here instead of on the runner."""

    def test_main_boots_rules_once_and_exits_clean(self):
        import types

        class FakeNexus:
            name = "nexus-run25"
            checkpoint_sha256 = "c41852fb" + "0" * 56
            params = 30_000_000
            ctx_limit = 640

            def count(self, t):
                return max(1, len(t) // 3)

            def generate(self, task):
                return "<|answer|>0.55 no clear edge in this window<|/answer|>"
        fake_nm = types.SimpleNamespace(load_nexus=lambda: FakeNexus())
        server = FakeServer()
        saved_session, saved_env = ta.McpSession, dict(os.environ)
        saved_nm = sys.modules.get("nexus_model")
        try:
            sys.modules["nexus_model"] = fake_nm
            ta.McpSession = lambda url, token: saved_session(url, token, post=server.post)
            os.environ.update({"NEXUS_MCP_URL": "https://bank.test/mcp", "NEXUS_OWNER_TOKEN": TOKEN, "AGENT_LOOP_MINUTES": "0"})
            os.environ.pop("NEXUS_SHADOW_URL", None)
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
            rc = ta.main()
        finally:
            ta.McpSession = saved_session
            os.environ.clear()
            os.environ.update(saved_env)
            if saved_nm is None:
                sys.modules.pop("nexus_model", None)
            else:
                sys.modules["nexus_model"] = saved_nm
        self.assertEqual(rc, 0)
        self.assertIn("predict", [c[0] for c in server.actions()])
        rec = [a for n, a in server.calls if n == "record_ruling"][0]
        self.assertEqual(rec["model"], "nexus-run25")  # rulings are attributable to Nexus
        self.assertEqual(len(rec["output"]["phases"]), 5)  # the 5-phase trace rides every ruling


class StaleTradesTests(unittest.TestCase):
    """2026-11-09 23:48 CST: a ruling said "the Observer did not trade in this window" while the desk had bought YES x15
    at 23:45:54, during its thinking. A review/directive/exit line judged on a desk that is gone is not sent."""

    def run_with_fill_during_thinking(self, fill):
        server = FakeServer()
        filled = dict(LIVE, intents=[{"intent_id": "KXBTC15M-T:observer:2:entry", "side": "yes", "purpose": "entry",
                                      "filled_hundredths": 1500, "avg_yes_price_micros": 670000, "created_at_ms": 999_000}])
        reads = []
        orig_post = server.post

        def post(body, headers):
            if body.get("params", {}).get("name") == "get_live_window":
                reads.append(1)
                if fill and len(reads) > 1:  # the first read is the picture the model judges; later reads come after
                    server.calls.append(("get_live_window", body["params"]["arguments"]))
                    return 200, {}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": json.dumps(filled)}], "isError": False}})
            return orig_post(body, headers)
        answer = '{"p_yes": 0.5, "action": "none", "reason": "r", "review": "The Observer did not trade in this window.", "directives": {"max_contracts": 2}, "exit_line_bps": -3}'
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=post), think_returning(answer), log=lambda s: None)
        return server, report

    def test_a_fill_while_thinking_voids_the_review_directives_and_exit_line(self):
        server, report = self.run_with_fill_during_thinking(True)
        names = [n for n, _ in server.calls]
        self.assertNotIn("direct_desk", names)
        self.assertNotIn("set_exit_line", names)
        self.assertTrue(report.get("recheck_now"))
        self.assertIn("the position changed while I was thinking", report["decision"]["directive_note"])
        self.assertIn("predict", names)  # the graded prediction still goes out

    def test_no_change_while_thinking_sends_them(self):
        server, report = self.run_with_fill_during_thinking(False)
        self.assertIn("direct_desk", [n for n, _ in server.calls])
        self.assertFalse(report.get("recheck_now"))

    def test_distance_alone_does_not_void_a_review(self):
        seen = {"ticker": "T", "distanceBps": 5.0, "position": (0, 0)}
        self.assertIsNone(ta.trades_changed(seen, dict(seen, distanceBps=12.0)))
        self.assertEqual(ta.trades_changed(seen, dict(seen, ticker="U")), "a new window opened")


class BlindRulingTests(unittest.TestCase):
    """2026-11-09 23:48 CST: a ruling read "BTC is None bps from the strike" -- the feed had timed out on that read."""

    def run_with_live(self, lives):
        server = FakeServer()
        orig_post, reads, thought = server.post, [], []

        def post(body, headers):
            if body.get("params", {}).get("name") == "get_live_window":
                live = lives[min(len(reads), len(lives) - 1)]
                reads.append(1)
                server.calls.append(("get_live_window", {}))
                return 200, {}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": json.dumps(live)}], "isError": False}})
            return orig_post(body, headers)
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=post),
                             lambda s, u: thought.append(u) or '{"p_yes": 0.6, "action": "none", "reason": "r"}',
                             log=lambda s: None, sleep=lambda s: None)
        return server, report, thought

    def test_no_distance_on_every_read_skips_without_thinking(self):
        blind = dict(LIVE, snapshot=dict(LIVE["snapshot"], distanceBps=None))
        server, report, thought = self.run_with_live([blind])
        self.assertEqual(thought, [])
        self.assertIn("not ruling blind", report["skipped"])
        self.assertNotIn("predict", [n for n, _ in server.calls])

    def test_a_reread_that_recovers_rules_on_the_good_picture(self):
        blind = dict(LIVE, snapshot=dict(LIVE["snapshot"], distanceBps=None))
        server, report, thought = self.run_with_live([blind, LIVE])
        self.assertEqual(len(thought), 1)
        self.assertIn("BTC 15.0 bps", thought[0])
        self.assertNotIn("skipped", report)

    def test_blind_reason(self):
        self.assertIsNone(ta.blind_reason({"live": LIVE}))
        self.assertEqual(ta.blind_reason({"live": {}}), "the feed gave no window")


class OpenPositionFactTests(unittest.TestCase):
    """2026-11-09 00:08-00:40 CST: reviews said "held the position to settlement" while NO x4 @ 78c was still open, and
    applied the 80c hold to it."""

    def intent(self, iid, side, purpose, n, yes_c, at):
        return {"intent_id": f"T:observer:{iid}", "side": side, "purpose": purpose, "filled_hundredths": n * 100,
                "avg_yes_price_micros": yes_c * 10_000, "created_at_ms": at}

    def test_the_0145_window(self):
        live = dict(LIVE, intents=[self.intent("4:entry", "no", "entry", 5, 44, 1), self.intent("43:stop10", "no", "exit", 5, 50, 2),
                                   self.intent("84:entry", "no", "entry", 4, 22, 3)])
        line = ta.desk_trades_lines(live)[0]
        self.assertIn("OPEN NOW: NO x4 bought at 78c (under 80c: not an 80c+ hold)", line)
        self.assertIn("has NOT been held to settlement", line)

    def test_flat_and_strong_side(self):
        flat = dict(LIVE, intents=[self.intent("4:entry", "no", "entry", 5, 44, 1), self.intent("43:stop10", "no", "exit", 5, 50, 2)])
        self.assertIn("Nothing is open now.", ta.desk_trades_lines(flat)[0])
        strong = dict(LIVE, intents=[self.intent("9:entry", "yes", "entry", 3, 85, 1)])
        self.assertIn("OPEN NOW: YES x3 bought at 85c (80c or more: the strong-side hold applies)", ta.desk_trades_lines(strong)[0])

    def test_rule_12_says_open_is_not_settled(self):
        self.assertIn('An OPEN position has not been "held to settlement"', ta.SYSTEM)


class ReviewTruthTagTests(unittest.TestCase):
    """2026-11-09 01:36 and 01:39 CST: "held the position to settlement" with YES x4 @ 79c open, despite the #394 fact."""

    def test_tags_a_settled_claim_only_while_open(self):
        r = "The Observer held a position to settlement, showing patience and confidence in the thesis."
        self.assertEqual(ta.review_contradiction(r, (400, 0)), "not so: the position is still open and the window has not settled")
        self.assertIsNone(ta.review_contradiction(r, (0, 0)))
        self.assertIsNone(ta.review_contradiction("The Observer entered YES at 61c and the Preserver exited at 79c.", (400, 0)))
        self.assertIsNone(ta.review_contradiction(None, (400, 0)))

    def test_the_tag_reaches_the_directive_reason(self):
        server = FakeServer()
        open_live = dict(LIVE, intents=[{"intent_id": "T:observer:87:entry", "side": "yes", "purpose": "entry",
                                         "filled_hundredths": 400, "avg_yes_price_micros": 790_000, "created_at_ms": 1}])
        orig = server.post

        def post(body, headers):
            if body.get("params", {}).get("name") == "get_live_window":
                server.calls.append(("get_live_window", {}))
                return 200, {}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {"content": [{"type": "text", "text": json.dumps(open_live)}], "isError": False}})
            return orig(body, headers)
        answer = '{"p_yes": 0.6, "action": "none", "reason": "r", "review": "The Observer held the position to settlement."}'
        ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=post), think_returning(answer), log=lambda s: None, sleep=lambda s: None)
        reason = [a for n, a in server.calls if n == "direct_desk"][0]["reason"]
        self.assertIn("[not so: the position is still open", reason)


class WorkflowTests(unittest.TestCase):
    def test_workflow_defaults_live_and_keeps_the_token_in_secrets(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "workflows", "trader-agent.yml")) as f:
            wf = f.read()
        self.assertIn("AGENT_MODE: ${{ vars.AGENT_MODE || 'live' }}", wf)
        self.assertIn("NEXUS_OWNER_TOKEN: ${{ secrets.NEXUS_OWNER_TOKEN }}", wf)
        self.assertIn("persist-credentials: false", wf)
        self.assertIn("permissions:\n  contents: read\n  actions: write", wf)
        # the standing chain: loop length, crash guard, owner off-switch, re-queue to main
        self.assertIn("AGENT_LOOP_MINUTES: '320'", wf)
        self.assertIn('if [ "$ran" -lt 1200 ]', wf)
        self.assertIn("vars.AGENT_STANDING != 'off'", wf)
        self.assertIn("""-d '{"ref":"main"}'""", wf)
        self.assertIn("timeout-minutes: 350", wf)


if __name__ == "__main__":
    unittest.main()


class FakeNexusModel:
    """The nexus_model surface NexusThink needs, with a canned transcript."""

    name = "nexus-run25"

    def __init__(self, transcript):
        self.transcript = transcript

    def count(self, t):
        return max(1, len(t) // 3)

    def generate(self, task):
        return self.transcript


def nexus_obs(live=None, status=None, fair=None, edges=None):
    return {"status": status or STATUS, "live": live or LIVE,
            "fair": fair or {"p_yes": 0.62, "left_s": 420, "sigma_1m_bps": 4.0, "sigma_measured": True},
            "edges": edges or {"yes": 2.5, "no": -4.0}, "record": {}}


PROPOSE_YES = ('<|call|>{"name": "funds_propose", "arguments": {"venue": "kalshi", "market": "KXBTC15M-T", '
               '"side": "yes", "price": 0.6, "probability": 0.65, "rationale": "momentum favors YES", '
               '"sources": []}}<|/call|>')


class NexusWireTests(unittest.TestCase):
    """Owner order 2026-11-10: the Run 25 checkpoint rules in Qwen's place, in its own funds grammar."""

    def test_a_grounded_proposal_becomes_an_entry(self):
        d = ta.parse_nexus_transcript(PROPOSE_YES, nexus_obs(), 0.59)
        self.assertTrue(d["valid"])
        self.assertEqual((d["action"], d["p_yes"]), ("enter_yes", 0.65))

    def test_a_proposal_on_another_window_is_void(self):
        t = PROPOSE_YES.replace("KXBTC15M-T", "KXBTC15M-OTHER")
        d = ta.parse_nexus_transcript(t, nexus_obs(), 0.59)
        self.assertFalse(d["valid"])
        self.assertEqual(d["action"], "none")

    def test_an_ungrounded_price_is_void(self):
        t = PROPOSE_YES.replace('"price": 0.6', '"price": 0.3')
        d = ta.parse_nexus_transcript(t, nexus_obs(), 0.59)
        self.assertFalse(d["valid"])
        self.assertEqual(d["action"], "none")

    def test_a_direct_answer_states_its_probability_and_passes(self):
        d = ta.parse_nexus_transcript("<|answer|>0.55 the edge is thin after fees<|/answer|>", nexus_obs(), 0.59)
        self.assertTrue(d["valid"])
        self.assertEqual((d["action"], d["p_yes"]), ("none", 0.55))

    def test_an_answer_without_a_probability_fails_closed(self):
        d = ta.parse_nexus_transcript("<|answer|>looks fine to me<|/answer|>", nexus_obs(), 0.59)
        self.assertFalse(d["valid"])
        self.assertEqual(d["action"], "none")

    def test_garbage_fails_closed(self):
        d = ta.parse_nexus_transcript("lorem ipsum no grammar here", nexus_obs(), 0.59)
        self.assertFalse(d["valid"])

    def test_the_task_fits_the_window_and_names_the_channel(self):
        task, trimmed = ta.build_nexus_task(nexus_obs(), count=lambda t: max(1, len(t) // 3))
        self.assertFalse(trimmed)
        self.assertIn("KXBTC15M-T", task)
        self.assertIn("funds_propose", task)
        self.assertLessEqual(max(1, len(task) // 3), 640 - ta.NEXUS_MAX_NEW - 10)

    def test_the_phase_trace_names_all_five_phases_and_their_authors(self):
        d = ta.parse_nexus_transcript(PROPOSE_YES, nexus_obs(), 0.59)
        phases = ta.build_nexus_phases(nexus_obs(), d)
        self.assertEqual([p["phase"] for p in phases],
                         ["assumptions", "heuristics", "first_principles", "extension", "convergence"])
        self.assertTrue(all(p["by"] in ("nexus", "harness") for p in phases))
        self.assertEqual(phases[1]["by"], "nexus")  # the model's own read, in its own words

    def test_run_once_enters_and_files_the_ruling_under_nexus(self):
        server, logs = FakeServer(), []
        think = ta.NexusThink(FakeNexusModel(PROPOSE_YES), log=logs.append)
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think,
                             log=logs.append, model_name="nexus-run25")
        self.assertEqual(report["decision"]["action"], "enter_yes")
        self.assertIn("enter", [c[0] for c in server.actions()])
        rec = [a for n, a in server.calls if n == "record_ruling"][0]
        self.assertEqual(rec["model"], "nexus-run25")
        self.assertIn("funds_propose", rec["output"]["raw"])  # the raw transcript, untranslated
        self.assertEqual(len(rec["output"]["phases"]), 5)

    def test_the_discipline_gate_still_blocks_a_thin_edge_proposal(self):
        propose_no = PROPOSE_YES.replace('"side": "yes", "price": 0.6, "probability": 0.65',
                                         '"side": "no", "price": 0.42, "probability": 0.62')
        server, logs = FakeServer(), []
        think = ta.NexusThink(FakeNexusModel(propose_no), log=logs.append)
        report = ta.run_once(ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post), think,
                             log=logs.append, model_name="nexus-run25")
        self.assertEqual(report["decision"]["action"], "none")  # the coded gate, not the model, has the last word
        self.assertNotIn("enter", [c[0] for c in server.actions()])


class RolloverTests(unittest.TestCase):
    """Owner order 2026-11-10: when a mandate ends, the agent sets the next one itself —
    stake = current equity, goal = stake + 200c, expiry = 4 days."""

    def rollover(self, status):
        import test_trader_agent as self_mod
        server = FakeServer()
        saved = self_mod.STATUS
        self_mod.STATUS = status
        try:
            mcp = ta.McpSession("https://bank.test/mcp", TOKEN, post=server.post)
            mcp.initialize()
            result = ta.maybe_rollover_mandate(mcp, log=lambda s: None)
        finally:
            self_mod.STATUS = saved
        return server, result

    def test_an_ended_mandate_rolls_over_on_the_owners_terms(self):
        server, result = self.rollover({**STATUS, "mandate": {"id": "m-1", "state": "expired"}})
        starts = [a for n, a in server.calls if n == "start_mandate"]
        self.assertEqual(len(starts), 1)
        self.assertEqual(starts[0]["stake_usd"], 10.01)   # equity 1001c, in dollars
        self.assertEqual(starts[0]["goal_usd"], 12.01)    # stake + 200c
        self.assertEqual(starts[0]["expiry_minutes"], 4 * 24 * 60)
        self.assertIsNotNone(result)

    def test_no_mandate_at_all_rolls_over(self):
        st = {k: v for k, v in STATUS.items() if k != "mandate"}
        server, _ = self.rollover(st)
        self.assertEqual(len([a for n, a in server.calls if n == "start_mandate"]), 1)

    def test_a_live_mandate_is_left_alone(self):
        server, result = self.rollover(STATUS)  # fixture mandate is active
        self.assertIsNone(result)
        self.assertEqual([a for n, a in server.calls if n == "start_mandate"], [])

    def test_the_kill_switch_wins(self):
        server, result = self.rollover({**STATUS, "killed": True, "mandate": None})
        self.assertIsNone(result)
        self.assertEqual([a for n, a in server.calls if n == "start_mandate"], [])

    def test_unreadable_equity_never_sizes_a_stake(self):
        st = {k: v for k, v in STATUS.items() if k != "equityCents"}
        server, result = self.rollover({**st, "mandate": None})
        self.assertIsNone(result)
        self.assertEqual([a for n, a in server.calls if n == "start_mandate"], [])
