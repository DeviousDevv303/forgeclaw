# MiroFish swarm-sim runner

One MiroFish simulation per market per card, run on a GitHub Actions runner, producing a run record, an illustrated world and,
for a counted run, one line in the intake lane's own `sim-run` schema. Owner GO 2026-10-24: a swarm-sim lane inside FUSION,
**weight zero until it earns weight**, never a fourth judge. This document covers the engine side only. The intake schema
(`src/lib/nexusIntake.ts`), grading (`src/lib/simGrading.ts`) and the FUSION block belong to the intake lane (#300); the runner
adapts to that schema and never writes to the intake stream.

## What it is, and is not

MiroFish (AGPL-3.0) builds a knowledge graph from seed text, spins up persona agents on a simulated Reddit/Twitter, runs
argument rounds and writes a narrative report. It simulates how a *crowd* converges. It is not a fight model, and **it emits no
probability**. The only number in a record is a poll the runner adds (`agent-poll-v1`): after the rounds, every agent is asked
one fixed question and answers `PICK=<A|B>; P_A=<0-100>; WHY=<..>`. That measures how the packet propagated through simulated
personas; it is not independent evidence. Each record carries `baseline_direct`, one direct model call on the same packet, so
grading can tell whether the swarm adds anything beyond the packet.

## Dispatch

Workflow `MiroFish Sim` (`.github/workflows/mirofish-sim.yml`), manual dispatch only. Under Guardian's default `autonomous`
posture (owner directive, 2026-10-25, #308) the chat dispatches without a co-sign, so each run's limits are the dollar ceiling
(default $0.40, hard maximum $1.00) and the one-sim-per-key rule below; the stricter postures still ask the owner first.

**From the ForgeClaw chat** (owner, 2026-10-25: "I want to see everything from ForgeClaw"), two tools (`src/lib/mirofishSim.ts`):
- `mirofish_sim` checks the workflow's own input rules, then dispatches. It refuses to start a second run while one is
  running, because ForgeClaw re-runs the last task a closed page left by itself, and a second dispatch could spend a key's
  other attempt. It also refuses to rerun a key that already has a completed sim, unless the owner named a `rerun_reason`. It
  then finds the run by its invocation ID and waits up to 20 minutes. When the run finishes, it shows the result: the record in
  plain lines for the model, and the world SVG as a picture in the reply. The picture travels through the image registry
  (`imageArtifact.ts`), never the model's context. A run still going is handed off with its invocation ID.
- `mirofish_sim_result` is read-only. It shows any finished run the same way, by card and market (latest attempt, or a given
  one), or a handed-off run by invocation ID.

The sim always runs on GitHub with the repository secrets below, whatever model drives the chat.

**NEXUS learns from every sim it sees, once each.** It records how the run went: the packet's size and hash, preset, model,
agents, real agent actions, repeated seed posts dropped, poll size, cost and the status or failure reason. Each sim is stored as
an unapproved learning candidate, which the owner reviews, and never converges into knowledge by itself. Both sim tools are in
`NOT_EVIDENCE_TOOLS`: a chat answer that rests on a sim counts as `completed`, never `verified`, because the poll measures
simulated personas, not the fight.

Inputs: `invocation_id`, `card_id`,
`market_ticker`, `sides` (`Name A|Name B`), `yes_side`, `position_ref`, `preset`, `model`, `thinking`, `ceiling_usd`, `packet`,
`provenance`, `rerun_reason`. Repository secrets (it refuses to start, spending nothing, if either is missing):

| Secret | What it is |
|---|---|
| `MOONSHOT_API_KEY` | The owner's existing Moonshot account. API credit is assumed and **unverified**. Held only by the metering proxy. |
| `ZEP_API_KEY` | Zep Cloud free tier. Read the real monthly quota in the Zep dashboard once it exists (sources disagree on the figure). |

The seed packet goes to **Zep Cloud** (a third party) and to the model provider. Public data and analysis only; the runner
screens for secrets and owner-private words (bankroll, positions, keys) and refuses, but that is a last-line guard.

## Presets and cost

| preset | active rounds | agent cap | platform | counts toward the 10-sim bar | est. cost on Moonshot K2.6 |
|---|---|---|---|---|---|
| `tiny` | 4 | 8 | both | **no** (a pipeline proof; never filed to intake) | **$0.30 measured** (4 agents, run 40241533761) |
| `small` | 12 | 14 | both | yes | ~$0.72 |
| `mid` | 24 | 20 | both | yes | ~$1.83 |

Every preset runs MiroFish's `parallel` script (Twitter and Reddit). Its reddit-only script writes no `actions.jsonl` (only a
SQLite file) and never reports a platform as finished, so no world could ever be built from it. "Active rounds" are rounds in
which MiroFish's script can pick an agent; the runner adds the rounds in which it cannot (see *The clock* below), which make no
LLM call. **Measured:** a complete `tiny` run with 4 agents, thinking off, cost **$0.30** (58 calls, run 40241533761):
ontology to config $0.038 (8 calls), the simulation $0.018 (6), the poll $0.010 (4), and MiroFish's report with the graph read
and the baseline **$0.232 (40 calls, 78%)**. The report, not the swarm, is most of the cost. `small` and `mid` are unmeasured.

Estimates are from reading the code (calls × tokens), at third-party-tracker prices ($0.95 in / $4.00 out per M tokens) that
disagree slightly; thinking tokens bill as output, so real cost may be higher. **Only `tiny` fits the default $0.40 ceiling on
K2.6**, and `tiny` does not count toward the bar, so **on this engine at this ceiling no run builds the track record.** Counted
sims need `small` at a higher `ceiling_usd` (hard maximum in the workflow: 1.00; `small` is est. $0.72), or a cheaper engine. The meter replaces the estimate with measured usage after the first run; its figure is an upper bound (every
prompt token at the cache-miss price), and the provider's usage page is the invoice.

## Discipline, and where each rule is enforced

- **No pin, no record.** The workflow pins the MiroFish commit, its `uv.lock` hash and the CPU torch wheel hash; the runner
  refuses a run whose pins are missing. Every package installs with `--require-hashes`.
- **One completed sim per `(card_id, market_ticker)`.** Checked against the `sim-results` branch before anything is spent.
  An aborted or failed attempt does not take the slot, up to 2 attempts per key. A further run needs `rerun_reason`
  (an owner override), recorded as `rerun_of`.
- **A dollar ceiling.** `LLM_BASE_URL` points at a local meter that tallies every call and cuts off with HTTP 429 at the
  ceiling (record status `aborted_budget`). Calls already in flight finish, so overshoot is bounded by concurrency.
- **One engine per run.** The meter refuses any other model, and sets one thinking mode for every call. MiroFish never holds
  the provider key.
- **The provider's rules, not MiroFish's sampling.** Moonshot's K2 models pin `temperature` (1.0 with thinking, 0.6 without),
  `top_p`, `n` and both penalties, and reject any other value with HTTP 400 (Moonshot's kimi-k2.6 quickstart). MiroFish sets
  its own temperature on every call, so the meter removes those five fields and the provider applies its fixed values. Each
  removal is counted in `usage.request_policy`, and `config.sampling` says so. This was the cause of the first live failures.
- **Thinking mode** (`thinking`, kimi-k2.6 only): `disabled` by default. It is cheaper, and MiroFish's tool-using agents do
  not pass reasoning back between turns (the clash with thinking mode is plausible, not observed). `enabled` is filed under
  its own engine label (`kimi-k2.6+thinking`), so grading keeps the two track records apart. `kimi-k2.7-code` has no documented
  toggle and runs at the provider default.
- **No empty assistant turns.** Moonshot also rejects an assistant message with no text and no tool call ("the message at
  position 4 with role 'assistant' must not be empty"). camel, the agent library under MiroFish, keeps one in each agent's
  history after an action, so every later call by that agent failed: its next simulation step and the final poll (third live
  run). The meter drops such turns for Moonshot and counts them in `usage.request_policy.empty_assistant_dropped`. A turn
  that carries a tool call is kept, even with empty text; Moonshot accepts those.
- **Errors say why.** MiroFish logs a rejected call as `status=400` and nothing else. The meter prints every provider and meter
  error to the job log (key redacted) and keeps the first few in `usage.error_samples`; a failed record's `reason` ends with
  the provider's own words.
- **Agent count.** MiroFish derives it from the packet and an LLM and cannot be told an exact number, so the runner checks the
  prepared count against the preset cap **before** the simulation starts (`aborted_agents_over_cap`) and stamps the actuals.
- **Reproducibility is not claimed.** Sampling is the provider's fixed values on K2 (above) and MiroFish's own elsewhere, and
  which agents act each round is random; `reproducible: false` is recorded.
- **Finished means every platform's flag.** The runner waits for MiroFish's per-platform `twitter_completed` and
  `reddit_completed` (set when it reads each platform's `simulation_end`), not for `runner_status: completed`, which MiroFish
  publishes only once the simulation process exits. The process deliberately stays alive afterwards so the agents can be
  interviewed, so the old signal never came: the first post-fix live run waited the full 90 minutes. The runner then waits
  (bounded, 300 s) for the environment to report `env_alive`, which happens just after the loop ends, before asking the poll.
- **The report waits for the terminal status.** MiroFish refuses a report (`409`) until the run status is `completed` or
  `stopped`, and publishes that only once the process has exited after `close-env`. The runner now polls the run status
  (up to 300 s) before asking; a run status of `failed` ends the run with MiroFish's error, keeping the
  poll. If `close-env` fails, the runner stops the simulation instead, since `stopped` is also accepted and an open environment
  would never reach either status. Until a terminal status is seen, cleanup still stops the simulation before deleting the graph.
- **The clock.** MiroFish's simulated clock starts at 00:00. Each round its script picks
  `int(uniform(agents_per_hour_min, agents_per_hour_max) × the hour's multiplier)` of the agents awake in that hour, so a round
  acts only when an agent is awake **and** that count is at least 1. Every config MiroFish generates multiplies peak hours by 1.5
  and off-peak hours (00:00 to 05:59 by default) by 0.05, which truncates a small swarm's count to 0. The script cannot be given a
  start hour and runs unmodified, so the runner reads the prepared config (`GET /api/simulation/<id>/config`) and counts a
  round as active only when its hour has an agent awake and `agents_per_hour_min × multiplier ≥ 1`. It asks for rounds up to
  the preset's last active round; the rounds before and between are idle. If no hour is that certain, it falls back to hours
  where an acting agent is possible (`agents_per_hour_max × multiplier > 1`, recorded as `activity: possible`). The plan is
  recorded in `config.clock`. `config.active_rounds_run`, the active rounds actually run, is what the intake line calls
  `engine.rounds`.
- **Agents are counted before their profiles are written.** Prepare makes about one model call per agent, so the runner first
  reads the same entity filter from Zep (`GET /api/simulation/entities/<graph>?enrich=false`, no model call) and refuses an
  over-cap packet there. Seen live (2026-10-26, `SPIKE3-UFC333` attempt 1): checked only after prepare, an 18-agent packet spent
  $0.13 on profiles before the 14-agent cap refused it. If the count cannot be read, the check after prepare still decides.
- **An intake line only for a market still open.** A line is a pre-fight forecast, so the runner reads the market from Kalshi's
  public API before anything is spent (only when a line could be filed: a counted preset with a YES side). It files the line
  only if the market's status is open and its close time is still ahead. The record's `market_at_start` says what Kalshi
  showed; an unreadable market (one retry on a rate limit) files no line. On 2026-10-26 the chat ran a counted preset with a
  YES side on a fight already decided; had it completed, its line would have entered the 10-sim bar.
- **No swarm, no world.** A run in which no agent acted after the seeded posts (`config.simulated_actions: 0`) ends `failed`
  instead of building a world from the seed alone.
- **Seed posts are not counted twice.** MiroFish's script logs its seed posts as round 0, then reads its action table from row 0
  (`last_rowid = 0`), so each platform's first agent round logs the seed posts again. The runner drops those repeats (only in that
  round, only an exact match on agent, type and text, each seed at most once) before counting actions or building the world,
  and records how many in `config.relogged_seed_posts_dropped`.
- **Cleanup order.** On every outcome the runner stops the simulation if it may still run, waits until MiroFish no longer counts
  it as active, then deletes the Zep graph, retrying a `409` (MiroFish's `GraphInUseError`) up to 4 times. `zep.deleted` says
  whether it worked. The first post-fix live run skipped the stop and left its graph in Zep. Cleanup never raises: the record
  is written whatever happens there.
- **One deadline.** The stage limits add up to 225 minutes; the job is killed at 150. The runner's overall deadline
  (`--deadline-s 8100`) cuts every stage to fit and keeps 240 s back for cleanup and the record (cleanup calls get a 20 s HTTP limit, so it fits even when MiroFish hangs), so a slow run ends as `timeout`
  with both done. The ontology call, one synchronous LLM call inside MiroFish, now gets its 600 s stage limit, not the 120 s HTTP default.
- **Watchable while it runs.** The runner prints one line per step to the job log with the spend so far
  (`[runner +  312s] simulate: round 9 of 12 ($0.0841 so far, 23 LLM calls)`). On failure the job also prints MiroFish's log
  without the status polls and the simulation process's own `simulation.log`, which the first live runs never showed.

## Output

Committed to the `sim-results` branch (and uploaded as an artifact), under `<card_id>/`:

- `<market_ticker>.<attempt>.run-record.json`: the engine-side record (status and reason, seed hash and thin-input labels, engine
  pins and environment digest, config as run, poll statistics, baseline, usage, Zep credits estimate, artifact hashes, timing,
  and whether an intake line was emitted and why not).
- `…sim-run.nexus.json`: **one line in the intake lane's `sim-run` schema** (`kind`, `ts`, `source`, `run_id`, `ref`,
  `position_ref`, `seed`, `engine`, `median_lean_pct`, `side`, `report`). Written only for a **completed** run of a size that
  **counts toward the bar**, with a known `yes_side` and a parseable lean, because grading counts every filed sim toward its
  10-settled-sims bar and a toy world must never earn the lane weight. `side` is `YES` and `median_lean_pct` is the swarm's
  median P(the YES contract's fighter wins). `position_ref` defaults to `shadow:<card_id>:<market_ticker>`. The intake lane files
  it; the runner does not touch the intake stream.
- `…sim-world.v1.json`: the canonical illustrated world: graph, agents with final pick, per-round events, poll answers, report
  sections. Deterministic, at most 1 MiB; if it would exceed that, low-signal events are dropped first and `limits` says so.
- `…world.svg`: a static, script-free preview (a cluster per final pick, activity as dot size, longest excerpts as captions).
- `…report.md`: MiroFish's own report. Stored, **never parsed for numbers**.

Statuses: `completed`, `aborted_budget`, `aborted_agents_over_cap`, `aborted_zep_quota`, `timeout`, `failed`.

### Where the intake schema and this runner do not fit, and what was done

- **`engine.image_digest`** is required (`sha256:<64 hex>`) because the schema assumed a container image. This engine is a
  hash-pinned **source install**, so there is no image. The runner puts a sha256 of the whole pinned environment (MiroFish
  commit, lock hash, CPU torch wheel hash, Python and uv versions, runner image) in that field and adds
  `engine.digest_kind: "source-install-environment"` so it is never mistaken for an image digest. **This is a proposal for the
  intake lane to ratify or change.**
- **`position_ref`** is required but a shadow sim has no position yet, hence the `shadow:` default.
- **Size is invisible to grading**, so the runner withholds the line for sizes that do not count rather than flagging it.
- A cross-language test (`src/scripts/mirofishRunner.test.ts`) validates and grades the runner's golden line with the real
  TypeScript code; the Python side checks the same fixture, so a change on either side fails one of them.

## What is verified, and what is not

Verified offline (179 Python tests, run in CI by `src/scripts/mirofishRunner.test.ts`): the metering proxy, the world builder
and its SVG, the requirement filter, the runner's orchestration and refusals against a **scripted fake MiroFish**, the workflow's
safety properties, and the intake line against the real TypeScript validator and grader. The hash-pinned CPU install was also
run for real (1.35 GB, about 2 minutes, `pip check` clean, `import oasis` works).

**First live contact (2026-10-25):** both secrets in place, the pinned install and MiroFish start worked, and the first LLM
call (the ontology) was rejected by Moonshot with HTTP 400 on both K2 models (runs 40164232338 and 40164446883; cost $0). Cause:
the pinned sampling above, fixed in the meter. The fix was checked end to end offline: MiroFish's own request code (the
`openai` SDK and its `openai_chat_compat` at the pinned commit) through the real meter process to a fake that enforces
Moonshot's documented rule. Without the policy the fake rejects the ontology call exactly as Moonshot did; through the meter
it passes. Those two runs used both attempts on the real `UFC333` / `KXUFCFIGHT-26OCT24YANDVA-YAN` key, so tests belong on a
throwaway card.

**Second live run (2026-10-25, run 40166223749, `SPIKE-UFC333`, `tiny`, thinking off):** the meter fix held: 7 Moonshot calls
accepted, 0 errors, `temperature` removed from each, $0.03. Ontology, graph, profiles and config all completed (3 agents). The
simulation then sat at round 0 until the 90-minute stage limit. Read from MiroFish's source, the three causes are the finished
signal, the clock and the cleanup order above. All three are fixed here and covered against the fake.
That run's Zep graph (`mirofish_c71e989943764fa4`) was left in Zep, holding public pre-fight facts only.

**Checked against MiroFish's real simulation script (offline, 2026-10-25):** `run_parallel_simulation.py` at the pinned commit,
launched as the backend launches it (wait-for-commands mode), with its LLM calls going through the real meter to a fake that
enforces Moonshot's rules. Zep is not involved at this step. With a prepared config whose agents wake at 08:00, and the 12
rounds `plan_clock` asked for (8 idle + 4 active):
- rounds 1 to 8 logged 0 actions and made 0 LLM calls; all 18 calls came in rounds 9 to 12;
- both platforms wrote `simulation_end` (what sets the finished flags), and `env_status` turned `alive` just after;
- the poll, sent through MiroFish's own IPC client, was answered by every agent in about a second, in the shape the runner
  parses; `close_env` then ended the process;
- the requests carried only `model`, `messages`, `tools` and `thinking`: no streaming, no sampling fields.

It also caught a bug the fake had hidden: the interview results carry `agent_id` as a string (`"0"`) while profiles and actions
use integers, so every agent would have shown as `undecided` in the world. The runner converts it, and the fake now returns
strings, as the real script does. At that point the backend's own run-status and interview endpoints over HTTP, the report
stage, real cost and whether real agents' poll answers parse were not verified live; the fourth and fifth runs below verified all
four.

**Third live run (2026-10-25, run 40234425538, `SPIKE-UFC333`, `tiny`, thinking off, $0.058, 3 minutes):** the runner fixes
held live. The clock plan was 60-minute rounds, agents awake from 08:00, 8 idle + 4 active = 12 rounds; 5 agents; the simulation
finished; the environment opened for interviews; the Zep graph was deleted. The poll then failed on Moonshot's empty-assistant
rule above (the record's `reason` quoted Moonshot's own words). The same rule was reproduced against the real script offline:
without the drop, 15 of 21 calls were rejected, including every agent's later simulation steps; with it, 29 empty turns were
dropped, 0 calls rejected, every action went through and every agent answered the poll. The `SPIKE-UFC333` key has now used
both its attempts, so the next test needs a new throwaway card.

**Fourth live run (2026-10-25, run 40238192399, `SPIKE2-UFC333` attempt 1, `tiny`, thinking off, $0.046, 129 s):** ontology,
graph, profiles (4 agents), simulation, environment and poll all worked live, and the empty-assistant drop held (0 dropped,
0 provider errors). The poll parsed: 4 of 4 answers, 3 for Yan and 1 for the other side, median P_A 53.5, 0 unparsed. The Zep
graph was deleted. The run then failed for two reasons, both fixed above and reproduced first:
- the report was asked for within a second of `close-env` and refused (`409`, "Simulation or Zep graph ingestion is still active").
  The fake now refuses it the same way until the process has exited, and the old runner fails on it exactly as it did live;
- the clock plan was 4 rounds from 00:00, because one agent was awake at every hour. Those hours are off-peak, so with 1 to 2
  agents an hour × 0.05 no agent was picked in any round (0 LLM calls during the simulation; the log held only the 4 seeded
  posts). Checked against MiroFish's own `get_active_agents_for_round`, lifted from the pinned script: in every round the new
  plan counts, the function picked at least one agent in 3,000 of 3,000 draws; in the six rounds it skips for that config,
  it picked none. Against the real script end to end (wait-for-commands mode, real meter, fake Moonshot), that config logged
  0 agent actions with the old 4-round plan and agent actions in rounds 7 to 10 (06:00 to 09:00) on both platforms with the
  new 10-round plan.

**Fifth live run: the first completed one (2026-10-25, run 40241533761, `SPIKE2-UFC333` attempt 2, `tiny`, thinking off,
$0.30, 401 s).** Every stage worked live:
- the clock: agents first able to act at 08:00, so 8 idle + 4 active = 12 rounds;
- the poll: 4 of 4 answered, 3 for Yan and 1 for the other side, median P_A 53.5, 0 unparsed, the same figures as attempt 1;
- the end-of-simulation wait: one 5-second poll, then the report was accepted;
- the report: 26.9 KB in 4 sections, written in 4 minutes;
- the Zep graph was deleted;
- the world, its SVG and the report were published to `sim-results` with matching hashes.

Three things limit what the world means:
1. **The agents are the packet's entities, not a crowd.** MiroFish makes one agent per entity it extracts. The 662-character
   packet gave the venue (Etihad Arena), ESPN and the two fighters, and each fighter-agent picked itself. As a pipeline proof
   that is fine; as a forecast the poll means nothing. A counted sim needs a packet that names crowd-type entities (analysts,
   coaches, training partners, fan communities) and runs past the 1,500-character thin mark.
2. **9 of the 15 actions it counted were repeated seed posts** (see *Seed posts are not counted twice*, fixed after this run).
   The genuine agent actions were 6: a quote, a comment, a repost, two posts and one do-nothing. The fix was checked against the
   real script with seed posts added: it dropped the 5 repeats and kept all 8 agent posts.
3. **Seed posts can carry the wrong voice.** MiroFish assigns seed posts by entity *type*, round-robin
   (`_assign_initial_post_agents`). Both fighters share a type, so the post written as Yan was posted by the Merab agent and
   the reverse. MiroFish runs unmodified, so the world shows this as it happened.

`SPIKE2-UFC333` is closed (completed). The next run needs a new card.

**Still open:** real run time for `small` and `mid` (estimated 10–30 minutes for `mid`) and their cost; whether poll answers
keep parsing at larger swarm sizes (4 of 4 so far); the real Zep quota; and Moonshot's real price and credit.

Not built: the Anthropic engine (it needs OpenAI-to-Messages translation in the meter; spike first), a free local Qwen lane
(about 3 hours for a `tiny` world, unproven on tool-calling), and a seed packet for NFL.

## Licence boundary

MiroFish is cloned inside the job at the pinned commit, installed from its own lockfile, and run as a separate process. No
MiroFish code is vendored into this repository. If it is ever patched *and* reached by users over a network, AGPL-3.0 section
13 requires offering that source. This is not legal advice.

**Owner directive (2026-10-25): MiroFish may be modified to fit ForgeClaw**, including for running on Kimi through Moonshot.
The "runs unmodified" constraint is lifted. The form is a fork in its own repository (AGPL-3.0, still an external process,
never vendored here), with the fork's commit pinned in the run record as the upstream commit is today. It is not a build order:
reach for it when a fit problem belongs to the engine. Candidates so far, each worked around in the runner today:
- the simulated clock starting at 00:00 with off-peak activity scaling (`plan_clock`);
- the report's terminal-status gate (the runner waits);
- the seed posts logged twice (`last_rowid = 0`; the runner drops the repeats);
- seed posts assigned by entity type (`_assign_initial_post_agents`; not worked around);
- a configurable Zep endpoint.
