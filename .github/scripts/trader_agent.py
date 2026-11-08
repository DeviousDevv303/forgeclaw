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
    "hold": ("set_hold", {"phase": "held"}),
    "release_hold": ("set_hold", {"phase": "done"}),
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
    return {
        "status": mcp.tool("get_status")["data"],
        "live": mcp.tool("get_live_window")["data"],
        "history": mcp.tool("get_trade_history", {"limit": 8})["data"],
        "record": mcp.tool("get_prediction_record", {"limit": 5})["data"],
    }


def market_p_yes(live):
    snap = (live or {}).get("snapshot") or {}
    yb, ya = snap.get("yesBidCents"), snap.get("yesAskCents")
    if isinstance(yb, (int, float)) and isinstance(ya, (int, float)):
        return round((yb + ya) / 200, 3)
    return None


SYSTEM = """You run the Nexus Trader desk on Kalshi's 15-minute BTC markets, alone, with full authority.
Each window pays $1 per contract if its side is right: YES if BTC settles at or above the strike, NO if below.
Your tools act through the Bank's own routes; the desk's reflexes stay underneath you (a stop that sells when BTC
crosses 2 bps past the strike against a position, and a floor guard that never lets a trade risk equity below $5).
Facts from the desk's own benchmarks: the market price is about as good a forecast as there is, fees make careless
trading lose, and selling a position on a small wiggle has cost more than it saved. Act only when you have a reason
the owner would accept. Doing nothing is a valid decision.

Answer with ONE JSON object and nothing else:
{"p_yes": <your probability 0..1 that this window settles YES>,
 "action": "none" | "enter_yes" | "enter_no" | "exit" | "hold" | "release_hold" | "kill" | "unkill",
 "reason": "<one sentence the owner will read>"}"""


def build_user_prompt(obs):
    st = obs.get("status") or {}
    live = obs.get("live") or {}
    w = (live.get("window") or {})
    snap = (live.get("snapshot") or {})
    now_ms = live.get("now")
    left = round((w.get("closeTimeMs", 0) - now_ms) / 1000) if isinstance(now_ms, (int, float)) and w.get("closeTimeMs") else None
    lines = [
        f"Window {w.get('ticker')}: {left}s left, strike ${w.get('strikeUsd')}, distance {snap.get('distanceBps')} bps "
        f"(positive = BTC above strike). Book YES {snap.get('yesBidCents')}/{snap.get('yesAskCents')}c, NO {snap.get('noBidCents')}/{snap.get('noAskCents')}c. "
        f"Market P(YES) = {market_p_yes(live)}.",
        f"Desk: equity {st.get('equityCents')}c, kill switch {'ON' if st.get('killed') else 'off'}, hold {json.dumps(st.get('hold'))}, "
        f"open position {json.dumps(st.get('openMark'))}, mandate {json.dumps(st.get('mandate'))}.",
        f"Observer's last decision: {json.dumps(live.get('lastDecision'))}.",
        f"Recent trades: {json.dumps(obs.get('history'))[:900]}",
        f"Your prediction record: {json.dumps({k: (obs.get('record') or {}).get(k) for k in ('graded', 'agentBrier', 'marketBrier')})}",
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
    if action is None or not reason:
        return {"p_yes": p, "action": "none", "reason": reason or "model named no valid action; no action taken", "valid": False}
    return {"p_yes": p, "action": action, "reason": reason, "valid": True}


def run_once(mcp, think, mode=DEFAULT_AGENT_MODE, log=print):
    """One plan -> act -> check cycle. `think(system, user) -> str` is the model. Returns a report dict."""
    mcp.initialize()
    obs = observe(mcp)
    fallback = market_p_yes(obs.get("live"))
    user = build_user_prompt(obs)
    t0 = time.monotonic()
    answer = think(SYSTEM, user)
    decision = parse_decision(answer, fallback if fallback is not None else 0.5)
    report = {"mode": mode, "decision": decision, "think_s": round(time.monotonic() - t0, 1), "acted": [], "checked": None}
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
        stream = llm(qwen_gguf.build_prompt(system, user), max_tokens=220, temperature=0.2, stop=qwen_gguf.STOP, stream=True)
        text, _, _, _ = qwen_gguf.generate(stream, 220, 240)
        return text

    try:
        report = run_once(McpSession(url, token), think, mode=mode, log=lambda s: print(redact(s, token)))
    except McpError as e:
        print(f"::error::{redact(str(e), token)}")
        return 1
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            d = report["decision"]
            f.write(f"### Trader agent ({mode})\n- P(YES) {d['p_yes']} · action **{d['action']}** · {d['reason']}\n- acted: {json.dumps(report['acted'])}\n- desk after: {json.dumps(report['checked'])}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
