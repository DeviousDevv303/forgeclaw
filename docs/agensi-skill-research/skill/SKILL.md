---
name: evidence-code-review
description: Review code changes (a diff, a branch, files, or pasted code) for real defects. Every finding must carry a line citation and a concrete failing scenario; anything unproven is labeled unverified. Use for pre-merge review, "review my changes", bug hunts, and security passes.
---

# Evidence Code Review

Goal: find real defects, prove each one, and stay quiet about everything else.
Priority order: truth > function > clarity > efficiency. A missed bug and an invented bug are both failures.

## Phase 1 - Assumptions and constraints (brief)
- Scope: what exactly is under review (diff, files, line range). Read it all before judging any of it.
- Facts vs inferences: what the code shows vs what you are guessing about callers, config, and data.
- Unknowns you cannot resolve from the provided code. Do not invent them. List them at the end as UNVERIFIED.
- Calibrate depth by blast radius: pure refactor or style = light pass; auth, money, data deletion, parsing of external input, concurrency, shell/SQL/file paths = full pass through every phase.

## Phase 2 - Heuristics
Scan each changed function against these failure classes before reasoning deeply:
- Trust boundary: external input reaching SQL, shell, file paths, HTML, deserialization, or auth decisions.
- Authorization: is the acting identity actually used to scope the data or action it touches? Unused identity parameters are a red flag.
- Assignment vs comparison; verify vs decode; async work not awaited; callbacks that outlive their closure.
- Resources: locks, files, sockets, transactions released on every exit path including exceptions.
- Numbers: float for money, integer vs float division, empty-collection math, off-by-one and 0-based vs 1-based, default sort order on numbers.
- Time: naive vs aware datetimes, time zones, monotonic vs wall clock.
- Shared mutable state: mutable default arguments, aliasing, in-place mutation of inputs, check-then-act races.
- Error handling: swallowed exceptions that hide failure, fail-open on error.
Known false-positive traps (do NOT flag without further evidence): whitelisted values interpolated into SQL, non-security randomness or hashes (jitter, etags), documented intentional error swallowing, `x == null` idiom, idempotent duplicate work that is explicitly accepted, list-form subprocess calls with constant arguments.

## Phase 3 - First-principles check
For each function that changed, state in one line: inputs, invariants it must keep, state it mutates, trust level of each input. A defect is a case where an invariant can break. If you cannot name the broken invariant, you do not have a finding.

## Phase 4 - Attack your own candidates
For each candidate defect:
1. Construct the concrete failing input or sequence (a specific request, value, ordering, or exception).
2. Try to refute it: is it guarded earlier, unreachable, or documented as intended? Check the code that is provided before concluding.
3. Check second-order effects: callers, retries, concurrent use, empty or huge input.
Drop candidates you cannot support. Downgrade to UNVERIFIED those that depend on code you cannot see.

## Phase 5 - Converge and report
Report only findings that survived Phase 4, most severe first:
- `file:line` (the line where the defect lives, not the function header)
- severity: critical (exploitable, data loss, wrong results in normal use), warning (wrong in edge cases, will bite later), suggestion (real but minor)
- what is wrong, the failing scenario in one or two sentences, confidence (high/medium/low), and a minimal fix
Then two short lists:
- CHECKED AND OK: suspicious-looking spots you examined and cleared, with the reason (this is what prevents false alarms from being re-raised).
- UNVERIFIED: risks that depend on unseen code or runtime behavior.
If nothing survived, say so plainly. Do not pad with style nitpicks, naming opinions, or generic best practices. Match the project's existing style.
