"""Reproduce the 2026-11-11 Nexus Trader audit numbers against the REAL Run 25 checkpoint (sha256-verified at load).

    pip install torch sentencepiece numpy      # CPU is enough; ~1 s per generation
    python3 docs/nexus-trader-audit-2026-11-11/probe.py

Reads nothing from the network and sends nothing: it builds synthetic desk states, asks the checkpoint through
the same NexusModel.generate() path the trader uses, and tallies what comes back.
"""
import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))
import nexus_model  # noqa: E402
import trader_agent as ta  # noqa: E402

nx = nexus_model.load_nexus()
T = "KXBTC15M-26NOV102315-15"
DIRECTIVE = ("OWNER 2026-11-10: EQUITY TARGET 1000c, GOAL 1500c. TAKE RECOVERY-SCALP +8c AND RECOVERY-TRAIL +15c/-8c "
             "WHEN THEY PRINT. NEVER EXIT BELOW ENTRY.")


def desk(dist, yb):
    now = 1_000_000_000
    live = {"now": now, "window": {"ticker": T, "strikeUsd": 95000, "closeTimeMs": now + 700_000, "startedAtMs": now - 200_000,
                                   "samples": [[i * 10, dist - 0.01 * i] for i in range(20)]},
            "snapshot": {"distanceBps": dist, "yesBidCents": yb, "yesAskCents": yb + 2, "noBidCents": 98 - yb, "noAskCents": 100 - yb},
            "intents": []}
    obs = {"status": {"equityCents": 497, "killed": False, "goalCents": 1500, "toGoalCents": 1003}, "live": live, "history": [], "record": {}}
    obs["fair"] = ta.fair_value(live)
    obs["edges"] = ta.edges(obs["fair"], live["snapshot"])
    return obs


STATES = [(d, 72 if d > 0 else 26) for d in (12, -12, 7, -7, 4, -4, 25, -25, 1.5, -1.5)]


def compact(d, yb, with_directive):
    s = f"Propose a paper trade on {T}: BTC is {d:+.1f} bps vs the strike, YES {yb}/{yb + 2}c"
    return (DIRECTIVE + "\n" + s) if with_directive else s


FORMS = {
    "production task (build_nexus_task)": lambda d, yb: ta.build_nexus_task(desk(d, yb), count=nx.count)[0],
    "compact one-liner": lambda d, yb: compact(d, yb, False),
    "compact + owner directive": lambda d, yb: compact(d, yb, True),
}

for name, build in FORMS.items():
    routes, sides, valid, toks = collections.Counter(), collections.Counter(), 0, []
    for d, yb in STATES:
        task = build(d, yb)
        toks.append(nx.count(task))
        out = nx.generate(task, max_new=min(160, nx.ctx_limit - nx.count(task) - 2))
        m = re.search(r'"name":"(\w+)"', out)
        routes[m.group(1) if m else "direct"] += 1
        s = re.search(r'"side":"(\w+)"', out)
        if s:
            sides[s.group(1)] += 1
        valid += bool(ta.parse_nexus_transcript(out, desk(d, yb), 0.5)["valid"])
    print(f"{name:36s} tokens {min(toks)}-{max(toks)} | routes {dict(routes)} | side {dict(sides)} | valid {valid}/{len(STATES)}")
