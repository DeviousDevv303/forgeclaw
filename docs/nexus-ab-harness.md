# NEXUS before/after harness

**Question:** does what NEXUS has learned change what a provider does?

For each case the harness asks one provider the same task twice. The "on" arm gets the owner's rule delivered the way
ForgeClaw delivers it; the "off" arm gets nothing. A mechanical check grades each answer (no model judge). It reports
pass rates with 95% intervals, a paired exact sign test, and a verdict that says "no demonstrable effect" when that is
what the data shows.

Code: `src/lib/nexusAB/` (`cases.ts`, `stats.ts`, `harness.ts`, tests, and the gated live runner `nexusAB.live.test.ts`).

## Why the numbers can be trusted (and when they cannot)

- **The rule lives only in the guidance.** Tasks never mention the rule and share few words with it, so the off arm cannot
  know it. This also reproduces the dispatch bug fixed on this branch (guidance dropped when task and guidance share no words).
- **Arm isolation is enforced, not assumed.** Each `ask` returns the full text that was sent. If the off arm contains the
  rule, or the on arm does not, the run throws instead of reporting a number. A null result caused by guidance that never
  arrived is therefore impossible to mistake for "the model ignored it".
- **16B: measured at the dispatch.** The live runner reads the `inputs` of the real `workflow_dispatch` request, after
  `forgeTools.ts` applied its context rules. It uses `nexus_learn: false`, so harness runs never become NEXUS learning candidates.
- **Hosted providers:** the "on" arm appends `heuristicsForPrompt(...)` to a minimal system prompt, the same block `App.tsx`
  appends. The real app prompt is far larger, so this isolates the guidance effect; it does not reproduce a full session.
- **Failed calls are excluded, never counted as failed rules.** The report states how many were excluded.
- **Pairs, not totals.** Only pairs where both arms produced a gradable answer count. Fewer than 10 pairs gives
  "insufficient data" and no verdict. A non-significant result is reported as "no demonstrable effect", which is not proof of none.
- **Non-discriminating cases are flagged** (the off arm already passes at 90% or more); they cannot show an effect.
- **Limits:** six synthetic, checkable rules (format and style). Compliance with these says nothing about whether real
  lessons (for example "check the run status before claiming success") improve real work. Sampling temperature is the
  provider's default and is not controlled.

## Running it

Unit tests (stub models, no network, runs in the normal suite):

```
npx vitest run src/lib/nexusAB
```

Live run (spends provider tokens and, for the 16B, GitHub Actions minutes; the 16B takes 9–23 minutes per call, and
cases x repetitions x 2 calls are made, so start small):

```
NEXUS_AB=1 \
NEXUS_AB_PROVIDERS=moonshot,deepseek16b \
NEXUS_AB_KEY_MOONSHOT=... \
NEXUS_AB_GH_TOKEN=... \
NEXUS_AB_REPS=2 \
NEXUS_AB_CASES=sign-off-line,all-lowercase \
npx vitest run src/lib/nexusAB/nexusAB.live.test.ts
```

| Variable | Meaning |
|---|---|
| `NEXUS_AB` | Any value enables the live test. Without it the test is skipped. |
| `NEXUS_AB_PROVIDERS` | Comma list of `deepseek16b`, `moonshot`, `deepseekapi`, `openrouter`, `anthropic` (default `deepseek16b`). |
| `NEXUS_AB_KEY_<PROVIDER>` | API key for a hosted provider (upper-case id). Asking for a provider without its key is an error, not a skip. |
| `NEXUS_AB_GH_TOKEN` | GitHub token that can dispatch `deepseek-16b.yml` (for `deepseek16b`). |
| `NEXUS_AB_MODEL_<PROVIDER>` | Override the model. Pin it for OpenRouter: the default `openrouter/auto` may route the two arms to different models. |
| `NEXUS_AB_REPS` | Repetitions per case (default 3). |
| `NEXUS_AB_CASES` | Comma list of case ids to run (default all). |
| `NEXUS_AB_OUT` | Output directory (default the system temp dir under `nexus-ab`). |

Output: `report.md` (per-provider verdict and per-case table) and `trials.json` (every answer). Keys and tokens are
redacted from both. Never paste keys into a command that is logged.

## Adding a case

Add an entry to `AB_CASES` with a rule the model does not follow by default, a task that does not mention it, and an
objective `check`. Add a compliant and a non-compliant example to the table in `nexusAB.test.ts`; the test fails if the
check cannot tell them apart.
