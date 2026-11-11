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

---

# Addendum — owner decision 2026-11-11: "let Nexus trade, then see what errors it has"

**Decision (Cristian, in this session, after reading the audit):** first "Option A", then changed to: have Nexus trade and
learn from the errors it makes as it trades. This is the named authorization the first commit lacked. It is implemented in
a **second, separate commit** on the same branch (PR #410) so it can be reverted alone (`git revert <sha>`), or switched off
with one constant, without touching the observability fixes.

## What "Nexus trades" means here (read this before merging)

Measured on the real checkpoint, Nexus's `funds_propose` calls are **well-formed but content-free**: side is `yes` ~100 % of
the time regardless of the market, price/probability are unrelated to the book, the market ticker is mangled, the rationale
is the template `"Owner order."`. So a proposal is now acted on **for what it reliably carries (a well-formed call = "enter",
plus side/probability)**, and the harness's own math decides whether the entry is allowed. In practice this is **YES entries
that the harness's fair-value edge already approves, confirmed by Nexus's proposal**. It is the owner's chosen experiment; it
is not evidence that Nexus can read the market. Every ruling is filed with `model='nexus-run25'`, its raw transcript, its
`p_model`, and the overrides, so the error rate is measurable afterwards.

## Changes (commit 2; `.github/scripts/trader_agent.py`, tests, probe, this doc)

| # | Change | Why / evidence |
|---|---|---|
| 1 | **Task v2** `build_nexus_task`: one sentence, ~56 tokens: `Propose a trade on <ticker>: BTC is +x.x bps vs the strike, YES bid/ask c`. Holding desk: `The desk holds SIDE in <ticker> bought at Nc; its bid is Bc and BTC is …  Sell it now? Answer EXIT, or HOLD with your P(YES).` v1 kept as `build_nexus_task_v1` (reference/repro). `NEXUS_TASK_VERSION` → `nexus-trader-task-v2` (new `system_sha` on every ruling). | v1 (436–513 tok) routed to `shell_exec`/`gmail_send`/`http_fetch`, 0 × `funds_propose`. v2: `funds_propose` 10/10 (probe), 12/12 for five prompt variants. No "paper" wording: it is a real trade. |
| 2 | **`NEXUS_ACT_ON_PROPOSALS = True`.** A well-formed proposal is acted on; **market pinned** to the live window, **model price ignored** (the desk fills at the book; price never reaches the order), **reason written by the harness** from desk math, model rationale only quoted. Overrides listed in `decision.notes` and in phase 4 of the ruling's 5-phase trace. Side not yes/no or probability not in [0,1] (or a bool) is still void (`bad_proposal`). Set `False` → strict grounding returns (market/price mismatch = void). | Without it 381/381 void. The model's `"Owner order."` rationale would otherwise have reached the owner's live page and the `AGENT_ACTION` journal as if the owner had ordered the trade. |
| 3 | **A proposal while the desk already holds is not acted on** (valid decision, `action none`, `blocked enter_<side>`). | v2 asks a holding desk only EXIT/HOLD; a noise `funds_propose` must not add to a position. Held-desk replay: 8/8 direct garbage, **0 × EXIT**, so no spurious sells. Coded stops/preserver/exit lines keep managing positions. |
| 4 | **Owner note and owner scalp directive are NOT in the model prompt.** Each ruling's `inputs.omitted_from_model_prompt` + `omitted_why` records it. | Measured: adding the directive (~100 tokens) flips routing to `shell_exec`/`memory_write` 10/10. Its hard half (never exit below entry) is enforced in code (`apply_discipline`) either way. **Cristian: say so if you want it back in the prompt; the cost is that Nexus then stops proposing.** |

## Gates that still stand (nothing relaxed here)
`apply_discipline` (edge ≥ 0.5 c after fees, |dist| ≥ 3 bps, no agent exit below entry), the stale check, the sign check,
the Bank's `agentEntryLaw` (entry-price cap 85 c, window-loss cap, recovery caution, against-strike, price-ran, event
blackout, **equity floor 400 c**, no re-entry after stop), the 6.25 % risk cap, coded stops, preserver, kill switch.

## Forecast on the real checkpoint (CORRECTED 2026-11-11 — real journal states, Bank law included)
**Correction:** the first version of this section (30 synthetic states) said the first live trades would likely be small
long-shot YES buys. That was wrong: it stopped at `apply_discipline` and forgot the Bank's own entry law. The MCP `enter`
passes `distanceBps`, and `agentEntryLaw` refuses a side BTC is already `STOP_CROSS_BPS` (0.5 bps) past the strike against
(`against-strike`, `src/app/agentLaw.ts`, `src/observer.ts:146`). Re-measured on **200 real flat states** from the decision
journal (`entryprobe.py` logic; v2 task; real checkpoint; parse -> `apply_discipline`):

| BTC vs strike | n | Nexus said YES | said NO | no proposal | survives discipline | then refused by Bank law |
|---|---|---|---|---|---|---|
| above (d ≥ 0) | 105 | 74 | **0** | 31 | **0** (edge < 0.5c every time) | n/a |
| below (d < 0) | 95 | 77 | **0** | 18 | 48 (YES at 0.6–8c lottery tickets) | **48 of 48 `against-strike`** (YES with BTC below strike) |

**Expected live trades from this sample: ~0.** Nexus never chose NO in 200 states; every YES it proposes with BTC above the
strike is blocked by the edge gate, and every YES with BTC below the strike is refused by the desk's own law. So "Nexus
trades" currently yields **proposals and rulings (the error data), not fills**. A fill needs BTC above the strike *and* YES
mispriced by ≥ 0.5c after fees — 0 of 105 in this sample. Cristian should know that the experiment is safe for exactly this
reason, and that it will not produce trades until Nexus can say NO.

**Held positions (real states, 160 sampled from the journal; 120 are `stop-below-entry-held` ticks, 79% have bid < entry):**
v2 held prompt -> 160/160 direct garbage, **0 EXIT, 0 below entry**, 0 `funds_propose`. Safe by emptiness: it also cannot
manage a position; exits stay with the coded stops, the preserver and the AI exit line.

## Runbook for Muse
1. **Merge** needs Cristian (`.github/`). Merge commit 1 alone for observability only; commit 2 turns trading on.
2. **First run after merge** — expected log lines: `{"think": …"task_tokens": ~56…}`; rulings with `valid:true`;
   `acted` containing `enter` only when a proposal survives discipline AND the desk's law. `AGENT_MODE=shadow` (repo variable)
   still makes it predict-and-log without sending.
3. **Switch off, fastest first:** repo variable `AGENT_MODE=shadow` (no code) · `AGENT_STANDING=off` (stops the chain) ·
   `NEXUS_ACT_ON_PROPOSALS = False` (strict grounding) · `git revert` commit 2.
4. **Errors to look for** (all in `agent_rulings.output_json`): `failure.kind`, `notes[]` (every override), `blocked`,
   `p_model` vs settlement (Brier), `valid`. Suggested read: group by `notes` present, then by outcome of entries Nexus
   triggered. Compare entry P&L against the harness-only baseline (edge ≥ 0.5 c YES entries) to see whether Nexus adds or
   subtracts anything.
5. **Desk blockers outside this repo:** equity 428 c vs floor 400 c leaves 28 c headroom; entries above ~23 c are refused
   `equity-floor` (lawful). The Bank's `against-strike` law additionally refuses the YES long-shots a YES-only Nexus proposes below the strike, so expect ~0 fills (see the corrected forecast).

## "How long until Nexus can trade for real?" (owner question; estimate, low confidence)
- **Plumbing to act at all:** done in this addendum (hours).
- **A Nexus that conditions on the market** (Option B): needs (1) a training set in the desk register built from
  `agent_rulings` + settlements (the Qwen-era valid rulings plus the new Nexus ones), ~1–2 days; (2) a training run on the
  Run 26 VM (hours to a day per run; Run 26 is mid-run); (3) a new frozen desk suite graded against the market's Brier,
  1–2 days. **First evidence of side/probability conditioning: ~1 week.** Whether a 4.5 M-parameter model can learn it is
  **unknown**: Run 25's loop spent 16 runs plateauing at 70 % on short tool-routing suites. Treat "weeks, possibly never at
  this scale" as the honest range; the live experiment above will give the real baseline error rate sooner.

## Verification (this addendum, exact)
- `python3 -B -m unittest test_trader_agent` (in `.github/scripts`): **138 tests, OK** (128 before; +10 `NexusActsTests`;
  three old tests re-pointed to `build_nexus_task_v1` / strict mode); `py_compile` clean.
- Real checkpoint: `probe.py` v2 task → `funds_propose` 10/10, 8/10 valid; held-desk replay 8/8 non-EXIT; end-to-end
  parse + discipline over 30 states (above).
- Not verified: a live Actions run; a real order reaching the Bank (the Bank's `enter` route and law are unchanged and
  were not exercised); the desk-side floor/limits.
