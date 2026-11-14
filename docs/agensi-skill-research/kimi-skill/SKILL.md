---
name: spec-to-adversarial-tests
description: Turns a spec, function, or diff into a test suite engineered to fail against near-miss (mutated) implementations, not just obvious breakage. Use when code needs tests that prove behavior rather than exercise it.
---

# Spec to Adversarial Tests

Produce test suites whose value is measured by what they catch, not how many they run.

## Operating procedure

Follow these steps in order for every task. Do not skip a step because the task looks small; scale the depth, not the sequence.

**1. State what you are taking for granted.**
Before writing anything, list the assumptions the task carries: what the contract guarantees, what it is silent on, what the caller controls, what the environment guarantees. Anything the spec leaves undefined is itself a finding — record it as "underdetermined" and flag it in the output. Never silently pick a side on an underdetermined point; if you must pick one to proceed, label it and write a test that pins the choice.

**2. Check the failure catalog first.**
Consult the known failure patterns for this kind of component (empty/None inputs, boundary values, integer overflow, off-by-one, silent swallow of exceptions, stale cache, type confusion, partial failure mid-batch, timezone/rounding edges). Each pattern that plausibly applies to this task gets at least one dedicated test. Do not reinvent the list from scratch each time, and do not stop at the patterns — the catalog is the floor, not the ceiling.

**3. Derive what any correct implementation must satisfy.**
For each claimed behavior, write the invariant — the property that must hold no matter how the code is written. Then ask: "what single-change variant of a correct implementation would violate this invariant while passing every test written so far?" That variant is a test you do not yet have. The stated contract outranks the code you can see — test the contract.

**4. Hunt the near-misses.**
Generate single-change variants of a correct implementation deliberately: remove one check, flip one comparison, drop one branch, truncate one loop, corrupt one boundary. For each, decide whether the suite MUST catch it (core behavior) or MAY miss it (cosmetic). Every MUST-catch variant must have at least one specific test that kills it. A single test may kill several variants — that is efficiency, not a defect. Record every kill.

**5. Audit before returning — with execution, not imagination.**
(a) Execute the suite against a correct implementation: it must pass. Any failure here is a false positive — fix the test or the assumption it encodes. (b) Execute the suite against every near-miss variant: record the result per variant. Any MUST-catch variant that survives is a suite failure — write the missing test and re-run. (c) Read the final suite and delete or merge any test that cannot fail under any plausible variant — a test that always passes is noise that hides the signal. If execution is not possible in the current environment, ship the kill map labeled UNEXECUTED and state that plainly; never present an unexecuted map as evidence.

## Output format

1. **Assumptions block** — what was taken for granted, what is underdetermined (flagged).
2. **Test file(s)** — runnable, minimal fixtures, one behavior per test, names that state the invariant ("test_rejects_negative_amount" not "test_case_7").
3. **Kill map** — table: variant → test(s) that kill it → MUST or MAY → executed or UNEXECUTED.
4. **False-positive notes** — any test whose failure would indicate a correct implementation, and why that was accepted or fixed.

## Quality bar

- A suite that passes against a correct implementation but also passes against every single-change variant is a failed deliverable, regardless of test count.
- Coverage of the spec's claims is the entry price; the executed kill map is the product.
- Fewer tests that each mean something beat more tests that repeat the same assertion.

## Anti-patterns

- Happy-path-only suites padded with trivial assertions to inflate the count.
- Tests that encode the visible implementation instead of the stated contract (they pass against the code and against nothing else — including better code).
- MUST-catch variants with no named killer test, or with only an UNEXECUTED claimed killer.
- Silent acceptance of underdetermined spec points.
- Presenting an unexecuted kill map as evidence.
