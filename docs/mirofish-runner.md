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

Workflow `MiroFish Sim` (`.github/workflows/mirofish-sim.yml`), manual dispatch only (also from the ForgeClaw chat through
`github_run_workflow` with `inputs`, which Guardian always asks the owner to co-sign). Inputs: `invocation_id`, `card_id`,
`market_ticker`, `sides` (`Name A|Name B`), `yes_side`, `position_ref`, `preset`, `model`, `thinking`, `ceiling_usd`, `packet`,
`provenance`, `rerun_reason`. Repository secrets (it refuses to start, spending nothing, if either is missing):

| Secret | What it is |
|---|---|
| `MOONSHOT_API_KEY` | The owner's existing Moonshot account. API credit is assumed and **unverified**. Held only by the metering proxy. |
| `ZEP_API_KEY` | Zep Cloud free tier. Read the real monthly quota in the Zep dashboard once it exists (sources disagree on the figure). |

The seed packet goes to **Zep Cloud** (a third party) and to the model provider. Public data and analysis only; the runner
screens for secrets and owner-private words (bankroll, positions, keys) and refuses, but that is a last-line guard.

## Presets and cost

| preset | rounds | agent cap | platform | counts toward the 10-sim bar | est. cost on Moonshot K2.6 |
|---|---|---|---|---|---|
| `tiny` | 4 | 8 | reddit | **no** (a pipeline proof; never filed to intake) | ~$0.22 |
| `small` | 12 | 14 | both | yes | ~$0.72 |
| `mid` | 24 | 20 | both | yes | ~$1.83 |

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
- **Errors say why.** MiroFish logs a rejected call as `status=400` and nothing else. The meter prints every provider and meter
  error to the job log (key redacted) and keeps the first few in `usage.error_samples`; a failed record's `reason` ends with
  the provider's own words.
- **Agent count.** MiroFish derives it from the packet and an LLM and cannot be told an exact number, so the runner checks the
  prepared count against the preset cap **before** the simulation starts (`aborted_agents_over_cap`) and stamps the actuals.
- **Reproducibility is not claimed.** MiroFish uses its own temperature (0.7) and sampling; `reproducible: false` is recorded.
- **The Zep graph is deleted** at the end of every run; `zep.deleted` says whether that worked.

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

Verified offline (200+ Python tests, run in CI by `src/scripts/mirofishRunner.test.ts`): the metering proxy, the world builder
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

**Not verified: a completed run against the real MiroFish with real keys.** The fake follows the request and response shapes in
MiroFish's own handlers, not observed behaviour. Specifically open: whether the interview endpoint answers after a headless run
(the code says the process stays in a waiting-for-commands mode); whether MiroFish or its agent library streams LLM calls
(the meter refuses streams, so that would fail loudly); real run time (estimated 10–30 minutes for `mid`); whether an agent
format answer parses at a useful rate; the real Zep quota; and Moonshot's real price and credit.

Not built: the Anthropic engine (it needs OpenAI-to-Messages translation in the meter; spike first), a free local Qwen lane
(about 3 hours for a `tiny` world, unproven on tool-calling), and a seed packet for NFL.

## Licence boundary

MiroFish is cloned inside the job at the pinned commit, installed from its own lockfile, and run unmodified as a separate
process. No MiroFish code is vendored into this repository. If it is ever patched *and* reached by users over a network,
AGPL-3.0 section 13 requires offering that source. This is not legal advice.
