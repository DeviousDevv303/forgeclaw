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
import hashlib
import json
import math
import os
import re
import sys
import threading
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
# its decision would land after the close (that run's prediction was refused: "no open window"), so it does not start
# on THIS window — it waits for the next one instead (owner order 2026-11-08: the AI rules every window; run
# 42541804428 landed 36 s before a close, skipped, and the desk went unruled for two windows).
MIN_SECONDS_TO_DECIDE = 150
# The recorded prediction is pulled halfway to the blended fair value (formula + market). 2045 on 2026-11-08: BTC 20 bps
# above the strike with 5 minutes left, market 0.85, the model said 0.56; across its first 7 graded windows its Brier was
# 0.0727 vs the market's 0.0690. Playbook 9 asked for this; code now does it.
PREDICTION_ANCHOR = 0.5
WINDOW_ROLL_S = 10        # after a window closes, give the Bank a few seconds to roll to the next one
MAX_WINDOW_WAIT_S = 300   # total wait budget: setup (~70 s) + model load + this + think (<=300 s) stays inside the 12-min job


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


MARKET_WEIGHT = 0.75  # playbook 1: the market mid out-predicts the formula (341 windows). 0.5 let the formula drive trades: 2115 (2026-11-08) priced YES 0.67 vs a 0.80 market, read +4.4c NO edge, bought NO and was stopped out


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
11. You think for a minute or two; the market can turn in seconds (window 2200: entry to stop-out in 48 s). So whenever the
   desk holds a position, set "exit_line_bps": where the desk should sell it the moment BTC gets there, before you look
   again. It is in bps past the strike AGAINST the position: -3 = sell if BTC comes within 3 bps of the strike while still
   on our side, 0 = sell at the strike. Range -15..2; null = leave it to the desk's own stop (2 bps past the strike).
   Remember lesson 3: a line too close sells winners on noise, so tighten it only when momentum is turning against us.
12. You rule the desk. Its Observer enters on its own every tick and its stops sell on their own; you see their trades
   below. In "review", say in one sentence what THEIR TRADES LISTED BELOW show they did right or wrong -- name the side,
   price and what happened from that list; if the list says the desk has not traded, say exactly that and nothing more.
   An OPEN position has not been "held to settlement" -- the window has not closed; say it is open. Apply the 80c hold
   only to a position the list says was bought at 80c or more.
   In "directives", steer the Observer for THIS window: block_entry_side ("yes",
   "no", "both" or null), min_entry_bps (only enter when BTC is at least this far from the strike, 3..30, or null),
   max_contracts (1..100 or null). They can only make it more careful, and they end with the window. Use them when the
   tape is choppy or the desk keeps getting stopped; leave them null when it is trading well.
13. RECOVERY MODE (owner order 2026-11-08): the desk's floor is gone and the book is rebuilding from a hole. While
   the equity shown below is under 1000c ($10): enter only at |distance| >= 5 bps, set your directives'
   min_entry_bps to 5 or higher, set an exit line on every held position from your first look at it, and treat the
   stake as precious — one bad window is a large share of the book. The desk itself refuses closer entries in
   recovery; work with that, not against it. At 1000c or more, trade the playbook exactly as written above.
14. Ground every claim: say only what the desk's trades and the feed below actually show. Never state a window's
   result — won, lost, settled, or a net — unless the feed shows that window CLOSED with its net; a window still
   open has no result yet, and a review written before settlement that names one is a fabrication. When you are
   unsure what happened, describe what you saw, not what you assume. The same law covers the distance: your
   analysis restates the feed's distance with its sign intact — if the feed says BTC is -10 bps from the strike,
   your analysis says 10 bps BELOW the strike. A flipped sign is a fabrication (caught live 2026-11-08: the feed
   said -10.0, the analysis wrote "10.0 above", and the ruling anchored on the wrong side of the strike).
15. Exit lines are a duty, not an option (this sharpens 11): while the desk holds a position, never leave
   exit_line_bps null on two looks in a row. If its profit is fading or momentum turns against it, set the line at
   that same look — do not wait for the position to reach the desk's stop. A position left unguarded can go from
   up to stopped out in under a minute (window 2200: 48 seconds).
16. SECURING THE VICTORIES — STINGY TRIGGER (owner order 2026-11-08, tightened the same night after the team
   Monte Carlo showed the loose trigger fires on noise and pays for itself on no axis): while equity is under
   1000c, bank a held position ONLY when BOTH hold at the same look: (a) it is up at least 10c per contract net
   of fees, AND (b) the move has genuinely stalled — the distance has shrunk toward the strike on TWO
   consecutive looks, or momentum has turned against the held side — not a single flat look, not a one-tick
   pause. Below 10c per contract of profit, or on any single-look stall, HOLD: small greens are settlement
   tickets, not exits — the book reaches $10 by letting some positions live to settlement, and every early exit
   pays the fee round-trip. Never secure a position whose distance is still widening in its favor. This
   overrides rule 3 while in recovery only when both conditions hold. At 1000c or more, rule 3 governs: never
   sell a winning position whose thesis is intact.
17. THE OWNER'S STANDING NOTE (owner order 2026-11-08): when the prompt carries the owner's standing note at its
   top, that note is his direct word — follow it as a plan adjustment to this playbook, and quote it in your
   reason when it changes your ruling. It stands until he changes it; do not treat an old note as expired. It
   does not lift the hard gates — the fees/edge math, the 85c entry cap, the two-loss window cap, the recovery
   entry line — unless the note says so in plain words; a note that only steers judgment (when to secure, which
   side to prefer, how patient to be) never overrides a gate.

18. THE MONEY PLAN (owner 2026-11-09: "check the live funds, what we officially have, and try to get us up out the hole
   ... strategize"). The money lines below are the desk's official figures. Each ruling, write "plan": one sentence on
   where the money stands and the risk you allow for it (how many contracts, which distance), and carry it out with your
   directives (max_contracts, min_entry_bps). Climb out by compounding small, high-quality wins: size so one stop-out
   costs a small part of the money, and grow size only as equity grows. Never chase losses -- a bigger or worse bet to win
   it back fast is how the rest is lost; after a loss, size down or wait for a cleaner setup.

Think first, then decide. Answer with ONE JSON object and nothing else:
{"analysis": "<1-2 short sentences: where BTC is vs the strike and trending, the edge after fees, the risk>",
 "p_yes": <your probability 0..1 that this window settles YES>,
 "action": "none" | "enter_yes" | "enter_no" | "exit" | "pause_entries" | "resume_entries" | "kill" | "unkill",
 "reason": "<one sentence the owner will read>",
 "exit_line_bps": <number -15..2 or null; only matters while the desk holds a position>,
 "review": "<one sentence: what the Observer/Preserver did right or wrong lately>",
 "plan": "<one sentence: where the money stands and the risk you allow for it>",
 "directives": {"block_entry_side": "yes" | "no" | "both" | null, "min_entry_bps": <3..30 or null>, "max_contracts": <1..100 or null>} or null}"""
# Which playbook a ruling was made under (the corpus records it, so rulings from different playbooks are told apart).
SYSTEM_SHA = hashlib.sha256(SYSTEM.encode()).hexdigest()[:12]


def build_user_prompt(obs):
    st = obs.get("status") or {}
    live = obs.get("live") or {}
    w = (live.get("window") or {})
    snap = (live.get("snapshot") or {})
    fair, edge = obs.get("fair"), obs.get("edges") or {}
    rec = obs.get("record") or {}
    lines = [
        *owner_note_lines(st),
        f"Window {w.get('ticker')}: {fair['left_s'] if fair else '?'}s left, strike ${w.get('strikeUsd')}, BTC {snap.get('distanceBps') if snap.get('distanceBps') is None else round(snap['distanceBps'], 1)} bps "
        f"from the strike (positive = above). Change: {trend(live, 60)} bps in the last minute, {trend(live, 180)} bps in the last 3 minutes.",
        f"Book: YES {snap.get('yesBidCents')}/{snap.get('yesAskCents')}c, NO {snap.get('noBidCents')}/{snap.get('noAskCents')}c. Market P(YES) = {market_p_yes(live)}.",
        (f"Fair P(YES) = {fair['p_yes']:.3f} by formula (1-minute BTC move {fair['sigma_1m_bps']} bps, {'measured' if fair['sigma_measured'] else 'default'}); "
         f"blended with the market: {blended_p_yes(fair, snap):.3f}. "
         f"Edge after fees if you buy now: YES {edge.get('yes')}c, NO {edge.get('no')}c per contract (need +{MIN_EDGE_CENTS:g}c)." if fair else "Fair value: unavailable (no distance or clock)."),
        f"Desk: equity {st.get('equityCents')}c, kill switch {'ON' if st.get('killed') else 'off'}, hold {json.dumps(st.get('hold'))}, "
        f"open position {json.dumps(st.get('openMark'))}.",
        *money_lines(st),
        observer_line(live),
        *last_window_lines(obs),
        f"Recent trades: {json.dumps(obs.get('history'))[:700]}",
        f"Your scorecard: {json.dumps({k: rec.get(k) for k in ('graded', 'agentBrier', 'marketBrier')})}",
        *desk_trades_lines(live),
        *obs.get("memory", []),
        "Decide now.",
    ]
    return "\n".join(lines)


def owner_note_lines(st):
    """The owner's standing note (owner order 2026-11-08), FIRST in the prompt when one is set: the desk's
    get_status surfaces it as status.ownerNote ({text, setAtMs}, written by the owner from his page through
    the desk's owner_note tool). His direct word — playbook rule 17 gives it its force. Absent or malformed
    notes add no line: the prompt is then exactly the playbook's."""
    note = (st or {}).get("ownerNote")
    text = note.get("text") if isinstance(note, dict) else note
    text = str(text).strip() if text is not None else ""
    if not text:
        return []
    return [f"OWNER'S STANDING NOTE (his word — follow it; it overrides your playbook defaults until he changes it): \"{text}\""]


def money_lines(st):
    """The desk's official money, in plain words, for the money plan (rule 18)."""
    def usd(c):
        return f"${c / 100:.2f}" if isinstance(c, (int, float)) else "?"
    eq, cash = st.get("equityCents"), st.get("kalshiBalanceCents")
    if not isinstance(eq, (int, float)):
        return []
    parts = [f"Money (official): equity {usd(eq)}, Kalshi cash {usd(cash)}"]
    to_line, line = st.get("toRecoveryLineCents"), st.get("recoveryLineCents")
    if isinstance(to_line, (int, float)) and isinstance(line, (int, float)):
        parts.append(f"{usd(to_line)} under the {usd(line)} recovery line" if to_line > 0 else f"above the {usd(line)} recovery line")
    if isinstance(st.get("toGoalCents"), (int, float)):
        parts.append(f"{usd(st['toGoalCents'])} from the goal")
    if isinstance(st.get("daySettledPnlCents"), (int, float)):
        parts.append(f"today's settled P&L {'+' if st['daySettledPnlCents'] >= 0 else '-'}{usd(abs(st['daySettledPnlCents']))}")
    risk = st.get("maxStopRiskPerContractCents")
    if isinstance(risk, (int, float)) and risk > 0:
        parts.append(f"a stopped contract costs up to {risk:.0f}c, so {int(eq // risk)} stop-outs at one contract each would take it all")
    return ["; ".join(parts) + "."]


def desk_trades_lines(live, max_rows=8):
    """This window's fills, in plain words, so the agent can review and direct the desk."""
    rows = []
    for i in sorted(((live or {}).get("intents") or []), key=lambda x: x.get("created_at_ms") or 0):
        n = (i.get("filled_hundredths") or 0) / 100
        yes = i.get("avg_yes_price_micros")
        if not n or yes is None or i.get("side") not in ("yes", "no"):
            continue
        price = yes / 1e4 if i["side"] == "yes" else 100 - yes / 1e4
        iid = str(i.get("intent_id") or "")
        who = ("your " if "crew-lead" in iid else "") + (
            "strike-cross stop" if ":stop10" in iid or "exit-retry" in iid else
            "Preserver exit" if ":preserver:" in iid else
            ("entry" if "crew-lead" in iid else "Observer entry") if i.get("purpose") == "entry" else
            "exit")
        rows.append(f"{who} {i['side'].upper()} x{n:g} @ {price:.0f}c")
    if not rows:
        return ["The desk has not traded in this window yet."]
    return ["The desk's trades this window (oldest first): " + "; ".join(rows[-max_rows:]) + ". " + open_position_fact(live)]


def open_position_fact(live):
    """The position open right now, as a fact the review must not contradict (2026-11-09 00:08-00:40 CST: four reviews
    said "held the position to settlement" while it was still open, two applied the 80c hold to a 78c entry)."""
    view = live_view(live)
    yes, no = view["position"]
    side = "yes" if yes > 0 else "no" if no > 0 else None
    if side is None:
        return "Nothing is open now."
    n = (yes if side == "yes" else no) / 100
    cost = qty = 0.0
    for i in sorted(((live or {}).get("intents") or []), key=lambda x: x.get("created_at_ms") or 0):
        f, y = i.get("filled_hundredths") or 0, i.get("avg_yes_price_micros")
        if i.get("side") != side or not f or y is None:
            continue
        if i.get("purpose") in ("exit", "flip-close"):
            cost = qty = 0.0  # a later entry starts a new position
        elif i.get("purpose") in ("entry", "flip-open"):
            px = y / 1e4 if side == "yes" else 100 - y / 1e4
            cost, qty = cost + px * f, qty + f
    at = f" bought at {cost / qty:.0f}c" if qty else ""
    band = "" if not qty else (" (80c or more: the strong-side hold applies)" if cost / qty >= 80 else " (under 80c: not an 80c+ hold)")
    return f"OPEN NOW: {side.upper()} x{n:g}{at}{band}; the window has not closed, so it has NOT been held to settlement."


def parse_decision(text, fallback_p):
    """Strictly parse the model's JSON decision. Anything invalid becomes 'none' with the market's probability."""
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except ValueError:
        d = None
    if not isinstance(d, dict):
        cut = "{" in (text or "") and "}" not in (text or "").split("{", 1)[1]
        why = "model answer was cut off before its JSON closed; no action taken" if cut else "model answer was not valid JSON; no action taken"
        return {"p_yes": fallback_p, "action": "none", "reason": why, "valid": False}
    action = d.get("action") if d.get("action") in ACTIONS else None
    p = d.get("p_yes")
    p = float(p) if isinstance(p, (int, float)) and 0 <= float(p) <= 1 else fallback_p
    reason = str(d.get("reason") or "").strip()[:280]
    analysis = str(d.get("analysis") or "").strip()[:600]
    if action is None or not reason:
        return {"p_yes": p, "action": "none", "reason": reason or "model named no valid action; no action taken", "valid": False, "analysis": analysis}
    line = d.get("exit_line_bps")
    line = float(line) if isinstance(line, (int, float)) and not isinstance(line, bool) and -15 <= float(line) <= 2 else None
    review = str(d.get("review") or "").strip()[:400] or None
    plan = str(d.get("plan") or "").strip()[:400] or None
    return {"p_yes": p, "action": action, "reason": reason, "valid": True, "analysis": analysis, "exit_line_bps": line,
            "review": review, "plan": plan, "directives": parse_directives(d.get("directives"))}


def observer_line(live):
    """The Observer's last decision; a hold caused by the agent's own directive is labelled so, never evidence."""
    d = (live or {}).get("lastDecision") or {}
    reason = str(d.get("reason") or "")
    if reason.startswith("agent-directive"):
        return (f"Observer's last decision: holding because of YOUR OWN directive ({reason}). That is your effect, not "
                f"evidence about the market; do not cite it as a reason.")
    return f"Observer's last decision: {json.dumps(d or None)}."


def window_losses_by_side(live):
    """Positions the desk closed at a loss in this window, per side (fill prices; a stopped or sold position counts)."""
    rows = sorted(((live or {}).get("intents") or []), key=lambda x: x.get("created_at_ms") or 0)
    losses, net, cost = {"yes": 0, "no": 0}, {"yes": 0.0, "no": 0.0}, {"yes": 0.0, "no": 0.0}
    for i in rows:
        side, n, yes = i.get("side"), (i.get("filled_hundredths") or 0) / 100, i.get("avg_yes_price_micros")
        if side not in losses or not n or yes is None:
            continue
        own = yes / 1e4 if side == "yes" else 100 - yes / 1e4
        if i.get("purpose") == "entry":
            net[side] += n
            cost[side] += own * n
        elif i.get("purpose") == "exit" and net[side] > 0:
            avg = cost[side] / net[side]
            sold = min(n, net[side])
            if own < avg:
                losses[side] += 1
            cost[side] -= avg * sold
            net[side] -= sold
    return losses


def ground_directives(directives, live):
    """CODE, NOT THE MODEL, decides whether a block is earned (Muse's audit, 2026-11-09 23:23 CST: a block-both directive
    justified by "Observer held position due to agent-directive-block" -- its own effect -- held the 0030 window 107
    ticks with 0 entries). A side may be blocked only after the desk actually lost on that side in this window; 'both'
    needs a loss on each side. An unearned block is dropped (the other directive fields stand) and the reason is kept."""
    if not directives or not directives.get("block_entry_side"):
        return directives, None
    losses = window_losses_by_side(live)
    block = directives["block_entry_side"]
    earned = (losses["yes"] > 0 and losses["no"] > 0) if block == "both" else losses.get(block, 0) > 0
    if earned:
        return directives, None
    why = f"block {block} dropped: the desk has not lost on {'both sides' if block == 'both' else block.upper()} in this window"
    return dict(directives, block_entry_side=None), why


_SIGN_CLAIM = re.compile(r"(\d+(?:\.\d+)?)\s*bps\s+(above|below)\s+the\s+strike", re.I)


def sign_contradiction(analysis, distance_bps):
    """The analysis says "N bps above/below the strike" with the wrong side of the live feed (21:40 audit: the feed read
    -10.0 bps and the analysis said 10.0 bps above). Returns a note, or None. Tiny distances are not judged."""
    if not analysis or not isinstance(distance_bps, (int, float)) or abs(distance_bps) < 1.0:
        return None
    for num, word in _SIGN_CLAIM.findall(analysis):
        if (word.lower() == "above") != (distance_bps > 0):
            return f"the analysis says {num} bps {word.lower()} the strike but the feed reads {distance_bps:+.1f} bps"
    return None


def last_window_lines(obs):
    """The last graded window's real outcome, so a review cannot invent one (2215 was reviewed as a loss; it won)."""
    rec = obs.get("record") if isinstance(obs.get("record"), dict) else {}
    recent = (rec or {}).get("recent") or []
    if not recent:
        return []
    r = recent[-1]
    return [f"Last graded window {str(r.get('ticker'))[-7:]}: settled {str(r.get('result')).upper()} "
            f"(your call was P(yes) {r.get('pYes')}, the market's {r.get('marketPYes')}). Review only what is shown here and below."]


def parse_directives(raw):
    """The model's directives to the Observer, validated; anything out of bounds is dropped, not guessed at."""
    if not isinstance(raw, dict):
        return None
    block = raw.get("block_entry_side")
    block = block if block in ("yes", "no", "both") else None
    mn = raw.get("min_entry_bps")
    mn = float(mn) if isinstance(mn, (int, float)) and not isinstance(mn, bool) and 3 <= float(mn) <= 30 else None
    mx = raw.get("max_contracts")
    mx = int(mx) if isinstance(mx, (int, float)) and not isinstance(mx, bool) and float(mx).is_integer() and 1 <= mx <= 100 else None
    return {"block_entry_side": block, "min_entry_bps": mn, "max_contracts": mx}


def anchored_p_yes(model_p, obs):
    """The probability recorded for grading: half the model's, half the blended fair value (when there is one)."""
    target = blended_p_yes(obs.get("fair"), ((obs.get("live") or {}).get("snapshot") or {}))
    if target is None or model_p is None:
        return model_p
    return round(PREDICTION_ANCHOR * target + (1 - PREDICTION_ANCHOR) * model_p, 3)


def memory_lines(obs, earlier):
    """What the agent remembers: its recent graded calls (scorecard) and its earlier check-ins in this window."""
    out = []
    recent = ((obs.get("record") or {}).get("recent") or [])[-5:] if isinstance(obs.get("record"), dict) else []
    if recent:
        calls = "; ".join(f"{str(r.get('ticker'))[-7:]}: you {r.get('pYes')} vs market {r.get('marketPYes')} -> settled {str(r.get('result')).upper()}" for r in recent)
        out.append(f"Your last graded calls: {calls}.")
    if earlier:
        out.append("Your earlier check-ins this window: " + "; ".join(f"{e['at_left_s']}s left: {e['action']} ({e['reason'][:80]})" for e in earlier[-3:]) + ".")
    return out


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


NEXUS_SHADOW_TIMEOUT_S = 90


def shadow_ruling(shadow, record, user, obs, fallback, log=print):
    """Ask Nexus the ruler's question and file its answer in the corpus as a shadow ruling. Never trades; never raises."""
    try:
        name, answer = shadow(SYSTEM, user)
        d = parse_decision(answer, fallback if fallback is not None else 0.5)
        record({"model": f"shadow:{name}"[:80], "action": d["action"], "p_model": d["p_yes"], "p_yes": d["p_yes"],
                "inputs": {"system_sha": SYSTEM_SHA, "prompt": user, "fair": obs.get("fair"), "edges": obs.get("edges")},
                "output": {"shadow": True, "raw": (answer or "")[:2000], "analysis": d.get("analysis"), "reason": d["reason"], "valid": d.get("valid")}})
        log(json.dumps({"nexus_shadow": {"model": name, "action": d["action"], "p_yes": d["p_yes"], "valid": d.get("valid")}}))
    except Exception as e:  # noqa: BLE001  (shadow is best effort: it must never touch the ruler)
        log(json.dumps({"nexus_shadow_error": str(e)[:200]}))


def chat_completions_shadow(url, token=None, model="nexus", timeout_s=NEXUS_SHADOW_TIMEOUT_S, post=None):
    """A shadow caller for an chat-completions-compatible chat endpoint (the packaged Nexus standalone API)."""
    # Both request shapes: a ".../v1/completions" address takes a plain prompt and answers choices[0].text (the Nexus
    # shadow Muse exposed on 2026-11-09 is that shape); any other address gets the chat shape. Either reply shape is read.
    plain = url.rstrip("/").endswith("/completions") and not url.rstrip("/").endswith("/chat/completions")

    def call(system, user):
        if plain:
            body = {"model": model, "prompt": f"{system}\n\n{user}\n\nAnswer:", "max_tokens": MAX_ANSWER_TOKENS, "temperature": 0.2}
        else:
            body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    "max_tokens": MAX_ANSWER_TOKENS, "temperature": 0.2}
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if post is not None:
            data = post(url, body, headers)
        else:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout_s) as r:
                data = json.loads(r.read().decode())
        choice = (data.get("choices") or [{}])[0] or {}
        text = (choice.get("message") or {}).get("content") or choice.get("text") or ""
        return data.get("model") or model, text
    return call


BLIND_REREADS = 3
BLIND_REREAD_S = 5


def blind_reason(obs):
    """Why this observation is no picture to rule on (no window, no distance to the strike), or None."""
    live = obs.get("live") if isinstance(obs.get("live"), dict) else {}
    if not (live.get("window") or {}).get("ticker"):
        return "the feed gave no window"
    d = (live.get("snapshot") or {}).get("distanceBps")
    if not isinstance(d, (int, float)) or isinstance(d, bool):
        return "the feed gave no distance to the strike"
    return None


def run_once(mcp, think, mode=DEFAULT_AGENT_MODE, log=print, sleep=time.sleep, predicted=None, earlier=None, watch=None, model_name=None,
             shadow=None, record=None, spawn=None):
    """One plan -> act -> check cycle. `think(system, user) -> str` is the model. Returns a report dict.

    A run that lands too late in a window waits for the next window to open and decides on that
    one; it goes home silent only when the total wait would exceed MAX_WINDOW_WAIT_S (e.g. the
    live feed is stuck on a dead window).
    """
    if spawn is None:
        spawn = lambda f: threading.Thread(target=f, daemon=True).start()  # noqa: E731
    if record is None:
        record = lambda args: mcp.tool("record_ruling", args)  # noqa: E731
    mcp.initialize()
    obs = observe(mcp)
    waited_s = 0
    while True:
        fair = obs.get("fair")
        if not fair or fair.get("left_s") is None or fair["left_s"] >= MIN_SECONDS_TO_DECIDE:
            break
        wait_s = max(fair["left_s"], 0) + WINDOW_ROLL_S
        if waited_s + wait_s > MAX_WINDOW_WAIT_S:
            report = {"mode": mode, "skipped": f"{fair['left_s']}s left in the window: a decision would land after the close", "fair": fair, "acted": [], "checked": None, "waited_s": waited_s}
            log(json.dumps(report))
            return report
        log(json.dumps({"mode": mode, "waiting": f"{fair['left_s']}s left in this window: waiting {wait_s}s for the next window", "fair": fair}))
        sleep(wait_s)
        waited_s += wait_s
        obs = observe(mcp)
    # NO BLIND RULINGS (2026-11-09 23:48 CST: a ruling read "BTC is None bps from the strike ... fair value is unavailable"
    # -- the feed's status section had timed out on that read -- and spent minutes of thinking on no picture). Re-read a few
    # times; if the distance is still missing, skip this check-in instead of ruling on nothing.
    for _ in range(BLIND_REREADS):
        if not blind_reason(obs):
            break
        sleep(BLIND_REREAD_S)
        obs = observe(mcp)
    why_blind = blind_reason(obs)
    if why_blind:
        report = {"mode": mode, "skipped": f"{why_blind} after {BLIND_REREADS + 1} reads: not ruling blind", "fair": obs.get("fair"), "acted": [], "checked": None, "waited_s": waited_s}
        log(json.dumps(report))
        return report
    fallback = market_p_yes(obs.get("live"))
    ticker = ((obs.get("live") or {}).get("window") or {}).get("ticker")
    window_earlier = (earlier or {}).get(ticker, []) if earlier is not None else []
    obs["memory"] = watch_lines(watch) + memory_lines(obs, window_earlier)
    user = build_user_prompt(obs)
    t0 = time.monotonic()
    answer = think(SYSTEM, user)
    decision = parse_decision(answer, fallback if fallback is not None else 0.5)
    decision = apply_discipline(decision, obs)
    sign_note = sign_contradiction(decision.get("analysis"), ((obs.get("live") or {}).get("snapshot") or {}).get("distanceBps"))
    if sign_note and decision["action"] != "none":
        decision = {**decision, "blocked": decision["action"], "action": "none",
                    "reason": f"{decision['reason']} [not acted on: {sign_note}]"}
    decision["p_model"] = decision["p_yes"]
    decision["p_yes"] = anchored_p_yes(decision["p_yes"], obs)
    report = {"mode": mode, "ticker": ticker, "seen": live_view(obs.get("live")), "decision": decision, "fair": obs.get("fair"), "edges": obs.get("edges"), "think_s": round(time.monotonic() - t0, 1), "acted": [], "checked": None, "waited_s": waited_s}
    # Predict always (the scorecard grades it), whatever the action.
    # One graded prediction per window: the first call. Later check-ins are closer to the close and would grade easier.
    if decision["p_yes"] is not None and (predicted is None or ticker not in predicted):
        r = mcp.tool("predict", {"p_yes": decision["p_yes"], "reason": decision["reason"]})
        report["acted"].append({"tool": "predict", "ok": r["ok"]})
        if predicted is not None and r["ok"]:
            predicted.add(ticker)
    if earlier is not None and ticker:
        left = (obs.get("fair") or {}).get("left_s")
        earlier.setdefault(ticker, []).append({"at_left_s": left, "action": decision["action"], "reason": decision["reason"]})
    # STALE CHECK: the model thought for a minute or two. Before an order goes out, read the market again; if it moved
    # materially (BTC >= STALE_DISTANCE_BPS, across the strike, a fill, a new window), this decision was made on a picture
    # that is gone: it is not acted on, and the loop asks again at once with the fresh picture.
    spec = ACTIONS.get(decision["action"])
    # One fresh read after thinking serves both checks: the order's, and the trades picture the review/directives judged.
    fresh = None
    if (spec is not None and decision["action"] in ("enter_yes", "enter_no", "exit")) or (decision.get("valid") and mode == "live"):
        try:
            fresh = live_view(mcp.tool("get_live_window")["data"])
        except McpError:
            fresh = None
    if spec is not None and decision["action"] in ("enter_yes", "enter_no", "exit"):
        stale = stale_reason(report.get("seen"), fresh)
        if stale:
            decision["blocked"], decision["action"] = decision["action"], "none"
            decision["reason"] = f"{decision['reason']} [stale: {stale} while I was thinking; re-deciding now]"
            report["recheck_now"] = True
            spec = None
    if spec is not None:
        if mode == "live":
            name, args = spec
            r = mcp.tool(name, {**args, "reason": decision["reason"]})
            report["acted"].append({"tool": name, "args": args, "ok": r["ok"], "result": r["text"][:300]})
        else:
            report["acted"].append({"tool": spec[0], "args": spec[1], "ok": None, "result": "shadow mode: not sent"})
    # Directives to the Observer for this window (nexus-trader direct_desk) are RENEWED EVERY VALID RULING: a ruling that
    # gives none clears the last one (Muse's audit: rulings #71-#73 said none while a block-both kept binding the desk).
    # A block must be earned by a real loss on that side this window (ground_directives).
    # STALE TRADES (2026-11-09 23:48 CST: a ruling said "the Observer did not trade in this window" while the desk had
    # bought YES x15 at 23:45:54, during its thinking): if the window or the position changed while it thought, its review,
    # directives and exit line judged a desk that is gone. None is sent (the last directive stands) and it re-decides now.
    trades_stale = trades_changed(report.get("seen"), fresh)
    if trades_stale and decision.get("valid") and mode == "live":
        decision["directive_note"] = f"review, directives and exit line not sent: {trades_stale} while I was thinking; re-deciding now"
        report["recheck_now"] = True
    if decision.get("valid") and mode == "live" and not trades_stale:
        wanted = decision.get("directives") or {"block_entry_side": None, "min_entry_bps": None, "max_contracts": None}
        sent, dropped = ground_directives(wanted, obs.get("live"))
        decision["directives_sent"] = sent
        if dropped:
            decision["directive_note"] = dropped
        try:
            reason = decision.get("review") or decision["reason"]
            r = mcp.tool("direct_desk", {**sent, "reason": f"{reason} [{dropped}]" if dropped else reason})
            report["acted"].append({"tool": "direct_desk", "args": sent, "ok": r["ok"]})
        except McpError:
            report["acted"].append({"tool": "direct_desk", "ok": False})
    # The AI's exit line, enforced by the desk on every tick (nexus-trader set_exit_line), while it holds a position.
    holding = any(x > 0 for x in ((report.get("seen") or {}).get("position") or (0, 0)))
    if holding and decision.get("valid") and mode == "live" and decision["action"] != "exit" and not trades_stale:
        try:
            r = mcp.tool("set_exit_line", {"at_bps": decision.get("exit_line_bps"), "reason": decision["reason"]})
            report["acted"].append({"tool": "set_exit_line", "args": {"at_bps": decision.get("exit_line_bps")}, "ok": r["ok"]})
        except McpError:
            report["acted"].append({"tool": "set_exit_line", "ok": False})
    # The ruler's corpus (owner 2026-11-09: Nexus learns "from being ruler"): what it saw and what it decided, filed on the
    # desk with the window so the export can join the outcome. After acting; a desk without the corpus never stops a ruling.
    try:
        r = mcp.tool("record_ruling", {
            "model": model_name,
            "inputs": {"system_sha": SYSTEM_SHA, "prompt": user, "fair": obs.get("fair"), "edges": obs.get("edges"),
                       "seen": report.get("seen"), "woke": (watch or {}).get("woke")},
            "output": {"raw": (answer or "")[:2000], "analysis": decision.get("analysis"), "reason": decision["reason"],
                       "directives": decision.get("directives_sent"), "directive_note": decision.get("directive_note"),
                       "exit_line_bps": decision.get("exit_line_bps"), "review": decision.get("review"), "plan": decision.get("plan"),
                       "valid": decision.get("valid"), "blocked": decision.get("blocked"), "acted": report["acted"]},
            "action": decision["action"], "p_model": decision.get("p_model"), "p_yes": decision["p_yes"]})
        report["acted"].append({"tool": "record_ruling", "ok": r["ok"]})
    except McpError:
        report["acted"].append({"tool": "record_ruling", "ok": False})
    # After acting (never delaying an order): the owner's live page shows this reasoning where the chart legend was (share_thinking, every check-in). A desk
    # without the tool, or a failed call, never stops the decision.
    try:
        r = mcp.tool("share_thinking", {"analysis": decision.get("analysis") or decision["reason"], "action": decision["action"],
                                        "p_yes": decision["p_yes"], "reason": decision["reason"],
                                        **({"review": decision["review"]} if decision.get("review") else {}),
                                        **({"plan": decision["plan"]} if decision.get("plan") else {})})
        report["acted"].append({"tool": "share_thinking", "ok": r["ok"]})
    except McpError:
        report["acted"].append({"tool": "share_thinking", "ok": False})
    # Nexus in shadow (owner 2026-11-09: Nexus learns "from being ruler"): the same playbook and the same prompt go to Nexus,
    # its answer is parsed exactly like the ruler's and filed in the corpus under its own model name -- NEVER acted on.
    # It runs off the ruler's path (spawn) so a slow or absent Nexus can never delay a ruling.
    if shadow is not None:
        spawn(lambda: shadow_ruling(shadow, record, user, obs, fallback, log))
    # Check: read the desk back after acting.
    after = mcp.tool("get_status")["data"]
    if isinstance(after, dict):
        report["checked"] = {"killed": after.get("killed"), "equityCents": after.get("equityCents"), "openTickers": after.get("openTickers"), "hold": after.get("hold")}
    log(json.dumps(report))
    return report


def write_summary(report, mode):
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    with open(summary, "a") as f:
        if "skipped" in report:
            f.write(f"### Trader agent ({mode})\n- skipped: {report['skipped']}\n")
            return
        d = report["decision"]
        f.write(f"### Trader agent ({mode}) · {report.get('ticker')}\n- thinking: {d.get('analysis', '')}\n- fair {json.dumps(report.get('fair'))} · edges {json.dumps(report.get('edges'))}\n- P(YES) {d['p_yes']} · action **{d['action']}** · {d['reason']}\n- acted: {json.dumps(report['acted'])}\n- desk after: {json.dumps(report['checked'])}\n")


# The standing agent (owner order 2026-11-09: "The AI starts itself"). GitHub's cron never fired this workflow, so one
# run now loads the model once and rules window after window for AGENT_LOOP_MINUTES, then the workflow queues its own
# successor. After ruling a window it sleeps until shortly after the next one opens.
NEXT_WINDOW_GRACE_S = 30
LOOP_ERROR_BACKOFF_S = 60
# Owner 2026-11-09: "we need the AI to be there constantly". After each ruling the agent looks again after this pause
# (plus its ~100 s of thinking), all window long, flat or holding; with too little time left it sleeps into the next window.
CHECK_INTERVAL_S = 10
# Owner 2026-11-09: "the quicker the model can read the live trading, the better ... watching constantly". The model needs
# ~70-110 s per ruling on the CPU runner, so between rulings a cheap watcher (no model) reads the live window every
# WATCH_POLL_S and wakes the model at once on a material change.
WATCH_POLL_S = 5
WAKE_DISTANCE_BPS = 5.0   # BTC moved this far vs the strike since the last ruling
WAKE_BID_CENTS = 10.0     # the YES bid moved this much
DANGER_BPS = 3.0          # holding, and BTC came within this of the strike
# The full answer now carries analysis, p_yes, action, reason, exit_line_bps, review, plan and directives. At 200 tokens it
# was cut off mid-JSON (2026-11-09 23:41 CST, the first ruling after #390: "model answer was not valid JSON; no action
# taken"), so the cap leaves room for all of it: ~90 s worst case at ~4 tokens/s.
MAX_ANSWER_TOKENS = 360
# The writing budget, counted from the FIRST token the model writes (reading the prompt is not writing): 360 tokens at
# ~4 tokens/s is ~90 s, so 150 s leaves headroom. A prompt-read that never yields a token is bounded by the job itself.
ANSWER_TIME_BUDGET_S = 150


def generate_after_first_token(stream, max_new_tokens, time_budget_s, clock=time.monotonic):
    """Consume a llama.cpp stream; the time budget starts at the first token, so a long prompt read cannot eat it.
    Returns (text, tokens, write_seconds, stopped_by_time, read_prompt_seconds)."""
    t0 = clock()
    start = None
    parts, tokens, by_time = [], 0, False
    for chunk in stream:
        if start is None:
            start = clock()
        parts.append(chunk["choices"][0].get("text", ""))
        tokens += 1
        if tokens >= max_new_tokens:
            break
        if clock() - start >= time_budget_s:
            by_time = True
            break
    read_s = round((start if start is not None else clock()) - t0, 1)
    return "".join(parts).strip(), tokens, round(clock() - (start if start is not None else t0), 1), by_time, read_s


def live_view(live):
    """The few numbers the watcher compares: window, distance, YES bid, and the net position from this window's fills."""
    live = live if isinstance(live, dict) else {}
    snap = live.get("snapshot") or {}
    net = {"yes": 0, "no": 0}
    for i in live.get("intents") or []:
        n = i.get("filled_hundredths") or 0
        if n and i.get("side") in net:
            if i.get("purpose") in ("entry", "flip-open"):
                net[i["side"]] += n
            elif i.get("purpose") in ("exit", "flip-close"):
                net[i["side"]] -= n
    return {"ticker": (live.get("window") or {}).get("ticker"), "distanceBps": snap.get("distanceBps"),
            "yesBid": snap.get("yesBidCents"), "position": (net["yes"], net["no"])}


def material_change(seen, now):
    """Why the watcher should wake the model now, or None."""
    if not seen or not now:
        return None
    if now["ticker"] != seen["ticker"]:
        return "a new window opened"
    if now["position"] != seen["position"]:
        return "the position changed (a fill)"
    d0, d1 = seen.get("distanceBps"), now.get("distanceBps")
    if isinstance(d0, (int, float)) and isinstance(d1, (int, float)):
        if abs(d1 - d0) >= WAKE_DISTANCE_BPS:
            return f"BTC moved {d1 - d0:+.1f} bps vs the strike"
        holding = any(x > 0 for x in now["position"])
        if holding and abs(d1) <= DANGER_BPS < abs(d0):
            return f"holding, and BTC is within {DANGER_BPS:g} bps of the strike"
    b0, b1 = seen.get("yesBid"), now.get("yesBid")
    if isinstance(b0, (int, float)) and isinstance(b1, (int, float)) and abs(b1 - b0) >= WAKE_BID_CENTS:
        return f"the YES bid moved {b1 - b0:+.0f}c"
    return None


STALE_DISTANCE_BPS = 3.0


def trades_changed(seen, now):
    """Whether the desk the model judged (window, position) is gone, or None. BTC's distance alone does not void a review."""
    if not seen or not now:
        return None
    if now.get("ticker") != seen.get("ticker"):
        return "a new window opened"
    if now.get("position") != seen.get("position"):
        return "the position changed"
    return None


def stale_reason(seen, now):
    """Why the picture a decision was made on is gone, or None."""
    if not seen or not now:
        return None
    if now.get("ticker") != seen.get("ticker"):
        return "a new window opened"
    if now.get("position") != seen.get("position"):
        return "the position changed"
    d0, d1 = seen.get("distanceBps"), now.get("distanceBps")
    if isinstance(d0, (int, float)) and isinstance(d1, (int, float)):
        if (d0 > 0) != (d1 > 0) and abs(d1 - d0) > 0.5:
            return f"BTC crossed the strike ({d0:+.1f} -> {d1:+.1f} bps)"
        if abs(d1 - d0) >= STALE_DISTANCE_BPS:
            return f"BTC moved {d1 - d0:+.1f} bps"
    return None


def watch_pause(seconds, seen, peek, log=print, sleep=time.sleep, clock=time.time):
    """Pause up to `seconds`, reading the live window every WATCH_POLL_S; return early (with the reason) on a material
    change. Without a peek function, or once the peek fails, it is a plain sleep."""
    end = clock() + max(0.0, seconds)
    readings = []
    while clock() < end:
        sleep(min(WATCH_POLL_S, max(0.0, end - clock())))
        if peek is None or seen is None:
            continue
        try:
            now = peek()
        except Exception:  # noqa: BLE001  (a failed peek is a missed look, not a stop)
            continue
        if isinstance(now, dict):
            readings.append(now)
        why = material_change(seen, now)
        if why:
            log(json.dumps({"woke": why}))
            return {"woke": why, "readings": readings}
    return {"woke": None, "readings": readings}


def watch_lines(watch, max_points=12):
    """What the watcher saw since the last ruling, for the model: why it woke it, and the live tape (every 5 s)."""
    if not watch or not watch.get("readings"):
        return []
    rs = [r for r in watch["readings"] if r.get("ticker") == watch["readings"][-1].get("ticker")]
    if len(rs) > max_points:
        step = len(rs) / max_points
        rs = [rs[int(i * step)] for i in range(max_points - 1)] + [rs[-1]]
    fmt = lambda v, f: f.format(v) if isinstance(v, (int, float)) else "?"  # noqa: E731
    dist = " > ".join(fmt(r.get("distanceBps"), "{:+.1f}") for r in rs)
    bid = " > ".join(fmt(r.get("yesBid"), "{:.0f}") for r in rs)
    pos = rs[-1].get("position")
    lines = [f"Live since your last ruling (watcher, every {WATCH_POLL_S} s, oldest first): distance {dist} bps; YES bid {bid}c; "
             f"position now YES {pos[0] / 100 if pos else 0:g} / NO {pos[1] / 100 if pos else 0:g} contracts."]
    if watch.get("woke"):
        lines.insert(0, f"You were woken early because {watch['woke']}.")
    return lines


def standing_loop(run, minutes, log=print, sleep=time.sleep, clock=time.time, peek=None):
    """Call run() once per window until `minutes` have passed. run() returns a run_once report. Returns the count of
    windows ruled. An error in one window is logged and retried after a backoff; it never ends the loop."""
    deadline = clock() + minutes * 60
    ruled = 0
    watch = None
    while clock() < deadline - NEXT_WINDOW_GRACE_S:
        try:
            report = run(watch)
        except Exception as e:  # noqa: BLE001  (one bad window must not end the standing agent)
            log(json.dumps({"window_error": str(e)[:300]}))
            sleep(min(LOOP_ERROR_BACKOFF_S, max(0, deadline - clock())))
            continue
        if "skipped" not in report:
            ruled += 1
        left = (report.get("fair") or {}).get("left_s")
        if report.get("recheck_now"):
            pause = 0                         # the decision went stale while thinking: look again at once
        elif not isinstance(left, (int, float)) or left <= 0:
            pause = LOOP_ERROR_BACKOFF_S
        elif left - CHECK_INTERVAL_S >= MIN_SECONDS_TO_DECIDE:
            pause = CHECK_INTERVAL_S          # stay on this window
        else:
            pause = left + NEXT_WINDOW_GRACE_S  # too late for another look: wake 30 s into the next window
        watch = watch_pause(min(pause, max(0, deadline - clock())), report.get("seen"), peek, log=log, sleep=sleep, clock=clock)
    return ruled


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

    log = lambda s: print(redact(s, token), flush=True)  # noqa: E731
    # PRE-READ THE PLAYBOOK once, right after the model loads: llama.cpp keeps the evaluated prefix, so every ruling --
    # the first one included -- only reads the new desk data (the playbook alone is ~2,500 tokens; reading it inside a
    # ruling took most of the old 300 s budget, and ruling #79 on 2026-11-09 came back as just "{").
    t_warm = time.monotonic()
    for _ in llm(qwen_gguf.build_prompt(SYSTEM, ""), max_tokens=1, temperature=0.0, stream=True):
        break
    log(json.dumps({"playbook_prefilled_s": round(time.monotonic() - t_warm, 1), "playbook_chars": len(SYSTEM)}))

    def think(system, user):
        stream = llm(qwen_gguf.build_prompt(system, user), max_tokens=MAX_ANSWER_TOKENS, temperature=0.2, stop=qwen_gguf.STOP, stream=True)
        text, tokens, seconds, by_time, read_s = generate_after_first_token(stream, MAX_ANSWER_TOKENS, ANSWER_TIME_BUDGET_S)
        log(json.dumps({"think": {"read_prompt_s": read_s, "write_s": seconds, "tokens": tokens, "cut_by_time": by_time}}))
        return text


    predicted, earlier = set(), {}

    shadow_url = os.environ.get("NEXUS_SHADOW_URL", "").strip()
    shadow_token = os.environ.get("NEXUS_SHADOW_TOKEN", "")
    shadow = chat_completions_shadow(shadow_url, shadow_token) if shadow_url else None
    if shadow:
        log(json.dumps({"nexus_shadow": "on"}))

    def shadow_record(args):  # its own session: the shadow runs on its own thread
        m = McpSession(url, token)
        m.initialize()
        return m.tool("record_ruling", args)

    def one_window(watch=None):
        report = run_once(McpSession(url, token), think, mode=mode, log=lambda s: log(redact(s, shadow_token)), predicted=predicted, earlier=earlier,
                          watch=watch, model_name=name, shadow=shadow, record=shadow_record)
        write_summary(report, mode)
        return report

    minutes = int(os.environ.get("AGENT_LOOP_MINUTES", "0") or "0")
    if minutes <= 0:
        try:
            one_window()
        except McpError as e:
            print(f"::error::{redact(str(e), token)}")
            return 1
        return 0
    def peek():
        m = McpSession(url, token)
        m.initialize()
        return live_view(m.tool("get_live_window")["data"])

    ruled = standing_loop(one_window, minutes, log=log, peek=peek)
    print(f"standing agent: ruled {ruled} windows in {minutes} minutes", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
