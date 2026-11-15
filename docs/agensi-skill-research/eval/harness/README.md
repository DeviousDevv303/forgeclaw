# Shared mutation harness (round two)

One scorer for both lanes. Python 3 standard library only. Usage and scoring rules: docstring of `harness.py`.

- `tasks/<task>/` : `spec.md` (the contract an arm is given), `reference.py`, `probes.py` (frozen inputs used only to classify mutants).
- `frozen/` : normalised reference, 68 mutants across 4 tasks (62 MUST, 6 MAY), manifests, `CHECKSUMS.sha256`. Every scoring command refuses to run if this set has changed.
- `examples/` : weak, strong and wrong suites used by `selftest`.

Status: frozen 2026-11-14, **no arm has been run**. Awaiting blind review of the scorer.

## For the reviewer: decisions to challenge before any run
1. MUST/MAY is derived by script (differs from the reference on a frozen probe = MUST), not by human "core vs cosmetic" judgment. All 6 MAY mutants were checked by hand and are true equivalents, so a suite killing a MAY mutant is asserting something the contract does not say.
2. `merge_intervals` has 13 mutants, under the 15-25 target; the operators produce no more for that code.
3. 26 of 68 mutants are integer-constant +1 changes. They are legitimate but samey; say if the mix should be rebalanced (requires a re-freeze, allowed only before the first run).
4. Tests that fail on the reference are reported as false positives and excluded from kill credit.
5. Review lane: hit = finding within +-1 line of the changed line. `DROP_IF` mutants delete a check, so the "line" is where the check used to be; results should be reported per operator.
6. Arms should get `spec.md` only, not the reference, so tests encode the contract. Not enforced by the harness.
7. Tasks are small pure functions written by one author. Results will not generalise to large codebases.
