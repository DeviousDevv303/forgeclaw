#!/bin/sh
# Stage 2 of the execution sandbox. Runs INSIDE fresh net/mount/pid/ipc/uts namespaces (see exec_sandbox.py).
# Makes every mount read-only except one size-capped tmpfs workdir, then drops privileges and runs the command
# under resource limits and a hard wall clock. Fails closed: any setup error aborts before the command runs.
# Env in: SBX_WORK (workdir path), SBX_HOST_WORK (the dispatch's tmpfs, bound here), SBX_WORK_BYTES, SBX_CPU_S, SBX_AS_BYTES, SBX_NPROC, SBX_NOFILE, SBX_FSIZE, SBX_WALL_S
set -eu
mount --make-rprivate /
mkdir -p "$SBX_WORK"
mount --bind "$SBX_HOST_WORK" "$SBX_WORK"
# Remount every other mount read-only (bind remount), in the namespace only.
# Mounts already read-only are left as they are (re-remounting a locked ro mount can fail); everything else is remounted ro.
awk -v w="$SBX_WORK" '$5 != w && $5 != "/proc" && $6 !~ /(^|,)ro(,|$)/ { print $5 }' /proc/self/mountinfo | sort -r | while IFS= read -r m; do
  mount -o remount,bind,ro "$m" 2>/dev/null || { echo "sandbox-setup: cannot remount $m read-only" >&2; exit 97; }
done
cd "$SBX_WORK"
exec prlimit --cpu="$SBX_CPU_S" --as="$SBX_AS_BYTES" --nproc="$SBX_NPROC" --nofile="$SBX_NOFILE" --fsize="$SBX_FSIZE" -- \
  timeout --signal=KILL "$SBX_WALL_S" \
  setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- "$@"
