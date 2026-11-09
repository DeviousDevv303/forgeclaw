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
        return [c for c in self.calls if not c[0].startswith("get_") and c[0] not in ("share_thinking", "record_ruling")]


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
        self.assertLessEqual(ta.MAX_ANSWER_TOKENS, 200)
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

    def test_the_workflow_takes_the_shadow_from_a_variable_and_a_secret(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "workflows", "trader-agent.yml")) as f:
            wf = f.read()
        self.assertIn("NEXUS_SHADOW_URL: ${{ vars.NEXUS_SHADOW_URL }}", wf)
        self.assertIn("NEXUS_SHADOW_TOKEN: ${{ secrets.NEXUS_SHADOW_TOKEN }}", wf)


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
