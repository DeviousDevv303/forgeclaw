"""The Nexus Trader agent: plan -> act -> check -> adjust, once per 15-minute window, with nobody there.

Owner order (2026-11-08, verbatim): "They can do everything. Kill switch, hold, exit, entry, bet down, bet up.
They do everything autonomously. That's the whole point." and "I wanted to enter, hold, exit, bet down, bet up,
everything, predict, kill switch, everything." So the agent runs LIVE by default: it acts through every desk tool
with no stage to graduate from and no owner tap. AGENT_MODE=shadow exists only as an operator/test switch (it
predicts and logs, but sends no action); a test locks the default to live.

How it acts: over MCP (Streamable HTTP JSON-RPC) against the Nexus Trader server (nexus-trader POST /mcp), which runs
every action through the Bank's own routes, so the desk's reflexes (cross-stop, floor guard, order gate) stay
underneath. Every action carries a reason and is journaled on the Bank, so the owner watches the agent work live.

How it thinks: Qwen3-8B (the repo's GGUF via qwen_gguf.py) reads the desk and answers one JSON decision. An answer
that is not valid JSON, or names an action outside the list, is never guessed at: the agent records the market's
own probability as its prediction and takes no action, and says so.

The owner token is read from the environment and is never printed (every outbound text passes through redact()).
"""
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_AGENT_MODE = "live"
AGENT_MODES = ("live", "shadow")
ACTIONS = {
    "none": None,
    "enter_yes": ("enter", {"side": "yes"}),
    "enter_no": ("enter", {"side": "no"}),
    "exit": ("exit", {}),
    # Named for what they do: the desk's "hold" pauses NEW ENTRIES; it is not "hold the position" (run 42534021710
    # read it that way). Doing nothing, and letting an open position ride, is "none".
    "pause_entries": ("set_hold", {"phase": "held"}),
    "resume_entries": ("set_hold", {"phase": "done"}),
    "kill": ("set_kill_switch", {"killed": True}),
    "unkill": ("set_kill_switch", {"killed": False}),
}
USER_AGENT = "forgeclaw-trader-agent/1"


def agent_mode(env=os.environ):
    mode = (env.get("AGENT_MODE") or DEFAULT_AGENT_MODE).strip().lower()
    return mode if mode in AGENT_MODES else DEFAULT_AGENT_MODE


def redact(text, secret):
    return text.replace(secret, "[redacted]") if secret and len(secret) >= 4 else text


class McpError(Exception):
    pass


class McpSession:
    """A minimal MCP Streamable HTTP client: initialize, notifications/initialized, tools/call."""

    def __init__(self, url, token, post=None, timeout_s=30):
        self.url, self.token, self.timeout_s = url, token, timeout_s
        self.session_id = None
        self.protocol = "2025-06-18"
        self._id = 0
        self._post = post or self._http_post

    def _http_post(self, body, headers):
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                return r.status, dict(r.headers), r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), e.read().decode(errors="replace")

    def _headers(self, initialized):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": USER_AGENT,
             "Authorization": f"Bearer {self.token}"}
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        if initialized:
            h["MCP-Protocol-Version"] = self.protocol
        return h

    def rpc(self, method, params=None, initialized=True):
        self._id += 1
        status, headers, raw = self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}, self._headers(initialized))
        if status != 200:
            raise McpError(redact(f"{method}: HTTP {status} {raw[:200]}", self.token))
        sid = headers.get("Mcp-Session-Id") or headers.get("mcp-session-id")
        if sid:
            self.session_id = sid
        try:
            msg = json.loads(raw)
        except ValueError:
            # An SSE reply: take the data line carrying our id.
            msg = None
            for line in raw.splitlines():
                if line.startswith("data:"):
                    try:
                        cand = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    if isinstance(cand, dict) and cand.get("id") == self._id:
                        msg = cand
            if msg is None:
                raise McpError(f"{method}: unreadable reply")
        if "error" in msg:
            raise McpError(redact(f"{method}: {msg['error'].get('message')}", self.token))
        return msg.get("result")

    def initialize(self):
        r = self.rpc("initialize", {"protocolVersion": self.protocol, "capabilities": {}, "clientInfo": {"name": "forgeclaw-trader-agent", "version": "1"}}, initialized=False)
        self.protocol = (r or {}).get("protocolVersion", self.protocol)
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, self._headers(True))
        except Exception:
            pass

    def tool(self, name, args=None):
        r = self.rpc("tools/call", {"name": name, "arguments": args or {}}) or {}
        text = "\n".join(c.get("text", "") for c in r.get("content", []) if isinstance(c, dict))
        try:
            data = json.loads(text)
        except ValueError:
            data = text
        return {"ok": not r.get("isError"), "data": data, "text": text}


def observe(mcp):
    obs = {
        "status": mcp.tool("get_status")["data"],
        "live": mcp.tool("get_live_window")["data"],
        "history": mcp.tool("get_trade_history", {"limit": 8})["data"],
        "record": mcp.tool("get_prediction_record", {"limit": 5})["data"],
    }
    live = obs["live"] if isinstance(obs["live"], dict) else {}
    obs["fair"] = fair_value(live)
    obs["edges"] = edges(obs["fair"], live.get("snapshot"))
    return obs


def market_p_yes(live):
    snap = (live or {}).get("snapshot") or {}
    yb, ya = snap.get("yesBidCents"), snap.get("yesAskCents")
    if isinstance(yb, (int, float)) and isinstance(ya, (int, float)):
        return round((yb + ya) / 200, 3)
    return None


IV_MULT = 1.15            # implied-vol multiplier fitted to Kalshi minute marks (the desk's benchmark)
DEFAULT_SIGMA_1M_BPS = 6.0  # typical 1-minute BTC move when the tape is too short to measure
MIN_EDGE_CENTS = 0.5      # owner order 2026-11-08: take the best edge each window, even if thin — an entry needs a positive edge after fees
# The model thinks for up to ~110 s on the CPU runner (run 42534021710: 108 s). With less time than this left in the window,
# its decision would land after the close (that run's prediction was refused: "no open window"), so it does not start.
MIN_SECONDS_TO_DECIDE = 150


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def kalshi_fee_cents(price_cents):
    """Kalshi's taker fee per contract, about 7% of p(1-p)."""
    p = max(0.0, min(100.0, float(price_cents))) / 100
    return 7 * p * (1 - p)


def sigma_1m_bps(samples, now_s):
    """RMS of the last five 1-minute distance changes (bps), from the window tape [[seconds, bps], ...]."""
    pts = sorted((float(t), float(d)) for t, d in (samples or []) if isinstance(t, (int, float)) and isinstance(d, (int, float)))
    if not pts:
        return None, 0

    def at(sec):
        best = None
        for t, d in pts:
            if t <= sec:
                best = d
        return best
    moves = []
    for k in range(5):
        a, b = at(now_s - 60 * k), at(now_s - 60 * (k + 1))
        if a is not None and b is not None and now_s - 60 * (k + 1) >= pts[0][0]:
            moves.append(a - b)
    if len(moves) < 2:
        return None, len(moves)
    return math.sqrt(sum(m * m for m in moves) / len(moves)), len(moves)


def fair_value(live):
    """The desk's fair P(YES): Phi(distance / (sigma * sqrt(time left))), sigma from the window's own tape (x1.15)."""
    w = (live or {}).get("window") or {}
    snap = (live or {}).get("snapshot") or {}
    now_ms, close_ms, start_ms = live.get("now") if live else None, w.get("closeTimeMs"), w.get("startedAtMs")
    d = snap.get("distanceBps")
    if not all(isinstance(x, (int, float)) for x in (now_ms, close_ms, d)):
        return None
    left_s = max(1.0, (close_ms - now_ms) / 1000 + 20)  # +20 s: the settlement averages the final minute
    now_s = (now_ms - start_ms) / 1000 if isinstance(start_ms, (int, float)) else None
    s1m, n = sigma_1m_bps(w.get("samples"), now_s) if now_s is not None else (None, 0)
    measured = s1m is not None and s1m > 0
    # Fewer than five 1-minute moves (the first minutes of a window) under-measure a jumpy market: 1930 on 2026-11-08 swung
    # -8.6 -> +21.5 bps in two minutes while a 3-move tape read calm, and the fair said 0.96 against the market's 0.59.
    # A short tape may raise sigma above the default, never lower it.
    if not measured:
        s1m = DEFAULT_SIGMA_1M_BPS
    elif n < 5:
        s1m = max(s1m, DEFAULT_SIGMA_1M_BPS)
    sigma_per_s = max(s1m, 0.5) / math.sqrt(60) * IV_MULT
    return {"p_yes": phi(d / (sigma_per_s * math.sqrt(left_s))), "sigma_1m_bps": round(s1m, 2), "sigma_measured": measured, "left_s": round(left_s - 20)}


MARKET_WEIGHT = 0.5  # playbook 1: the market mid out-predicts the formula; the edge is priced on a 50/50 blend


def blended_p_yes(fair, snap):
    """The probability the edge is priced on: half the formula, half the market mid (when the book has one)."""
    yb, ya = (snap or {}).get("yesBidCents"), (snap or {}).get("yesAskCents")
    if not fair:
        return None
    if isinstance(yb, (int, float)) and isinstance(ya, (int, float)) and 0 < yb <= ya < 100:
        return MARKET_WEIGHT * (yb + ya) / 200 + (1 - MARKET_WEIGHT) * fair["p_yes"]
    return fair["p_yes"]


def edges(fair, snap):
    """Cents of edge per contract after the entry fee, for buying each side at its ask (held to settlement), priced on
    the formula blended with the market mid."""
    p_yes = blended_p_yes(fair, snap)
    if p_yes is None:
        return {"yes": None, "no": None}
    out = {}
    for side, ask_key, p in (("yes", "yesAskCents", p_yes), ("no", "noAskCents", 1 - p_yes)):
        ask = (snap or {}).get(ask_key)
        out[side] = round(100 * p - ask - kalshi_fee_cents(ask), 1) if isinstance(ask, (int, float)) else None
    return out


def trend(live, seconds):
    w = (live or {}).get("window") or {}
    pts = [(t, d) for t, d in (w.get("samples") or []) if isinstance(t, (int, float)) and isinstance(d, (int, float))]
    if len(pts) < 2:
        return None
    t_now, d_now = pts[-1]
    past = [d for t, d in pts if t <= t_now - seconds]
    return round(d_now - past[-1], 1) if past else None


SYSTEM = """You run the Nexus Trader desk on Kalshi's 15-minute BTC markets, with full authority over the book.
A window pays $1 per contract on the right side: YES if BTC settles at or above the strike, NO if below.

THE DESK'S PLAYBOOK (learned from its own money; the numbers are measured, not opinions):
1. The market price is about as good a forecast as exists. Over 341 real settled windows the market mid beat a model
   trained on 10 years of BTC. You only have an edge when the FAIR value below differs from the ask by more than fees.
2. Fees eat careless trading: about 1.7c per contract each way at a 50c price. The desk has paid over $7.80 in fees
   today. The owner's order (2026-11-08): take the best edge each window, even if it is thin — when either side's
   edge after fees is positive, the better side is a trade. "none" is for when neither side beats its ask after fees.
3. Never sell a winning position whose thesis is intact. When the desk sold positions while BTC was still on their
   side of the strike, 11 of 11 were eventual winners (-$69 in replay). But you rule the book (owner order 2026-11-08):
   when an open position's thesis breaks or its profit peak is rolling over, exit it yourself to save the profit —
   that call is yours, over the sheet. The desk's stop sells at 2 bps past the strike; your exit is for before that,
   while there is still profit to save.
4. Chop near the strike kills both sides. With BTC within ~3 bps of the strike, entries get stopped out on each side
   (window 1730: -$2.46 from one YES and one NO). Do not enter when |distance| < 3 bps.
5. Never chase: no entry above 85c (window 0330 re-bought at 91.8c and 97.5c and lost $11.83). After two losing
   positions in a window, stop for that window (window 0500: five round trips). The desk enforces these, but do not try.
6. Late in a window with BTC far from the strike, the price already says so: there is nothing left to win.
7. Kill switch: only for a broken desk (no prices, wrong data, orders failing). Unkill it if the data is healthy again.
8. The Observer and the Preserver are trading again (owner order 2026-11-08) and you work as a team: the sheet is
   fast and takes its own entries, the Preserver guards the sheet's exits, and you are the judgment over the book.
   Protect any open position — yours or the Observer's — when you see its profit bleeding, and enter yourself
   whenever you see an edge the sheet cannot see. Your call on a position overrides the sheet's.
9. Your scorecard compares your calls with the market's. If your Brier score is worse than the market's, stay closer to
   the market price in your p_yes.

10. "none" means change nothing: an open position keeps riding to settlement. "pause_entries" stops the desk's NEW entries
   (it never closes a position); "resume_entries" lifts that pause. Do not use them to mean "keep my position".

Think first, then decide. Answer with ONE JSON object and nothing else:
{"analysis": "<2-3 short sentences: where BTC is vs the strike and trending, the fair value vs the asks after fees, the risk>",
 "p_yes": <your probability 0..1 that this window settles YES>,
 "action": "none" | "enter_yes" | "enter_no" | "exit" | "pause_entries" | "resume_entries" | "kill" | "unkill",
 "reason": "<one sentence the owner will read>"}"""


def build_user_prompt(obs):
    st = obs.get("status") or {}
    live = obs.get("live") or {}
    w = (live.get("window") or {})
    snap = (live.get("snapshot") or {})
    fair, edge = obs.get("fair"), obs.get("edges") or {}
    rec = obs.get("record") or {}
    lines = [
        f"Window {w.get('ticker')}: {fair['left_s'] if fair else '?'}s left, strike ${w.get('strikeUsd')}, BTC {snap.get('distanceBps') if snap.get('distanceBps') is None else round(snap['distanceBps'], 1)} bps "
        f"from the strike (positive = above). Change: {trend(live, 60)} bps in the last minute, {trend(live, 180)} bps in the last 3 minutes.",
        f"Book: YES {snap.get('yesBidCents')}/{snap.get('yesAskCents')}c, NO {snap.get('noBidCents')}/{snap.get('noAskCents')}c. Market P(YES) = {market_p_yes(live)}.",
        (f"Fair P(YES) = {fair['p_yes']:.3f} by formula (1-minute BTC move {fair['sigma_1m_bps']} bps, {'measured' if fair['sigma_measured'] else 'default'}); "
         f"blended with the market: {blended_p_yes(fair, snap):.3f}. "
         f"Edge after fees if you buy now: YES {edge.get('yes')}c, NO {edge.get('no')}c per contract (need +{MIN_EDGE_CENTS:g}c)." if fair else "Fair value: unavailable (no distance or clock)."),
        f"Desk: equity {st.get('equityCents')}c, kill switch {'ON' if st.get('killed') else 'off'}, hold {json.dumps(st.get('hold'))}, "
        f"open position {json.dumps(st.get('openMark'))}.",
        f"Observer's last decision: {json.dumps(live.get('lastDecision'))}.",
        f"Recent trades: {json.dumps(obs.get('history'))[:700]}",
        f"Your scorecard: {json.dumps({k: rec.get(k) for k in ('graded', 'agentBrier', 'marketBrier')})}",
        "Decide now.",
    ]
    return "\n".join(lines)


def parse_decision(text, fallback_p):
    """Strictly parse the model's JSON decision. Anything invalid becomes 'none' with the market's probability."""
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except ValueError:
        d = None
    if not isinstance(d, dict):
        return {"p_yes": fallback_p, "action": "none", "reason": "model answer was not valid JSON; no action taken", "valid": False}
    action = d.get("action") if d.get("action") in ACTIONS else None
    p = d.get("p_yes")
    p = float(p) if isinstance(p, (int, float)) and 0 <= float(p) <= 1 else fallback_p
    reason = str(d.get("reason") or "").strip()[:280]
    analysis = str(d.get("analysis") or "").strip()[:600]
    if action is None or not reason:
        return {"p_yes": p, "action": "none", "reason": reason or "model named no valid action; no action taken", "valid": False, "analysis": analysis}
    return {"p_yes": p, "action": action, "reason": reason, "valid": True, "analysis": analysis}


def apply_discipline(decision, obs):
    """Code, not the model, holds the playbook's money rules the desk does not enforce itself: an entry needs at least
    MIN_EDGE_CENTS of edge after fees (playbook 2) and BTC at least 3 bps from the strike (playbook 4). A blocked
    entry becomes "none" and says why; the prediction is kept."""
    side = {"enter_yes": "yes", "enter_no": "no"}.get(decision["action"])
    if side is None:
        return decision
    edge = (obs.get("edges") or {}).get(side)
    dist = ((obs.get("live") or {}).get("snapshot") or {}).get("distanceBps")
    why = None
    if edge is None:
        why = "no fair value to price the entry"
    elif edge < MIN_EDGE_CENTS:
        why = f"edge {edge}c after fees is under +{MIN_EDGE_CENTS:g}c"
    elif isinstance(dist, (int, float)) and abs(dist) < 3:
        why = f"BTC is {abs(dist):.1f} bps from the strike (chop zone, under 3 bps)"
    if why is None:
        return decision
    return {**decision, "action": "none", "blocked": decision["action"], "reason": f"{decision['reason']} [discipline: {decision['action']} blocked, {why}]"}


def run_once(mcp, think, mode=DEFAULT_AGENT_MODE, log=print):
    """One plan -> act -> check cycle. `think(system, user) -> str` is the model. Returns a report dict."""
    mcp.initialize()
    obs = observe(mcp)
    fallback = market_p_yes(obs.get("live"))
    fair = obs.get("fair")
    if fair and fair.get("left_s") is not None and fair["left_s"] < MIN_SECONDS_TO_DECIDE:
        report = {"mode": mode, "skipped": f"{fair['left_s']}s left in the window: a decision would land after the close", "fair": fair, "acted": [], "checked": None}
        log(json.dumps(report))
        return report
    user = build_user_prompt(obs)
    t0 = time.monotonic()
    answer = think(SYSTEM, user)
    decision = parse_decision(answer, fallback if fallback is not None else 0.5)
    decision = apply_discipline(decision, obs)
    report = {"mode": mode, "decision": decision, "fair": obs.get("fair"), "edges": obs.get("edges"), "think_s": round(time.monotonic() - t0, 1), "acted": [], "checked": None}
    # Predict always (the scorecard grades it), whatever the action.
    if decision["p_yes"] is not None:
        r = mcp.tool("predict", {"p_yes": decision["p_yes"], "reason": decision["reason"]})
        report["acted"].append({"tool": "predict", "ok": r["ok"]})
    spec = ACTIONS.get(decision["action"])
    if spec is not None:
        if mode == "live":
            name, args = spec
            r = mcp.tool(name, {**args, "reason": decision["reason"]})
            report["acted"].append({"tool": name, "args": args, "ok": r["ok"], "result": r["text"][:300]})
        else:
            report["acted"].append({"tool": spec[0], "args": spec[1], "ok": None, "result": "shadow mode: not sent"})
    # Check: read the desk back after acting.
    after = mcp.tool("get_status")["data"]
    if isinstance(after, dict):
        report["checked"] = {"killed": after.get("killed"), "equityCents": after.get("equityCents"), "openTickers": after.get("openTickers"), "hold": after.get("hold")}
    log(json.dumps(report))
    return report


def main():
    url = os.environ.get("NEXUS_MCP_URL", "").strip()
    token = os.environ.get("NEXUS_OWNER_TOKEN", "")
    if not url or not token:
        print("::error::NEXUS_MCP_URL and the NEXUS_OWNER_TOKEN secret must be set for the trader agent to run")
        return 2
    mode = agent_mode()
    sys.path.insert(0, os.path.dirname(__file__))
    import qwen_gguf  # noqa: E402  (the repo's own model loader)
    from huggingface_hub import hf_hub_download, list_repo_files  # noqa: E402
    from llama_cpp import Llama  # noqa: E402
    cache = os.path.expanduser("~/.cache/forgeclaw-gguf")
    llm, name = qwen_gguf.load_model(cache, lambda repo: list_repo_files(repo), lambda repo, f, d: hf_hub_download(repo, f, local_dir=d), Llama)

    def think(system, user):
        stream = llm(qwen_gguf.build_prompt(system, user), max_tokens=360, temperature=0.2, stop=qwen_gguf.STOP, stream=True)
        text, _, _, _ = qwen_gguf.generate(stream, 360, 300)
        return text

    try:
        report = run_once(McpSession(url, token), think, mode=mode, log=lambda s: print(redact(s, token)))
    except McpError as e:
        print(f"::error::{redact(str(e), token)}")
        return 1
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            if "skipped" in report:
                f.write(f"### Trader agent ({mode})\n- skipped: {report['skipped']}\n")
                return 0
            d = report["decision"]
            f.write(f"### Trader agent ({mode})\n- thinking: {d.get('analysis', '')}\n- fair {json.dumps(report.get('fair'))} · edges {json.dumps(report.get('edges'))}\n- P(YES) {d['p_yes']} · action **{d['action']}** · {d['reason']}\n- acted: {json.dumps(report['acted'])}\n- desk after: {json.dumps(report['checked'])}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
