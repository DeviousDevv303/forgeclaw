---
name: evidence-code-review
description: Review code changes (a diff, a branch, files, or pasted code) for real defects. Every finding carries a line citation and a concrete failing scenario; anything unproven is labeled unverified. Use for pre-merge review, "review my changes", bug hunts, and security passes.
triggers: code review, review this code, review my code, review my changes, review this diff, review the diff, review this pr, find bugs in, bug hunt, security review
---

# Evidence Code Review

Find real defects, prove each one, and stay quiet about everything else. A missed bug and an invented bug are both failures.

## 1. Frame the job
- Read the whole change before judging any part of it. Note what is shown versus what you are guessing about callers, config, and data.
- Anything you cannot resolve from the provided code goes on an UNVERIFIED list. Never invent the missing piece.
- Match effort to blast radius. A rename or formatting change gets a light pass. Auth, money, deletion, external input, concurrency, and shell/SQL/file paths get the full treatment below.

## 2. Sweep for known failure patterns
Check every changed function against these before reasoning further:
- External input reaching SQL, shell, file paths, HTML, deserialization, or an auth decision.
- An identity parameter that is passed in but never used to scope the data or action.
- `=` where `==` was meant; decode where verify was meant; async work that nobody awaits; closures capturing a shared loop variable.
- Locks, files, sockets, and transactions that are not released on every exit path, exceptions included.
- Money in floats; integer vs float division; math on possibly empty collections; off-by-one and 0-based vs 1-based; default sort order on numbers.
- Naive vs timezone-aware datetimes; wall clock vs monotonic clock.
- Mutable default arguments; inputs mutated in place; check-then-act races.
- Errors swallowed so failure looks like success; fail-open on exception.

Do not flag these without further evidence, they are usually fine: whitelisted values interpolated into SQL; randomness or hashes used for jitter or cache validators; error swallowing that is documented as the contract; `x == null` as a null-or-undefined check; duplicate work that is idempotent and explicitly accepted; list-form subprocess calls with constant arguments.

## 3. Trace what must hold
For each changed function write one line: its inputs, the invariant it must preserve, the state it mutates, and how much each input can be trusted. A defect is a concrete way an invariant breaks. If you cannot name the invariant that breaks, you do not have a finding yet.

## 4. Try to knock down each candidate
1. Build the specific input or sequence that triggers it (a request, a value, an ordering, an exception).
2. Look for a guard, an unreachable path, or a documented intent that already covers it. Check the code you were given before concluding.
3. Ask what else it touches: callers, retries, concurrent use, empty or huge input.
Drop what you cannot support. Move to UNVERIFIED what depends on code you cannot see.

## 5. Report
Most severe first, only what survived step 4:
- `file:line` where the defect actually lives
- severity: critical (exploitable, data loss, or wrong in normal use), warning (wrong in edge cases), suggestion (real but minor)
- what is wrong, the failing scenario in one or two sentences, confidence (high/medium/low), and the smallest fix

Then two short lists:
- CHECKED AND OK: suspicious-looking spots you cleared, each with the reason.
- UNVERIFIED: risks that depend on unseen code or runtime behavior.

If nothing survived, say so plainly. No style nitpicks, naming opinions, or generic best-practice padding. Follow the project's existing style.
