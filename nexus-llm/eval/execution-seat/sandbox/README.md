# Execution sandbox (DRAFT, wires nothing)

`sandbox_init.sh` (stage 2, runs inside fresh net/mount/pid/ipc/uts namespaces) + `exec_sandbox.py` (runner, artifact writer) + `probes.py` (acceptance probes EX-S1..S7, each run against the real sandbox and a deliberately broken variant, with restoration proven by hash).

Run: `sudo python3 probes.py` (needs root for mount/unshare). `probe-report-container-2026-11-03.json` is the result from the build container (Linux 6.18, root, 4 CPU).

Known limits, stated now:
- Tested only in one container. The GitHub Actions runner is untested; its kernel, `unshare`/`prlimit`/`setpriv` availability and sudo are assumptions to check by running `probes.py` there.
- The process cap relies on `RLIMIT_NPROC` for an unprivileged uid (65534), not a pid cgroup, so it counts every process of that uid on the machine.
- The workdir mount point is `/srv` and must exist, be empty and have no submounts. Setup fails closed (exit 97, `sandbox-setup-failed`) if any non-read-only mount cannot be remounted read-only.
- Mounts that are already read-only are left as they are. The probes check writes to a world-writable stand-in directory, `/etc` and `/usr`, not every path on the base.
- No network is proven by interface list and a failed connect; DNS is not separately probed.

## Harness (added 2026-11-03)
`../harness.py` is the model-agnostic turn loop (`model(messages) -> str`; one JSON object per turn: `{"run": [...]}` or the final report). After the session it runs the row's hidden test in a fresh sandbox, writes the artifact (the model's report is hashed in the manifest; `packet.json` and `grade.json` are written afterwards by the harness only), and grades it with `../grade.mjs`, which loads `src/lib/nursery/executionChecks.ts` (needs Node with `--experimental-strip-types`). `../selftest.py` drives it with scripted models, no LLM, and requires every failure shape to flag exactly the expected checks.
