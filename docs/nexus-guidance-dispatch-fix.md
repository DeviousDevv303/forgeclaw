# NEXUS guidance dropped before dispatch — defect, authorization, fix spec

**Status:** Authorized by the owner 2026-10-25. Builder: Claude. Independent verifier: Muse.
Merger: Cristian only, on his phrase, head re-verified live.
**Found by:** Claude (probe run, scratch test at
`/tmp/claude-0/-home-user-forgeclaw/ff5a5435-509b-5085-b88e-390568d93d94/scratchpad/nexusDispatchProbe.test.ts`).
**Verified by:** Muse, direct code read of both sites below, 2026-10-25 — the probe result is
what the code predicts.

## Owner authorization and governing directive (verbatim, 2026-10-25 23:11–23:12 CDT)

> "authorized: forgeTools.ts overlap fix — and yes, add the capped guidance to the other two chains"
>
> "Let Nexus walk with the providers all the way to the chat response."

The directive is the law this fix implements: NEXUS guidance accompanies **every** provider end
to end — dispatch through generation to the visible chat response. No stage may silently strip
it. This document covers the two known violations; the acceptance rule at the end covers future
dispatch paths.

**Owner's rationale (2026-10-25 23:19 CDT):** NEXUS was formed walking with paid-tier models —
the owner's lanes run on paid-tier systems — and its approved guidance carries that tier's
judgment. Letting NEXUS walk with every provider is how that standard reaches the free and
local models too: the guidance's influence on their work should be positive — better answers,
the owner's lessons applied — never ceremonial. Influence here means guidance present in the
prompt/context, steering the response. It does **not** mean NEXUS rewriting or approving the
final reply; that would be a separate design the owner has not ordered.

## The defect

`buildDeepSeekTaskPayload` (`src/lib/ai/deepseekContext.ts:66`) assembles one `context` string
from sections: the runtime envelope, the NEXUS GUIDANCE block
(`nexusGuidanceForDeepSeek(task).text`, line 74 — the owner's approved heuristics, recurring
failures from his own runs, and approved knowledge), fresh CORPUS records (under 1 hour old),
and verified tool results.

At dispatch, `deepseek_reason` in `src/lib/forgeTools.ts` (the "Defense-in-depth" block,
lines 1342–1351) drops the **whole** context when it shares no words longer than 4 letters with
the task:

```ts
const taskWords = new Set(task.toLowerCase().split(/\W+/).filter(w => w.length > 4))
const contextWords = new Set(context.toLowerCase().split(/\W+/).filter(w => w.length > 4))
const overlap = [...taskWords].filter(w => contextWords.has(w)).length
if (overlap === 0) { context = '' }
```

The check exists for a real failure — stale context (e.g. an 18h-old SHA Q&A) confusing the
model into answering the wrong question. But it is topic-blind in the wrong place: heuristics
and lessons are attached to tasks **whether or not they match the task's topic** (they are
standing owner instruction, not task context), so on any low-vocabulary-overlap task the entire
string — guidance, envelope, fresh corpus records — is discarded.

Probe evidence (Claude's run, `executeTool` on `deepseek_reason`, fetch stubbed, one heuristic
stored: "say plainly when a step failed"):

| Task | Dispatched `context` |
| --- | --- |
| "write a poem about cats" | `""` — NEXUS guidance lost |
| "explain which step failed in the build" | guidance reached dispatch |

NEXUS therefore guides the 16B only when the task happens to share vocabulary with the
guidance text.

## Fix spec — part 1: `forgeTools.ts` (protected path; authorization above)

1. Exempt the NEXUS GUIDANCE block from the overlap check. Apply the check only to the
   remaining context; re-attach the block before dispatch. If the remainder drops and the
   block remains, the dispatch carries the block.
2. The block is identifiable inside the joined context by its "NEXUS GUIDANCE" header.
   Carrying the guidance as a distinct payload field instead is equally acceptable —
   builder's choice; acceptance is behavioral, not structural.
3. Do **not** weaken the check for non-NEXUS context: the stale-context failure it guards
   against is real.
4. Regression tests that fail on today's code:
   - A task with zero >4-letter overlap with the stored guidance still dispatches with the
     NEXUS block attached (the poem case).
   - A genuinely stale non-NEXUS context (no overlap, no guidance) still drops to `""`.

## Fix spec — part 2: the two chains that never receive guidance (no protected file)

The website chain and the "improve \<file\>" chain build their own tasks and skip
`buildDeepSeekTaskPayload` entirely — they receive no NEXUS guidance at all. Add the guidance
to both, capped at **~600 characters** (their context window is 8K and the rewrite chain
already sends the whole file).

## Acceptance rule for every future dispatch path

Any new path that sends a task to a provider must show, in its tests, where NEXUS guidance
enters and that it survives to the dispatched payload. A path that cannot show this does not
satisfy the owner's directive, whatever its code claims.

## Verification protocol (Muse's side of the collaboration)

On the builder's branch, before the owner merges:

1. Re-run the probe-shaped regression tests (part 1, item 4) — both cases.
2. Read the diff claim-by-claim against this spec; confirm the staleness check still drops
   non-NEXUS stale context.
3. Full gate: targeted tests → eslint → tsc → full vitest → `npm run build`, counts reported
   as observed.
4. Byte-verify the pushed head via the git protocol (fetch + cat-file + SHA-256), and confirm
   the PR diff is exactly the files this spec names.
5. Report the verdict on the PR. The owner merges on his phrase with the head re-verified
   live at merge time.

## Explicit non-goals

- No workaround from other files: patching around the check elsewhere would hide the defect
  (the builder's own ruling, adopted here).
- No change to which records NEXUS admits or approves; this is a dispatch-plumbing fix, not
  an intake change.

## Status (updated 2026-10-25, late)

Implemented by the app lane on branch `ccr-59f50f85-gymfis` (no PR open at this writing):
the overlap exemption (split/join helpers in `nexusGuidance.ts`, `[END NEXUS GUIDANCE]`
marker), guidance-first ordering in the context assembly, capped (600-char) guidance on
the website and improve chains, the tool-less plain-chat prompt fix in `App.tsx`, and the
shared-system-prompt coverage the lane verified for the tool path. Muse spot-verified:
the `forgeTools.ts` hunk matches Part 1 exactly, and `src/lib/nexusContinuity.test.ts`
passed in Muse's run; after the lane added this spec's missing regression test (stale
context with no guidance stored still drops), its full-suite count is 2015 passed /
8 skipped / 0 failed (lane-observed). Line-cite note: the `deepseekContext.ts:74` cite
above describes the pre-fix layout; the fix moved the guidance to the top of the
assembled context.

Authorized by the owner 2026-10-25 23:30 CDT — both gap fixes proceed, built by the app lane on the split branch (coordination record on #235): (1) `deepseek-16b.yml` middle-trims over-long
prompts and can cut the guidance; `prompt_trimmed` is recorded in run metadata but never
surfaced in chat — fixing needs a protected workflow edit. (2) Hand-typed
`deepseek_reason` calls carry only the typed context — attaching guidance inside
`executeTool` would close the last unguarded path.
