# NEXUS continuity: handoff note (2026-10-26)

**Law (owner, Cristian Nunez):** NEXUS walks with the providers all the way to the chat response. It rides every
provider end to end, from dispatch through generation to the answer on screen, and no stage strips it silently.

## Authorization actually given and used

The owner replied to a specific request ("authorized: forgeTools.ts overlap fix") with: "I authorized both of u to make
whatever changes work as a team and leave each other documentation". I read that as covering the one protected-path edit
that was proposed, in `src/lib/forgeTools.ts`, and nothing else. No other protected path (`.github/`, `package.json`,
Guardian, `engine/`, `foundation/`, `tests/foundation/`, `LICENSE`) was touched. Landing stays with human review: this is
branch/PR-only work.

## Where NEXUS travels, and what each stage does

| Stage | File | Behaviour |
|---|---|---|
| Build the 16B context | `src/lib/ai/deepseekContext.ts` | Guidance block is the first section, so the 22K budget cuts the envelope, architecture facts and old records before it. |
| Fixed chains (website, self-sculpt) | `src/lib/ai/providerRouter.ts` (`chainGuidance`) | Build their own task, so they carry a block capped at 600 chars (8K window; the sculpt task holds a whole file). |
| Dispatch | `src/lib/forgeTools.ts` (`deepseek_reason`) | Guidance is set aside before the "no shared words with the task" rule and put back after. The rule still drops the other context. |
| Block format | `src/lib/nexusGuidance.ts` | Block ends with `[END NEXUS GUIDANCE]`; `splitNexusGuidance` / `joinNexusGuidance` carry it as a unit; cap keeps the end marker. |
| Hosted providers (Kimi, Claude, Muse, DeepSeek API, OpenRouter) | `src/App.tsx` | Heuristics and tool lessons are in the shared system prompt. |
| Tool-less chat turns | `src/App.tsx` (`conversationalPrompt`) | Now include the owner's heuristics (they were dropped before). |
| After the answer | `src/App.tsx` (`logToCorpus`, `recordLearning`) | Outcome recorded for every provider. Unchanged. |

Tests: `src/lib/nexusContinuity.test.ts` (dispatch, chains, size budget, block format) and
`src/appNexusPlainChat.test.tsx`. The dispatch and budget tests were checked to fail on the old code.

## Known remaining gaps (not fixed, need an owner decision or a protected file)

1. `.github/workflows/deepseek-16b.yml` trims the **middle** of an over-long prompt (`deepseek_gguf.fit_text`) and
   records `prompt_trimmed` in the result metadata. The context sits in the middle, so a very long prompt can still lose
   the guidance inside the workflow. Visible in the run metadata, not silent, but nothing in the chat tells the owner.
   Fixing it means editing the workflow (protected) to protect the guidance span.
2. A hand-typed `deepseek_reason` call (operator tool syntax) carries only the context the operator typed. The single
   choke point that would cover every path is `executeTool` attaching guidance itself; not done, since it widens the
   authorization given.
3. Public visitors' browsers hold no NEXUS data by design; the relay path is unchanged.

## For the next agent

- Do not widen the overlap exemption to other context: stale corpus records poisoning the 16B is what the rule is for.
- Keep `NEXUS_GUIDANCE_END` intact if you change the cap or the text; the split depends on it.
