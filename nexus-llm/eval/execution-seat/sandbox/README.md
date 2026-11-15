# Execution sandbox (DRAFT, wires nothing)

`sandbox_init.sh` (stage 2, runs inside fresh net/mount/pid/ipc/uts namespaces and builds an ALLOW-LIST root: read-only /usr, /etc and libraries, a minimal /dev, /proc and the workdir at /srv, then chroots into it) + `exec_sandbox.py` (runner, artifact writer) + `probes.py` (acceptance probes EX-S1..S8, each run against the real sandbox and a deliberately broken variant, with restoration proven by hash).

Run: `sudo python3 probes.py` (needs root for mount/unshare). `probe-report-container-2026-11-03.json` is the result from the build container (Linux 6.18, root, 4 CPU).

Known limits, stated now:
- Tested only in one container. The GitHub Actions runner is untested; its kernel, `unshare`/`prlimit`/`setpriv` availability and sudo are assumptions to check by running `probes.py` there.
- The process cap relies on `RLIMIT_NPROC` for an unprivileged uid (65534), not a pid cgroup, so it counts every process of that uid on the machine.
- The workdir mount point is `/srv` and must exist, be empty and have no submounts. Setup fails closed (exit 97, `sandbox-setup-failed`) if any non-read-only mount cannot be remounted read-only.
- Mounts that are already read-only are left as they are. The probes check writes to a world-writable stand-in directory, `/etc` and `/usr`, not every path on the base.
- No network is proven by interface list and a failed connect; DNS is not separately probed.

## Harness (added 2026-11-03)
`../harness.py` is the model-agnostic turn loop (`model(messages) -> str`; one JSON object per turn: `{"run": [...]}` or the final report). After the session it runs the row's hidden test in a fresh sandbox, writes the artifact (the model's report is hashed in the manifest; `packet.json` and `grade.json` are written afterwards by the harness only), and grades it with `../grade.mjs`, which loads `src/lib/nursery/executionChecks.ts` (needs Node with `--experimental-strip-types`). `../selftest.py` drives it with scripted models, no LLM, and requires every failure shape to flag exactly the expected checks.

## Correction, 2026-11-03: the hidden tests were readable (fixed)
The first sandbox only made the host filesystem read-only. A model inside it could still READ the repo checkout (where `rows.py` holds every hidden test) and `/tmp` (earlier artifacts and grades). That was found by an adversarial read, not by the earlier probes. The init now builds a new root from an allow-list and chroots into it, and probe EX-S8 checks that the repo path, `/tmp`, `/home` and `/opt` do not exist inside and that the root lists only the allowed directories. Its broken variant (no chroot) finds all four planted markers and lists the whole host root, so it fails for the right reason. `/etc` is still bound in read-only, so anything secret in `/etc` that an unprivileged uid can read is visible; the allow-list is a minimum, not proof of nothing sensitive.
A stray empty directory `/sbxwork` from the first prototype remains at the host root; removing it was blocked by a safety check and is left to a person.
