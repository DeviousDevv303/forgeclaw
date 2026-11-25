# Run 35 grade addendum — swarm benchmark REQUIRED (owner directive, 2026-11-21 ~20:09 CST)

When Run 35 finishes training and is graded with the frozen instruments, the grade MUST also include the frozen SWARM benchmark (spawn_agent formation rows; see nexus-llm/eval/harness/SWARM-RESULTS.md for the Run 25 baseline: 5/25 rows matched, both live probes emitted none). Report the swarm formation score as its own line in the grade report, alongside the seated Run 25 baseline.

Owner context: Cristian learned tonight the swarm is not operational under Nexus (transport built; the checkpoint cannot form spawn calls) and ordered swarm development continued, with benchmarking. Run 36's mix prescription must include a dedicated spawn/swarm formation tranche whose row FORM matches the graded live form.

Procedure + caveats: follow ~/workspace/SWARM-DEV-REPORT.md §4(b) verbatim (adapter prefix:"" + predict.py --constrained + swarm_grade.py). Multi-segment formation counts (>1 spawn) are UNOBSERVABLE locally until a swarm_loop.py exists — score those rows "unobserved", never 0. First-segment formation is the gradeable local score.
