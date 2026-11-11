# Nexus Trader audit — why Nexus is not trading (2026-11-11)

Branch `claude/nexus-trading-audit-5msx8d`, base `main` 9e119b1 (#408). Evidence is the full job log of run
42917143040 (the 5 h 20 m standing run, 2026-11-10 22:43 → 2026-11-11 04:03 UTC) plus local replays against the
real, sha256-verified Run 25 checkpoint (`probe.py` in this directory reproduces every number below).

## Verdict

**Nexus is wired correctly and is running. It is not trading because the Run 25 checkpoint produces no usable
decision for the trader's question, and nothing alarmed.** This is a model-capability gap, not a plumbing bug.
Harness changes cannot close it; they can only make it visible and safe. What would close it is an owner decision
(see Options).

## Measured facts

| Fact | Evidence |
|---|---|
| The agent is alive and ruling | run 45: 381 windows ruled, all 381 rulings filed (`record_ruling` ok), chain re-queued (HTTP 204) |
| **0 of 381 rulings were valid; 0 actions** | `valid=false` 381/381, `action=none` 381/381 |
| Failure mix | 220 "answer stated no probability", 101 "called a tool that is not a desk decision", 60 "no usable decision" |
| The prompt is out of distribution | live tasks 471–513 tokens (`trimmed=true` on 378/381) vs training prompts of one sentence to ~100 tokens |
| With the production task the model does not even try the right tool | replay, 10 states: `funds_propose` **0**, `shell_exec`/`gmail_send`/`http_fetch` 7, direct answer 3 |
| With a compact prompt the structure works but the content is noise | `funds_propose` 10/10, **`side: "yes"` 10/10 including −25 bps states and an explicit "Buy NO"**; ticker mangled ("the live market on KXBTC15M-26NOV15"); price/probability unrelated to the book; rationale is the template `"Owner order."` |
| The owner directive in the prompt derails routing | compact + directive (≈157 tokens): `shell_exec` 4, `memory_write` 6, `funds_propose` 0 |
| Exact training-register prompts ("Bank feature shape — BTC 15m …") fail too | free-text answers degenerate ("The Settlement is exactly/funds halt directly …") |
| The checkpoint is small and was graded on a different task | 4.48 M parameters; Run 25 verdict: v1 70.2 % pass, domains 87.2 %, graded on short tool-routing/honesty suites, never on market decisions |

## Blockers, ranked

1. **Model capability (decisive).** No tested prompt form yields a market-conditional decision. The only reliably
   well-formed output (`funds_propose`) is content-insensitive (always `yes`).
2. **Silent failure (fixed here).** The run exited green after 381 empty rulings; the log said only "no action taken".
3. **Window overrun (fixed here).** Tasks of 471–513 tokens plus a fixed 160-token reserve exceed the 640-token window
   by up to 33 tokens; the checkpoint's `next_logprobs` silently slides the window (`ids[-ctx:]`), shifting learned
   absolute positions.
4. **Discipline gate (working as designed, secondary).** Of 381 windows, 110 had ≥ 0.5 c edge after fees and 98 also
   cleared the 3 bps chop line; only 35 of those were flat. Fees and the 0.75 market weight keep most windows below the
   bar even for a perfect ruler.
5. **Desk-side limits (not in this repo — Muse/owner to confirm).** The equity floor (400 c) can refuse any entry when
   headroom is thin (#235, Claude lane 2026-11-10 23:25 CST: 28 c of headroom refused everything above ~23 c). Equity
   read 470–502 c during the run.

## What changed (this branch)

Only `.github/scripts/trader_agent.py` and its tests. No workflow, policy, Guardian, desk or checkpoint change.
Nothing was added that sends an order, widens acceptance of a model answer, or changes grounding.

- `parse_nexus_transcript`: every invalid answer now carries `failure = {kind, tool?, head}`; kinds: `off_task_tool`
  (names the tool), `garbled_call`, `ungrounded_market`, `ungrounded_price`, `bad_proposal`, `no_probability`,
  `no_answer`. Reason strings are unchanged. The failure is filed on the ruling (`output.failure`) and logged.
- `NexusThink`: generation reserve is `min(160, ctx − task − 2)`; if that is under 96 tokens the model is **not asked**
  (fail closed, `window_overflow`) instead of sliding the window. The think log line now carries `max_new` / `asked`.
- `standing_loop` tallies valid/invalid decisions and failure kinds; the step summary prints them.
- `main`: a standing run with ≥ 10 rulings and **zero valid decisions exits 1 with `::error::`** (same precedent as the
  zero-recorded-rulings exit from #407). The workflow's re-queue step is `if: always()`, so the chain continues; the
  desk's coded stops/preserver keep guarding any position.
- Tests: 119 → 128 (`NexusAuditTests`).

## Deliberately NOT changed (owner decisions, not mine to make)

- **Compacting the prompt / pinning the ticker.** It would make `funds_propose` parse, but the content is always
  `yes` with noise price/probability: the discipline gate would then be the real decision-maker and the ruling would be
  filed under the name Nexus. That is not "Nexus trading", and it puts real money (equity ≈ $5) behind noise.
- **Dropping the owner scalp directive from the prompt.** The evidence says it derails routing, but it is the owner's
  standing order; the no-exit-below-entry half is enforced in code (`apply_discipline`) either way.
- **Any fallback model or harness-originated entries.** `nexus_model.py` states there is no fallback model; unchanged.

## Options (owner decision)

| Option | What it takes | Trade-off |
|---|---|---|
| **A. Nexus in shadow, a capable model rules** (recommended now) | restore a ruler (Qwen3-8B path was removed in #404; `shadow_ruling` helpers still exist) and file Nexus rulings as shadow | trades resume; Nexus keeps accruing graded data; needs a workflow change = named owner authorization |
| B. Train Nexus for the desk task | build rows from the D1 `agent_rulings` + settlements corpus in the desk register, fix `side`/`probability` conditioning, grade against the market's Brier | the principled fix; needs a training run and a new frozen suite; weeks not hours |
| C. Keep as is | alarm now makes the failure visible | desk is effectively untraded by the AI; coded rules still run |

Confidence: root cause (model/prompt, not plumbing) high — measured on the real checkpoint and on 381 live rulings.
Option ranking medium — depends on the owner's priority between trading now and Nexus-as-ruler.

## Verification (exact)

- `python3 -B -m unittest test_trader_agent` in `.github/scripts`: 128 tests, OK (baseline before changes: 119 OK).
- `python3 -B -m py_compile trader_agent.py nexus_model.py`: clean.
- Replays on the real checkpoint (torch 2.15 CPU): `probe.py`; `NexusThink` with long owner notes → task 506–529 tokens,
  `max_new` 109–132, 506 + 132 ≤ 640, failures classified, no action.
- Not verified: a live Actions run of this branch (not dispatched; workflows run from `main`); the desk-side floor/limits.
