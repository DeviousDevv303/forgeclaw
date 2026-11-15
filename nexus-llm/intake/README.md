# #235 -> Corpus producer

Lane directive 1 (forgeclaw #235, comment 6866644896): every fix worked on the #235 channel and **verified against the
repository objects** goes into Corpus and into the training mix.

```
python3 nexus-llm/intake/issue235_producer.py --live --git-dir . --existing-intake <published intake.jsonl> --out-dir out
python3 nexus-llm/intake/issue235_producer.py --comments c.json --prs p.json --git-dir . --out-dir out     # offline / fixtures
python3 nexus-llm/traces-v1/real_block.py                                                                    # dry-run mix report
python3 -B -m unittest discover -s nexus-llm/intake -p "test_*.py"
```

- **What counts as a pair:** a pull request named in a #235 comment whose object says merged, names a merge commit, and whose
  head has a successful check run and no failed one (and, with `--git-dir`, whose merge commit exists in git and names the PR).
  A comment saying "fixed" is never enough. Rejected PRs are listed with their reasons in `producer-report.json`.
- **Intake record:** the existing shape (`src/lib/nexusIntake.ts`): source `issue-235-fix`, kind `fix-verified`, run_id
  `pr-<n>-<merge sha12>`. It is a **pending candidate**: the owner's three auto-admission classes do not cover this source.
  Admitting these on arrival is an owner ruling (a fourth class); nothing here widens the gate.
- **Trace row:** traces-v1 shape, kind `fix_verified_real`, `label_source: repository_object`, `value_source: api`
  (new values: the existing ones, `grader_recorded` and `prose`, would be false here).
- **Leakage:** shaping refuses to run when no frozen set can be loaded; an overlapping row is dropped and counted. The guard
  probes at every offset (see the comment in `issue235_producer.py`; the stride-12 probe in `build_traces_v1.py` and
  `runs/run25/build_dataset.py` catches only about 1 alignment in 12 of an exact overlap).
- **`appendAutonomousFixLearning`** (`src/lib/corpus.ts`): superseded for #235 pairs, left unwired and untouched. It records
  no verification (nothing checks that the PR merged or its CI passed).
- **Consuming it:** `runs/run25/build_dataset.py` names its two real files explicitly. A builder that calls
  `traces-v1/real_block.py: load_real_block()` gets every `*-v1.jsonl` of real rows, including `fix-verified-v1.jsonl`.
- **Live mode is untested against the live API from this lane's sandbox** (no token); the API calls are covered by a stubbed
  opener test. The fixtures in `fixtures/` were assembled from GitHub tool outputs; see `_fixture_note` in `issue235-prs.json`.
